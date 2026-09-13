import { existsSync, readFileSync } from 'node:fs';
import { loadEnv, withProfileLogins, secretsOf } from '../config/env.js';
import { resolveApiAuth } from '../apply/auth.js';
import { assetReferences } from '../apply/stages.js';
import { loadProfile } from '../config/profile.js';
import { logger } from '../log/logger.js';
import { contentHash, readPlan } from '../map/plan.js';
import { LedgerStore, ledgerDir } from '../ledger/store.js';
import { Budget, budgetIdentity } from '../apply/budget.js';
import { ApiClient } from '../apply/api.js';
import { buildStructuralReport, contactSheetDecision, publishedRootOf, renderReportMarkdown, writeReport, type LiveCounts } from '../verify/report.js';
import { captureContactSheet, runBrowserPlaybackChecks } from '../verify/browser.js';
import { runAuthorizationChecks, type AuthzTarget, type Principal } from '../verify/authz.js';
import { evaluateAcceptance, type AcceptanceVerdict } from '../verify/acceptance.js';
import { writePlaybackReport, type PlaybackResult } from '../apply/playbackPrefilter.js';

export async function runVerify(opts: {
  runId: string;
  profileName: string;
  planPath: string;
  milestone: 'M1' | 'M2';
  /** Capture the contact sheet; off by default until the assets have landed. */
  shots?: boolean;
}): Promise<AcceptanceVerdict> {
  const profile = loadProfile(opts.profileName);
  const env = withProfileLogins(loadEnv('.env', { require: ['cdn', 'logins'] }), profile);
  logger.setSecrets(secretsOf(env));
  const auth = await resolveApiAuth(profile, env);
  const apiKey = auth.token;
  logger.setSecrets([...secretsOf(env), apiKey]);
  const plan = readPlan(opts.planPath);
  const store = LedgerStore.open(ledgerDir(profile.name, plan.legacyHubId), opts.runId);
  const hubId = store.header.targetHubId;
  if (!hubId) throw new Error(`run ${opts.runId} has no target hub id; it never got past the hub stage`);

  const api = new ApiClient({
    profile, apiKey, budget: Budget.open(budgetIdentity(profile.teamId, auth.budgetSubject)),
  });

  const livePages: LiveCounts['pages'] = [];
  for await (const row of api.listAll<{ attributes: { slug: string } }>(
    `/api/v1/teams/${profile.teamId}/hubs/${hubId}/pages/`,
  )) {
    // A page with no published tree answers 404 here; that is a real finding, not a crash.
    let publishedRoot = null as ReturnType<typeof publishedRootOf>;
    try {
      const tree = await api.get<unknown>(
        `/api/v1/teams/${profile.teamId}/hubs/${hubId}/pages/${row.attributes.slug}?resolve=false`,
      );
      publishedRoot = publishedRootOf(tree.body);
    } catch (error) {
      logger.warn('no published tree readable for a page', { slug: row.attributes.slug, error: error instanceof Error ? error.message.slice(0, 120) : String(error) });
    }
    livePages.push({
      slug: row.attributes.slug,
      sectionCount: publishedRoot?.children?.length ?? 0,
      publishedTreeDigest: publishedRoot === null ? null : contentHash(publishedRoot),
    });
  }

  let playlists = 0;
  for await (const _ of api.listAll(`/api/v1/teams/${profile.teamId}/playlists`)) playlists += 1;
  let folders = 0;
  for await (const _ of api.listAll(`/api/v1/teams/${profile.teamId}/folders`)) folders += 1;
  let files = 0;
  for await (const _ of api.listAll(`/api/v1/teams/${profile.teamId}/files`)) files += 1;

  const report = buildStructuralReport({
    plan, store, live: { pages: livePages, playlists, folders, files },
  });

  const runDir = `runs/${opts.runId}`;
  const v3Origin = `${profile.hubBase.replace(/\/$/, '')}/${plan.hub.slug}`;
  if (!plan.legacyHubDomain) throw new Error('the plan carries no legacyHubDomain; re-run map');
  const legacyOrigin = `https://${plan.legacyHubDomain}`;

  const pendingAssets = store.all().filter((e) => e.kind === 'asset' && (e.state === 'pending-copy' || e.state === 'pending-import')).length;
  const sheet = contactSheetDecision({ shots: opts.shots === true, pendingAssets });
  if (sheet.capture) {
    await captureContactSheet({
      env, slugs: plan.pages.map((p) => p.slug), legacyOrigin, v3Origin,
      hubTitle: plan.hub.title, runDir,
    });
  } else {
    logger.info(sheet.reason);
  }

  // Only pages whose tree shows a legacy-linked video get the browser check.
  const legacyLinkedVideo = new Set(
    store.all()
      .filter((e) => e.kind === 'asset' && e.state === 'legacy-linked')
      .map((e) => `${e.legacyId}/${e.variant ?? 'original'}`)
      .filter((key) => plan.assets.some((a) => a.isVideo && `${a.legacyMediaId}/${a.variant}` === key)),
  );
  const videoSlugs = [...new Set(
    [...assetReferences(plan).entries()]
      .filter(([key]) => legacyLinkedVideo.has(key))
      .flatMap(([, refs]) => refs.filter((r) => r.kind === 'page-node').map((r) => (r as { pageSlug: string }).pageSlug)),
  )];
  const playback: PlaybackResult[] = await runBrowserPlaybackChecks({ env, v3Origin, slugs: videoSlugs });
  writePlaybackReport(playback, runDir);

  const targets: AuthzTarget[] = [];
  const mappedTargets = new Set(plan.accessRules.map((r) => r.targetRef));
  for (const page of plan.pages) {
    for (const nodeId of page.restrictedSectionNodeIds) {
      targets.push({
        kind: 'section', ref: nodeId, url: `${v3Origin}/${page.slug}`,
        rule: mappedTargets.has(nodeId) ? 'entitlement-or-segment' : 'members',
      });
    }
  }
  for (const entry of store.all()) {
    if (entry.kind !== 'asset' || !entry.v3Id) continue;
    targets.push({
      kind: 'asset', ref: entry.v3Id,
      url: `${profile.apiBase}/api/v1/teams/${profile.teamId}/files/${entry.v3Id}`,
      rule: entry.asset?.visibility === 'public' ? 'public' : 'entitlement-or-segment',
    });
  }

  const tokens: Record<Principal, string | null> = {
    anonymous: null,
    memberNoEntitlement: process.env['V3_TEST_MEMBER_NOENT_TOKEN'] || null,
    memberEntitled: process.env['V3_TEST_MEMBER_ENTITLED_TOKEN'] || null,
  };
  // Without both test-member tokens the matrix cannot distinguish the principals; say so rather than pretend.
  const authzSkipped = !tokens.memberNoEntitlement || !tokens.memberEntitled;
  if (authzSkipped) logger.warn('authorization checks skipped: V3_TEST_MEMBER_NOENT_TOKEN / V3_TEST_MEMBER_ENTITLED_TOKEN are not set (the test members do not exist yet)');
  const authz = authzSkipped ? [] : await runAuthorizationChecks(targets, async (url, principal) => {
    const token = tokens[principal];
    const response = await fetch(url, {
      redirect: 'manual',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(30_000),
    });
    return { status: response.status, location: response.headers.get('Location') };
  });

  const verdict = evaluateAcceptance({ report, plan, store, playback, authz, milestone: opts.milestone });
  const markdown = `${renderReportMarkdown(report, plan)}

## Verdict

${verdict.accepted ? 'Accepted, pending a named signature above.' : 'Not accepted.'}${authzSkipped ? ' Authorization checks were SKIPPED: the two test members do not exist yet, so spec 7.5 is unverified.' : ''}

${verdict.failures.map((f) => `- FAIL ${f}`).join('\n') || '- no blocking failures'}
`;
  let ungatedSection = '';
  const ungatedPath = `${runDir}/published-ungated.json`;
  if (existsSync(ungatedPath)) {
    const ungated = JSON.parse(readFileSync(ungatedPath, 'utf8')) as Array<{ slug: string; legacySegments: string[] }>;
    if (ungated.length > 0) {
      ungatedSection = `\n## Published ungated\n\nThese pages are open on V3 although legacy gated them (apply --publish-held):\n\n${ungated.map((u) => `- /${u.slug}: ${u.legacySegments.join('; ')}`).join('\n')}\n`;
    }
  }
  let excludedSection = '';
  const removed = store.all().filter((e) => e.state === 'removed');
  if (plan.excludedPages.length > 0 || removed.length > 0) {
    excludedSection = `\n## Excluded pages\n\nNot migrated because V3 serves the surface itself; links to them go to the built-in route:\n\n${plan.excludedPages.map((e) => `- "${e.title}" (legacy ${e.legacyType} page ${e.legacyPageId}) -> /${e.route}`).join('\n') || '- none'}\n\nRemoved from the hub by this run:\n\n${removed.map((e) => `- ${e.kind} ${e.legacyId} (${e.v3Id ?? '?'}): ${e.reason ?? 'no reason recorded'}`).join('\n') || '- none'}\n`;
  }
  const path = writeReport(`${markdown}${ungatedSection}${excludedSection}`, runDir);
  logger.info('verify finished', { path, accepted: verdict.accepted, failures: verdict.failures.length });
  return verdict;
}
