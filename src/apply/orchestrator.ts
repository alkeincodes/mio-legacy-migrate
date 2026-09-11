import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HeadObjectCommand, CopyObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { loadEnv, secretsOf } from '../config/env.js';
import { resolveApiAuth } from './auth.js';
import { loadProfile } from '../config/profile.js';
import { logger } from '../log/logger.js';
import { TOOL_VERSION } from '../version.js';
import { readPlan, planHash, type Plan } from '../map/plan.js';
import { fetchCatalog } from '../map/catalog.js';
import { assertContract, loadContracts, type EntityKind } from './contracts.js';
import { Budget, budgetIdentity } from './budget.js';
import { ApiClient } from './api.js';
import { MioCli } from './mioCli.js';
import { preflight } from './preflight.js';
import { renderDryRun, type Operation } from './dryRun.js';
import { LedgerStore, ledgerDir } from '../ledger/store.js';
import { Lock, assertLedgerClean, HEARTBEAT_INTERVAL_MS } from '../ledger/lock.js';
import { deleteOrphans, findOrphans, runAssetStage, type AssetRunner } from './assets.js';
import { checkAccess } from './checkAccess.js';
import { type S3Ops } from './s3.js';
import { playbackPrefilter, writePlaybackReport, type PlaybackResult } from './playbackPrefilter.js';
import { APPLY_ORDER, shouldPublish } from './order.js';
import {
  accessRulesStage, achievementsStage, attachFoldersStage, brandingStage, foldersStage, hubStage,
  navigationStage, pageDraftsStage, pageTreesStage, playlistsStage, segmentsStage, spacesStage,
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
}

/** Every entity kind apply may touch, checked against docs/contracts.md at startup. */
const MUTATED_ENTITIES: EntityKind[] = [
  'hub', 'page', 'playlist', 'folder', 'asset', 'space', 'achievement', 'segment',
  'accessRule', 'navigation',
];

