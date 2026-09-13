import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, withProfileLogins, secretsOf } from '../config/env.js';
import { resolveApiAuth } from './auth.js';
import { loadProfile, targetOf } from '../config/profile.js';
import { logger } from '../log/logger.js';
import { TOOL_VERSION } from '../version.js';
import { readPlan, planHash, type Plan, type PlanAsset } from '../map/plan.js';
import { fetchCatalog } from '../map/catalog.js';
import { assertContract, loadContracts, type EntityKind } from './contracts.js';
import { Budget, budgetIdentity } from './budget.js';
import { ApiClient } from './api.js';
import { MioCli } from './mioCli.js';
import { preflight } from './preflight.js';
import { renderDryRun, type Operation } from './dryRun.js';
import { LedgerStore, ledgerDir } from '../ledger/store.js';
import { Lock, assertLedgerClean, HEARTBEAT_INTERVAL_MS } from '../ledger/lock.js';
import { deleteOrphans, findOrphans, isImage, runAssetStage, type AssetRunner } from './assets.js';
import { checkAccess } from './checkAccess.js';
import { type S3Ops } from './s3.js';
import { principalsFromEnv, s3OpsFor } from './s3Clients.js';
import { playbackPrefilter, writePlaybackReport, type PlaybackResult } from './playbackPrefilter.js';
import { APPLY_ORDER, shouldPublish } from './order.js';
import {
  accessRulesStage, achievementsStage, assetReferences, attachFoldersStage, brandingStage, doneEntriesDiffering, foldersStage, hubStage, legacySegmentsGating,
  navigationStage, pageDraftsStage, pageTreesStage, playlistsStage, removalsStage, segmentsStage, tagsStage, spacesStage,
  type StageContext,
} from './stages.js';
import type { LedgerHeader } from '../ledger/schema.js';

export interface ApplyOptions {
  planPath: string;
  profileName: string;
  mode: 'fresh' | 'upsert';
  dryRun: boolean;
  resumeRunId: string | null;
  checkAccess: boolean;
  assetsOnly: boolean;
  breakLock: boolean;
  allowCatalogDrift: boolean;
  cleanupOrphans: boolean;
  confirm: boolean;
  /** Register and copy nothing; record every asset as pending-copy, public images as legacy-linked. */
  skipAssets: boolean;
  /** Overrides the plan's hub slug; the hub lives at `${profile.hubBase}/${slug}`. */
  hubSlug: string | null;
  /** Publish pages the fail-closed rule would hold, and list them as published-ungated. */
  publishHeld: boolean;
  /** With --resume: accept a plan whose hash differs from the ledger's, after a mapper fix. */
  acceptPlanChange: boolean;
  /** With --accept-plan-change: page trees may differ; they are rewritten and republished. Every other kind must still match. */
  rewritePages: boolean;
}

/** Every entity kind apply may touch, checked against docs/contracts.md at startup. */
const MUTATED_ENTITIES: EntityKind[] = [
  'hub', 'page', 'playlist', 'folder', 'asset', 'space', 'achievement', 'segment',
  'tag', 'accessRule', 'navigation',
];

