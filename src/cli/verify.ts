import { loadEnv, apiKeyForProfile, secretsOf } from '../config/env.js';
import { loadProfile } from '../config/profile.js';
import { logger } from '../log/logger.js';
import { contentHash, readPlan } from '../map/plan.js';
import { LedgerStore, ledgerDir } from '../ledger/store.js';
import { Budget, budgetIdentity } from '../apply/budget.js';
import { ApiClient } from '../apply/api.js';
import { buildStructuralReport, renderReportMarkdown, writeReport, type LiveCounts } from '../verify/report.js';
import { captureContactSheet, runBrowserPlaybackChecks } from '../verify/browser.js';
import { runAuthorizationChecks, type AuthzTarget, type Principal } from '../verify/authz.js';
import { evaluateAcceptance, type AcceptanceVerdict } from '../verify/acceptance.js';
import { writePlaybackReport, type PlaybackResult } from '../apply/playbackPrefilter.js';

export async function runVerify(opts: {
  runId: string;
  profileName: string;
  planPath: string;
  milestone: 'M1' | 'M2';
}): Promise<AcceptanceVerdict> {
  const env = loadEnv();
  logger.setSecrets(secretsOf(env));
  const profile = loadProfile(opts.profileName);
  const apiKey = apiKeyForProfile(opts.profileName);
  const plan = readPlan(opts.planPath);
  const store = LedgerStore.open(ledgerDir(profile.name, plan.legacyHubId), opts.runId);
  const hubId = store.header.targetHubId;
  if (!hubId) throw new Error(`run ${opts.runId} has no target hub id; it never got past the hub stage`);

  const api = new ApiClient({
    profile, apiKey, budget: Budget.open(budgetIdentity(profile.teamId, apiKey)),
  });

  const livePages: LiveCounts['pages'] = [];
  for await (const row of api.listAll<{ attributes: { slug: string } }>(
    `/api/v1/teams/${profile.teamId}/hubs/${hubId}/pages/`,
  )) {
    const tree = await api.get<{ data: { attributes: { tree: unknown } } }>(
      `/api/v1/teams/${profile.teamId}/hubs/${hubId}/pages/${row.attributes.slug}?resolve=false`,
    );
    const publishedTree = tree.body.data.attributes.tree as { children?: unknown[] } | null;
    const sections = publishedTree?.children ?? [];
    livePages.push({
      slug: row.attributes.slug,
      sectionCount: sections.length,
      publishedTreeDigest: publishedTree === null ? null : contentHash(publishedTree),
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
  const v3Origin = `https://hub.member.dev/${plan.hub.slug}`;
  if (!plan.legacyHubDomain) throw new Error('the plan carries no legacyHubDomain; re-run map');
  const legacyOrigin = `https://${plan.legacyHubDomain}`;

  await captureContactSheet({
    env, slugs: plan.pages.map((p) => p.slug), legacyOrigin, v3Origin,
    hubTitle: plan.hub.title, runDir,
  });

  const legacyLinkedPages = new Set(
    store.all()
      .filter((e) => e.kind === 'asset' && e.state === 'legacy-linked')
      .map((e) => e.legacyId),
  );
  const videoSlugs = plan.pages
    .filter((page) => plan.assets.some((a) => a.isVideo && legacyLinkedPages.has(a.legacyMediaId)))
    .map((page) => page.slug);
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
    memberNoEntitlement: process.env['V3_TEST_MEMBER_NOENT_TOKEN'] ?? null,
    memberEntitled: process.env['V3_TEST_MEMBER_ENTITLED_TOKEN'] ?? null,
  };
  const authz = await runAuthorizationChecks(targets, async (url, principal) => {
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

${verdict.accepted ? 'Accepted, pending a named signature above.' : 'Not accepted.'}

${verdict.failures.map((f) => `- FAIL ${f}`).join('\n') || '- no blocking failures'}
`;
  const path = writeReport(markdown, runDir);
  logger.info('verify finished', { path, accepted: verdict.accepted, failures: verdict.failures.length });
  return verdict;
}