export async function runApply(options: ApplyOptions): Promise<string> {
  if (options.mode === 'upsert') {
    throw new Error('--mode upsert is M3; only --mode fresh is implemented');
  }
  if (options.assetsOnly) {
    throw new Error('--assets-only requires the backend import endpoint (spec section 9); not available in M1');
  }

  const profile = loadProfile(options.profileName);
  const plan: Plan = readPlan(options.planPath);

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
    const operations = planOperations(plan);
    process.stdout.write(`${renderDryRun(operations)}\n`);
    return runId;
  }

  if (plan.assetsPinned === false) {
    throw new Error(
      'the plan came from a bundle captured with extract --skip-s3, so its asset identities are unpinned. Run extract --s3-only <bundle>, then map again, before applying.',
    );
  }

  const env = loadEnv('.env', { require: ['s3', 'cdn', 'logins'] });
  logger.setSecrets(secretsOf(env));
  const auth = await resolveApiAuth(profile, env);
  logger.setSecrets([...secretsOf(env), auth.token]);
  const apiKey = auth.token;
  const budget = Budget.open(budgetIdentity(profile.teamId, auth.budgetSubject));
  const api = new ApiClient({ profile, apiKey, budget });
  const cli = new MioCli(profile);

  const s3Client = new S3Client({
    region: profile.region,
    credentials: { accessKeyId: env.awsAccessKeyId, secretAccessKey: env.awsSecretAccessKey },
  });
  const s3: S3Ops = {
    async head(bucket, key) {
      try {
        const out = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: 'ENABLED' }));
        return {
          sizeBytes: out.ContentLength ?? 0,
          etag: out.ETag ?? '',
          versionId: out.VersionId ?? null,
          checksumCrc64Nvme: out.ChecksumCRC64NVME ?? null,
          contentType: out.ContentType ?? null,
        };
      } catch {
        return null;
      }
    },
    async copy(source, destination) {
      const copySource = `${source.bucket}/${encodeURIComponent(source.key)}${source.versionId ? `?versionId=${source.versionId}` : ''}`;
      await s3Client.send(new CopyObjectCommand({
        Bucket: destination.bucket,
        Key: destination.key,
        CopySource: copySource,
        ...(source.versionId ? {} : { CopySourceIfMatch: source.etag }),
        ChecksumAlgorithm: 'CRC64NVME',
        ContentType: destination.contentType ?? undefined,
        MetadataDirective: 'REPLACE',
      }));
    },
    async multipartCopy(source, destination) {
      throw new Error(
        `object ${source.bucket}/${source.key} is ${source.sizeBytes} bytes and needs a multipart copy, which is not wired up. Copy it by hand with: aws s3 cp s3://${source.bucket}/${source.key} s3://${destination.bucket}/${destination.key} --copy-props metadata-directive`,
      );
    },
    async abortIncompleteUploads() { return 0; },
    async delete(bucket, key) {
      await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };

  if (options.checkAccess) {
    const probe = [...plan.assets]
      .filter((a) => !a.isVideo)
      .sort((a, b) => a.sizeBytes - b.sizeBytes)[0];
    if (!probe) throw new Error('the plan has no non-video asset to use as a copy probe');
    await checkAccess({ probe, s3, api, teamId: profile.teamId, bucket: profile.bucket });
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
    ? LedgerStore.openForResume(dir, runId, header)
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
  const runWarnings: string[] = [];
  const ctx: StageContext = {
    plan, store, api, profile, runId,
    hubId: store.header.targetHubId ?? '',
    playbackOk: new Set<string>(),
    warn: (reason) => { runWarnings.push(reason); logger.warn(reason); },
  };
  const hubOrigins = plan.legacyHubDomain
    ? [`https://${plan.legacyHubDomain}`, `http://${plan.legacyHubDomain}`]
    : [];
  let mappedRuleTargets = new Set<string>();

  try {
    for (const stage of APPLY_ORDER) {
      logger.info('stage starting', { stage, runId });
      switch (stage) {
        case 'hub':
          ctx.hubId = await hubStage(ctx);
          break;
        case 'branding':
          await brandingStage(ctx);
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
          for (const asset of plan.assets.filter((a) => a.isVideo && a.visibility === 'public')) {
            const results = await playbackPrefilter(asset.cdnUrl);
            playbackResults.push(...results);
            if (results.length > 0 && results.every((r) => r.ok)) ctx.playbackOk.add(asset.cdnUrl);
          }
          await runAssetStage({
            assets: plan.assets, store, s3, runner: assetRunner,
            teamId: profile.teamId, bucket: profile.bucket, sourceHost: plan.sourceHost,
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
          await pageTreesStage(ctx, mappedRuleTargets);
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

function writeRunWarnings(warnings: string[], runDir: string): void {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'apply-warnings.json'), JSON.stringify(warnings, null, 2), 'utf8');
}

function planOperations(plan: Plan): Operation[] {
  const operations: Operation[] = [];
  let order = 0;
  operations.push({ order: order++, kind: 'hub.create', summary: `create hub "${plan.hub.title}" at slug ${plan.hub.slug}`, detail: { slug: plan.hub.slug } });
  operations.push({ order: order++, kind: 'hub.branding', summary: `write ${Object.keys(plan.branding).length} branding keys`, detail: plan.branding });
  for (const segment of plan.segments) {
    operations.push({ order: order++, kind: 'segment.skip', summary: `skip segment "${segment.name}": no V3 condition mapping in M1`, detail: { legacySegmentId: segment.legacySegmentId } });
  }
  // Every M1 rule is in_segment, and no segment is created, so no rule maps and its page holds.
  const mappedTargets = new Set<string>();
  for (const rule of plan.accessRules) {
    const needsSegment = rule.conditions.some((c) => c.condition_type === 'in_segment');
    if (needsSegment) {
      operations.push({ order: order++, kind: 'accessRule.skip', summary: `skip the gate on ${rule.targetKind} ${rule.targetRef}: its segment is not created in M1`, detail: { conditions: rule.conditions.length } });
    } else {
      operations.push({ order: order++, kind: 'accessRule.create', summary: `gate ${rule.targetKind} ${rule.targetRef}`, detail: { conditions: rule.conditions.length } });
      mappedTargets.add(rule.targetRef);
    }
  }
  for (const folder of plan.folders) {
    operations.push({ order: order++, kind: 'folder.create', summary: `create folder "${folder.name}"`, detail: { legacyFolderId: folder.legacyFolderId } });
  }
  for (const asset of plan.assets) {
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
  for (const page of plan.pages) {
    operations.push({ order: order++, kind: 'page.tree', summary: `write the tree for /${page.slug}`, detail: { nodes: countNodes(page.tree) } });
    if (shouldPublish(page, mappedTargets)) {
      operations.push({ order: order++, kind: 'page.publish', summary: `publish /${page.slug}`, detail: {} });
    } else {
      operations.push({ order: order++, kind: 'page.hold', summary: `leave /${page.slug} unpublished: a restricted section has no mapped rule`, detail: { restricted: page.restrictedSectionNodeIds } });
    }
  }
  operations.push({ order: order++, kind: 'navigation.write', summary: `write ${plan.navigation.header.length} header and ${plan.navigation.footer.length} footer items`, detail: {} });
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