export async function runApply(options: ApplyOptions): Promise<string> {
  if (options.mode === 'upsert') {
    throw new Error('--mode upsert is M3; only --mode fresh is implemented');
  }
  if (options.assetsOnly && !options.resumeRunId) {
    throw new Error('--assets-only needs --resume <runId>: it copies what that run left pending-copy or legacy-linked');
  }
  if (options.assetsOnly && options.skipAssets) {
    throw new Error('--assets-only and --skip-assets contradict each other');
  }

  const envBase = loadEnv('.env', { require: ['s3', 'cdn', 'logins'] });
  const profile = loadProfile(options.profileName, targetOf(envBase));
  const plan: Plan = readPlan(options.planPath);
  if (options.hubSlug) {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(options.hubSlug)) {
      throw new Error(`--hub-slug "${options.hubSlug}" is not a valid slug (lowercase alphanumerics, dashes, underscores)`);
    }
    plan.hub.slug = options.hubSlug;
  }
  const hubUrl = `${profile.hubBase.replace(/\/$/, '')}/${plan.hub.slug}`;

  // The contracts gate: refuse before any mutation if a contract is missing.
  const contracts = loadContracts('docs/contracts.md');
  for (const entity of MUTATED_ENTITIES) assertContract(contracts, entity);

  const { catalog, digest } = await fetchCatalog(profile.apiBase);
  if (digest !== plan.catalogDigest && !options.allowCatalogDrift) {
    throw new Error(
      `the plan was mapped against catalog ${plan.catalogVersion} (${plan.catalogDigest}) but the target serves ${catalog.meta.catalogVersion} (${digest}). Re-run map, or pass --allow-catalog-drift.`,
    );
  }

  const runId = options.resumeRunId ?? `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const dir = ledgerDir(profile.name, plan.legacyHubId);
  const header: LedgerHeader = {
    ledgerVersion: 1,
    toolVersion: TOOL_VERSION,
    sourceHost: plan.sourceHost,
    legacyHubId: plan.legacyHubId,
    profileName: profile.name,
    targetApiBase: profile.apiBase,
    targetTeamId: profile.teamId,
    targetHubId: null,
    runId,
    planHash: planHash(plan),
  };

  if (options.dryRun) {
    // A dry run reads the plan and the public catalog only; no secrets are needed.
    let linkable: Set<string> | undefined;
    if (options.skipAssets) {
      // Real prefilter answers, so the report says how many public images actually link.
      linkable = new Set<string>();
      for (const asset of linkCandidates(plan)) {
        const results = await playbackPrefilter(asset.cdnUrl);
        if (results.length > 0 && results.every((r) => r.ok)) linkable.add(asset.cdnUrl);
      }
    }
    const operations = planOperations(plan, { skipAssets: options.skipAssets, linkable, publishHeld: options.publishHeld });
    process.stdout.write(`${renderDryRun(operations)}\n`);
    process.stdout.write(`hub URL: ${hubUrl}\n`);
    return runId;
  }

  if (plan.assetsPinned === false) {
    throw new Error(
      'the plan came from a bundle captured with extract --skip-s3, so its asset identities are unpinned. Run extract --s3-only <bundle>, then map again, before applying.',
    );
  }

  const env = withProfileLogins(envBase, profile);
  logger.setSecrets(secretsOf(env));
  const auth = await resolveApiAuth(profile, env);
  logger.setSecrets([...secretsOf(env), auth.token]);
  const apiKey = auth.token;
  const budget = Budget.open(budgetIdentity(profile.teamId, auth.budgetSubject));
  const api = new ApiClient({ profile, apiKey, budget });
  const cli = new MioCli(profile);

  const s3: S3Ops = s3OpsFor(principalsFromEnv(env, profile.region), profile.bucket);

  if (options.checkAccess) {
    const probe = [...plan.assets]
      .filter((a) => !a.isVideo)
      .sort((a, b) => a.sizeBytes - b.sizeBytes)[0];
    if (!probe) throw new Error('the plan has no non-video asset to use as a copy probe');
    await checkAccess({ probe, s3, api, teamId: profile.teamId, bucket: profile.bucket, cdnBase: profile.cdnBase, cdnBaseConfirmed: profile.cdnBaseConfirmed });
    logger.info('apply --check-access passed; no mutation was attempted');
    return runId;
  }

  if (options.cleanupOrphans) {
    const store = LedgerStore.open(dir, options.resumeRunId ?? runId);
    const orphans = findOrphans(store, 24 * 60 * 60 * 1000);
    if (!options.confirm) {
      logger.info('cleanup-orphans would delete these allocated-but-unverified rows; rerun with --confirm', {
        count: orphans.length,
        markers: orphans.map((o) => o.marker),
      });
      return runId;
    }
    const deleted = await deleteOrphans(store, orphans, async (fileId) => {
      await api.delete(`/api/v1/teams/${profile.teamId}/files/${fileId}`);
    });
    logger.info('cleanup-orphans finished', { deleted });
    return runId;
  }

  assertLedgerClean(dir);
  await preflight({ profile, apiKey, cli, api });

  const store = options.resumeRunId
    ? LedgerStore.openForResume(dir, runId, header, { acceptPlanChange: options.acceptPlanChange })
    : LedgerStore.create(dir, header);

  const lock = Lock.acquire(dir, runId, { breakLock: options.breakLock });
  const heartbeat = setInterval(() => lock.heartbeat(), HEARTBEAT_INTERVAL_MS);

  const assetRunner: AssetRunner = {
    async register(asset, marker) {
      const body = {
        data: {
          type: 'files',
          attributes: {
            title: asset.title,
            asset_kind: (asset.mimeType ?? '').includes('pdf') ? 'pdf' : 'document',
            mime_type: asset.mimeType ?? 'application/octet-stream',
            size_bytes: asset.sizeBytes,
            original_filename: asset.sourceKey.split('/').pop() ?? asset.title,
            visibility: asset.visibility === 'public' ? 'public' : 'private',
            description: marker,
          },
        },
      };
      const response = await api.post<{ data: { id: string; attributes: { media_id: string } } }>(
        `/api/v1/admin/teams/${profile.teamId}/files/synthetic`,
        body,
      );
      return { fileId: response.data.id, mediaId: response.data.attributes.media_id };
    },
    async listByMarker(marker) {
      const found: string[] = [];
      for await (const row of api.listAll<{ id: string; attributes: { description?: string | null } }>(
        `/api/v1/teams/${profile.teamId}/files`,
      )) {
        if (row.attributes?.description === marker) found.push(row.id);
      }
      return found;
    },
  };

  const playbackResults: PlaybackResult[] = [];
  const runWarnings: Array<{ type: string; reason: string }> = [];
  const ctx: StageContext = {
    plan, store, api, profile, runId,
    hubId: store.header.targetHubId ?? '',
    playbackOk: new Set<string>(),
    publishedUngated: [],
    warn: (reason, type = 'approximated') => { runWarnings.push({ type, reason }); logger.warn(reason, { type }); },
  };
  const hubOrigins = plan.legacyHubDomain
    ? [`https://${plan.legacyHubDomain}`, `http://${plan.legacyHubDomain}`]
    : [];
  let mappedRuleTargets = new Set<string>();
  const removedPages: Array<{ legacyPageId: number; v3Id: string; reason: string }> = [];
  const references = assetReferences(plan);

  if (options.resumeRunId && store.header.planHash !== header.planHash) {
    // --accept-plan-change: every entry already done must hash identically under the new plan.
    const allDiffering = doneEntriesDiffering(ctx);
    const differing = options.rewritePages ? allDiffering.filter((d) => d.kind !== 'page') : allDiffering;
    if (options.rewritePages) {
      logger.warn('--rewrite-pages: page trees that differ under the new plan will be rewritten and republished', {
        pages: allDiffering.filter((d) => d.kind === 'page').length,
      });
    }
    if (differing.length > 0) {
      lock.release();
      clearInterval(heartbeat);
      throw new Error(
        `refusing --accept-plan-change: ${differing.length} done entr${differing.length === 1 ? 'y' : 'ies'} would differ under the new plan, which would leave the hub on two plans: ${differing.map((d) => `${d.kind} ${d.legacyId} (${d.field})`).join(', ')}`,
      );
    }
    logger.warn('resuming with a changed plan; every done entry hashes identically under it', {
      previousPlanHash: store.header.planHash,
      planHash: header.planHash,
    });
    store.acceptPlanChange(header.planHash);
  }
  // --assets-only copies, then rewrites what points at the copies: folders, playlist items, page trees.
  const stages = options.assetsOnly
    ? APPLY_ORDER.filter((stage) => stage === 'assets' || stage === 'playlists' || stage === 'pageTrees')
    : APPLY_ORDER;
  if (options.assetsOnly) {
    if (!ctx.hubId) throw new Error(`run ${runId} has no target hub id; nothing to rewrite`);
    mappedRuleTargets = new Set(
      store.all().filter((e) => e.kind === 'accessRule' && e.state === 'done').map((e) => e.marker),
    );
  }

  try {
    for (const stage of stages) {
      logger.info('stage starting', { stage, runId });
      switch (stage) {
        case 'hub':
          ctx.hubId = await hubStage(ctx);
          break;
        case 'branding':
          await brandingStage(ctx);
          break;
        case 'tags':
          await tagsStage(ctx);
          break;
        case 'segments':
          await segmentsStage(ctx);
          break;
        case 'accessRules':
          mappedRuleTargets = await accessRulesStage(ctx);
          break;
        case 'folders':
          await foldersStage(ctx);
          break;
        case 'assets': {
          // The prefilter gates every legacy URL before it can reach a page node.
          for (const asset of linkCandidates(plan, options.skipAssets)) {
            const results = await playbackPrefilter(asset.cdnUrl);
            playbackResults.push(...results);
            if (results.length > 0 && results.every((r) => r.ok)) ctx.playbackOk.add(asset.cdnUrl);
          }
          await runAssetStage({
            assets: plan.assets, store, s3, runner: assetRunner,
            teamId: profile.teamId, bucket: profile.bucket, sourceHost: plan.sourceHost,
            mode: options.assetsOnly ? 'assets-only' : options.skipAssets ? 'skip' : 'full',
            references, playbackOk: ctx.playbackOk,
            warn: (reason, type) => ctx.warn(reason, type),
          });
          await attachFoldersStage(ctx);
          break;
        }
        case 'playlists':
          await playlistsStage(ctx);
          break;
        case 'pageDrafts':
          await pageDraftsStage(ctx);
          break;
        case 'pageTrees':
          await pageTreesStage(ctx, mappedRuleTargets, options.publishHeld);
          break;
        case 'removals':
          removedPages.push(...await removalsStage(ctx));
          break;
        case 'navigation':
          await navigationStage(ctx, hubOrigins);
          break;
        case 'spaces':
          await spacesStage(ctx);
          break;
        case 'achievements':
          await achievementsStage(ctx);
          break;
      }
      logger.info('stage complete', { stage });
    }

    writeRunWarnings(runWarnings, `runs/${runId}`);
    writeFileSync(join(`runs/${runId}`, 'published-ungated.json'), JSON.stringify(ctx.publishedUngated ?? [], null, 2), 'utf8');
    writeFileSync(join(`runs/${runId}`, 'removed-pages.json'), JSON.stringify(removedPages, null, 2), 'utf8');
    if ((ctx.publishedUngated ?? []).length > 0) {
      logger.warn('pages published although legacy gated them (--publish-held)', { pages: ctx.publishedUngated });
    }
    writePlaybackReport(playbackResults, `runs/${runId}`);
    logger.info('apply finished', { runId, ledger: store.path });
    return runId;
  } catch (error) {
    logger.error('apply stopped', {
      runId,
      error: error instanceof Error ? error.message : String(error),
      ledger: store.path,
      hint: `nothing was rolled back. Fix the cause, then: apply --profile ${profile.name} --plan ${options.planPath} --resume ${runId}`,
    });
    throw error;
  } finally {
    clearInterval(heartbeat);
    lock.release();
  }
}

