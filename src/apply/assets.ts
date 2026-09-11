import { logger } from '../log/logger.js';
import { assetMarker, generationHash } from '../ledger/marker.js';
import type { LedgerStore } from '../ledger/store.js';
import type { AssetLedgerFields, LedgerEntry } from '../ledger/schema.js';
import type { PlanAsset } from '../map/plan.js';
import { contentHash } from '../map/plan.js';
import { copyObject, destinationKeyFor, verifyCopy, type S3Ops } from './s3.js';

export interface AssetRunner {
  register(asset: PlanAsset, marker: string): Promise<{ fileId: string; mediaId: string }>;
  listByMarker(marker: string): Promise<string[]>;
}

function fields(asset: PlanAsset, patch: Partial<AssetLedgerFields> = {}): AssetLedgerFields {
  return {
    sourceBucket: asset.sourceBucket,
    sourceKey: asset.sourceKey,
    sourceEtag: asset.etag,
    sourceVersionId: asset.versionId,
    sourceSizeBytes: asset.sizeBytes,
    sourceChecksumCrc64Nvme: asset.checksumCrc64Nvme,
    v3MediaId: null,
    v3FileId: null,
    destinationKey: null,
    destinationSizeBytes: null,
    destinationChecksumCrc64Nvme: null,
    visibility: asset.visibility,
    legacyCdnUrl: asset.cdnUrl,
    importJobId: null,
    ...patch,
  };
}

function entryFor(
  asset: PlanAsset,
  marker: string,
  runId: string,
  state: LedgerEntry['state'],
  assetFields: AssetLedgerFields,
  v3Id: string | null,
  createdAt: string,
): LedgerEntry {
  return {
    legacyTable: 'media',
    legacyId: asset.legacyMediaId,
    kind: 'asset',
    variant: asset.variant,
    marker,
    v3Id,
    state,
    runId,
    createdAt,
    updatedAt: new Date().toISOString(),
    contentHash: contentHash(asset),
    referenceHash: null,
    revisionToken: null,
    asset: assetFields,
  };
}

export async function runAssetStage(opts: {
  assets: PlanAsset[];
  store: LedgerStore;
  s3: S3Ops;
  runner: AssetRunner;
  teamId: string;
  bucket: string;
  sourceHost: string;
}): Promise<void> {
  const runId = opts.store.header.runId;

  for (const asset of opts.assets) {
    const gen = generationHash(asset.sourceBucket, asset.sourceKey, asset.versionId ?? asset.etag);
    const marker = assetMarker(opts.sourceHost, asset.legacyMediaId, asset.variant, gen);
    const existing = opts.store.find(marker);
    if (existing?.state === 'verified' || existing?.state === 'legacy-linked') continue;

    const createdAt = existing?.createdAt ?? new Date().toISOString();

    // Video waits for the backend import endpoint (spec section 9).
    if (asset.isVideo) {
      opts.store.upsert(
        entryFor(asset, marker, runId, 'pending-import', fields(asset), null, createdAt),
      );
      logger.info('asset recorded as pending-import', {
        legacyMediaId: asset.legacyMediaId, variant: asset.variant,
      });
      continue;
    }

    opts.store.upsert(entryFor(asset, marker, runId, 'intent', fields(asset), null, createdAt));

    // Reuse across runs: an asset whose marker already exists on the team is adopted.
    const adopted = await opts.runner.listByMarker(marker);
    let fileId: string;
    let mediaId: string;
    if (adopted.length === 1) {
      fileId = adopted[0] as string;
      mediaId = existing?.asset?.v3MediaId ?? fileId;
      logger.info('asset adopted from an earlier run', { marker, fileId });
    } else if (adopted.length > 1) {
      throw new Error(
        `marker ${marker} matches ${adopted.length} files (${adopted.join(', ')}); run: ledger resolve ${marker} --adopt <id>`,
      );
    } else {
      const registered = await opts.runner.register(asset, marker);
      fileId = registered.fileId;
      mediaId = registered.mediaId;
    }

    const destinationKey = destinationKeyFor(opts.teamId, mediaId);
    opts.store.upsert(
      entryFor(
        asset, marker, runId, 'allocated',
        fields(asset, { v3FileId: fileId, v3MediaId: mediaId, destinationKey }),
        fileId, createdAt,
      ),
    );

    const source = {
      bucket: asset.sourceBucket,
      key: asset.sourceKey,
      versionId: asset.versionId,
      etag: asset.etag,
      sizeBytes: asset.sizeBytes,
    };
    const destination = { bucket: opts.bucket, key: destinationKey, contentType: asset.mimeType };

    await copyObject(opts.s3, source, destination);
    opts.store.upsert(
      entryFor(
        asset, marker, runId, 'copied',
        fields(asset, { v3FileId: fileId, v3MediaId: mediaId, destinationKey }),
        fileId, createdAt,
      ),
    );

    const verified = await verifyCopy(opts.s3, source, destination, asset.checksumCrc64Nvme);
    if (!verified.ok) {
      throw new Error(
        `asset ${asset.legacyMediaId}/${asset.variant} failed verification: ${verified.reason ?? 'unknown reason'}`,
      );
    }
    opts.store.upsert(
      entryFor(
        asset, marker, runId, 'verified',
        fields(asset, {
          v3FileId: fileId,
          v3MediaId: mediaId,
          destinationKey,
          destinationSizeBytes: verified.destinationSizeBytes,
          destinationChecksumCrc64Nvme: verified.destinationChecksum,
        }),
        fileId, createdAt,
      ),
    );
  }
}
/**
 * An allocated-but-never-verified synthetic row is referenced by no page or
 * playlist, so it is unreachable by members. It still costs storage and clutters
 * every marker scan, so it is worth deleting once no run could still be working
 * on it. `copied` is deliberately excluded: verification may simply not have run.
 */
export function findOrphans(
  store: LedgerStore,
  olderThanMs: number,
  now = new Date(),
): LedgerEntry[] {
  const cutoff = now.getTime() - olderThanMs;
  return store
    .all()
    .filter((entry) => entry.kind === 'asset' && entry.state === 'allocated')
    .filter((entry) => Date.parse(entry.updatedAt) < cutoff);
}

export async function deleteOrphans(
  store: LedgerStore,
  orphans: LedgerEntry[],
  deleteFile: (fileId: string) => Promise<void>,
): Promise<number> {
  let deleted = 0;
  for (const orphan of orphans) {
    if (!orphan.v3Id) continue;
    await deleteFile(orphan.v3Id);
    store.upsert({
      ...orphan,
      v3Id: null,
      state: 'intent',
      updatedAt: new Date().toISOString(),
      asset: orphan.asset
        ? { ...orphan.asset, v3FileId: null, v3MediaId: null, destinationKey: null }
        : null,
    });
    deleted += 1;
    logger.info('deleted an allocated-but-unverified asset', {
      marker: orphan.marker, fileId: orphan.v3Id,
    });
  }
  return deleted;
}