function writeRunWarnings(warnings: Array<{ type: string; reason: string }>, runDir: string): void {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'apply-warnings.json'), JSON.stringify(warnings, null, 2), 'utf8');
}

/** Public assets a page references that may play or render straight from the legacy CDN. */
function linkCandidates(plan: Plan, includeImages = true): PlanAsset[] {
  const onPage = new Set<string>();
  for (const [key, refs] of assetReferences(plan)) if (refs.some((r) => r.kind === 'page-node')) onPage.add(key);
  return plan.assets.filter(
    (a) => a.visibility === 'public' && onPage.has(`${a.legacyMediaId}/${a.variant}`) && (a.isVideo || (includeImages && isImage(a))),
  );
}

function planOperations(plan: Plan, mode: { skipAssets: boolean; linkable?: Set<string>; publishHeld?: boolean } = { skipAssets: false }): Operation[] {
  const operations: Operation[] = [];
  let order = 0;
  operations.push({ order: order++, kind: 'hub.create', summary: `create hub "${plan.hub.title}" at slug ${plan.hub.slug}`, detail: { slug: plan.hub.slug } });
  operations.push({ order: order++, kind: 'hub.branding', summary: `write ${Object.keys(plan.branding).length} branding keys`, detail: plan.branding });
  for (const tag of plan.tags) {
    operations.push({ order: order++, kind: 'tag.create', summary: `create or adopt tag "${tag.name}" (${tag.slug})`, detail: { legacyTagId: tag.legacyTagId } });
  }
  const createdSegments = new Set<number>();
  for (const segment of plan.segments) {
    if (segment.tree) {
      createdSegments.add(segment.legacySegmentId);
      operations.push({ order: order++, kind: 'segment.create', summary: `create segment "${segment.name}" with ${segment.tree.groups.length} group${segment.tree.groups.length === 1 ? '' : 's'}`, detail: { legacySegmentId: segment.legacySegmentId } });
    } else {
      operations.push({ order: order++, kind: 'segment.skip', summary: `skip segment "${segment.name}": ${segment.unmappedReason ?? 'no V3 condition mapping'}`, detail: { legacySegmentId: segment.legacySegmentId } });
    }
  }
  // A rule maps when every segment it names is created; otherwise its page holds (or publishes ungated).
  const mappedTargets = new Set<string>();
  for (const rule of plan.accessRules) {
    const missing = rule.conditions
      .filter((c) => c.condition_type === 'in_segment')
      .map((c) => Number(/^ledger:\/\/segment\/(\d+)$/.exec(String(c.condition_data['segment_id'] ?? ''))?.[1] ?? NaN))
      .filter((id) => !createdSegments.has(id));
    if (missing.length > 0) {
      operations.push({ order: order++, kind: 'accessRule.skip', summary: `skip the gate on ${rule.targetKind} ${rule.targetRef}: legacy segment ${missing.join(', ')} is not created`, detail: { conditions: rule.conditions.length } });
    } else {
      operations.push({ order: order++, kind: 'accessRule.create', summary: `gate ${rule.targetKind} ${rule.targetRef} (target_type node, id stamped on the section)`, detail: { conditions: rule.conditions.length } });
      mappedTargets.add(rule.targetRef);
    }
  }
  for (const folder of plan.folders) {
    operations.push({ order: order++, kind: 'folder.create', summary: `create folder "${folder.name}"`, detail: { legacyFolderId: folder.legacyFolderId } });
  }
  const candidates = new Set(linkCandidates(plan).map((a) => a.cdnUrl));
  for (const asset of plan.assets) {
    if (mode.skipAssets) {
      const linked = candidates.has(asset.cdnUrl) && (mode.linkable?.has(asset.cdnUrl) ?? false);
      operations.push({
        order: order++,
        kind: linked ? 'asset.legacy-link' : asset.isVideo ? 'asset.pending-import' : 'asset.pending-copy',
        summary: linked
          ? `link ${asset.legacyMediaId}/${asset.variant} to its legacy CDN URL (prefilter passed)`
          : `record ${asset.legacyMediaId}/${asset.variant} as ${asset.isVideo ? 'pending-import' : 'pending-copy'}`,
        detail: { sourceKey: asset.sourceKey, visibility: asset.visibility, mimeType: asset.mimeType },
      });
      continue;
    }
    operations.push({
      order: order++,
      kind: asset.isVideo ? 'asset.pending' : 'asset.copy',
      summary: asset.isVideo
        ? `record video ${asset.legacyMediaId}/${asset.variant} as pending-import`
        : `register and copy ${asset.legacyMediaId}/${asset.variant} (${asset.sizeBytes} bytes)`,
      detail: { sourceKey: asset.sourceKey, visibility: asset.visibility },
    });
  }
  for (const playlist of plan.playlists) {
    operations.push({ order: order++, kind: 'playlist.create', summary: `create playlist "${playlist.title}" with ${playlist.items.length} items`, detail: { legacyPlaylistId: playlist.legacyPlaylistId } });
  }
  for (const page of plan.pages) {
    operations.push({ order: order++, kind: 'page.create', summary: `create draft page /${page.slug}`, detail: { privacy: page.privacy } });
  }
  for (const excluded of plan.excludedPages) {
    operations.push({ order: order++, kind: 'page.exclude', summary: `leave out legacy ${excluded.legacyType} page "${excluded.title}" (V3 serves /${excluded.route}); a copy from an earlier run is deleted on resume`, detail: { legacyPageId: excluded.legacyPageId } });
  }
  for (const page of plan.pages) {
    operations.push({ order: order++, kind: 'page.tree', summary: `write the tree for /${page.slug}`, detail: { nodes: countNodes(page.tree) } });
    if (shouldPublish(page, mappedTargets)) {
      operations.push({ order: order++, kind: 'page.publish', summary: `publish /${page.slug}`, detail: {} });
    } else if (mode.publishHeld) {
      const legacySegments = legacySegmentsGating(plan, page);
      operations.push({ order: order++, kind: 'page.publish-ungated', summary: `publish /${page.slug} UNGATED; legacy gated it by: ${legacySegments.join('; ')}`, detail: { legacySegments } });
    } else {
      operations.push({ order: order++, kind: 'page.hold', summary: `leave /${page.slug} unpublished: a restricted section has no mapped rule`, detail: { restricted: page.restrictedSectionNodeIds } });
    }
  }
  const home = plan.pages.find((p) => p.isHomepage);
  operations.push({ order: order++, kind: 'navigation.write', summary: `write ${plan.navigation.header.length} header and ${plan.navigation.footer.length} footer items${home ? ` and point the hub homepage at /${home.slug}` : ''}`, detail: {} });
  for (const space of plan.spaces) {
    operations.push({ order: order++, kind: 'space.create', summary: `create space "${space.name}"`, detail: { accessLevel: space.accessLevel } });
  }
  for (const achievement of plan.achievements) {
    operations.push({ order: order++, kind: 'achievement.create', summary: `create achievement "${achievement.title}"`, detail: {} });
  }
  return operations;
}

function countNodes(node: { children?: Array<{ children?: unknown[] }> }): number {
  let count = 1;
  for (const child of node.children ?? []) count += countNodes(child as { children?: Array<{ children?: unknown[] }> });
  return count;
}
