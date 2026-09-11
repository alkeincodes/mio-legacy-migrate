import { MORPH_FILE, type LegacyFile, type LegacyHubFile, type LegacyMedia } from './queries.js';
import { cdnUrlFor, variantsOf } from './mediaPaths.js';

export type AssetVisibility = 'public' | 'restricted';

export interface LegacyGate {
  kind: 'segment' | 'privacy';
  segmentId?: number;
  value?: string;
}

export interface AssetManifestEntry {
  legacyFileId: number;
  legacyMediaId: number;
  variant: string;
  disk: string;
  sourceBucket: string;
  sourceKey: string;
  sizeBytes: number;
  etag: string;
  versionId: string | null;
  checksumCrc64Nvme: string | null;
  mimeType: string | null;
  cdnUrl: string;
  folderIds: number[];
  playlistIds: number[];
  visibility: AssetVisibility;
  gates: LegacyGate[];
  /** Always empty in M1: legacy captions live in the transcript tables, out of scope. */
  captionUrls: string[];
}

export interface HeadResult {
  sizeBytes: number;
  etag: string;
  versionId: string | null;
  checksumCrc64Nvme: string | null;
  contentType: string | null;
}

export type HeadObjectFn = (bucket: string, key: string) => Promise<HeadResult | null>;

export interface ManifestInput {
  files: LegacyFile[];
  media: LegacyMedia[];
  hubFiles: LegacyHubFile[];
  playlistItems: Array<{ file_id: number; playlist_id: number }>;
  publicPlaylistIds: Set<number>;
  fileGates: Map<number, LegacyGate[]>;
  bucket: string;
  s3Url: string;
  cdnUrl: string;
}

export async function buildManifest(
  input: ManifestInput,
  head: HeadObjectFn,
): Promise<{
  entries: AssetManifestEntry[];
  missing: Array<{ legacyMediaId: number; variant: string; key: string }>;
}> {
  const filesById = new Map(input.files.map((f) => [f.id, f]));
  const playlistsByFile = new Map<number, number[]>();
  for (const item of input.playlistItems) {
    playlistsByFile.set(item.file_id, [...(playlistsByFile.get(item.file_id) ?? []), item.playlist_id]);
  }
  const hubFileById = new Map(input.hubFiles.map((hf) => [hf.file_id, hf]));

  const entries: AssetManifestEntry[] = [];
  const missing: Array<{ legacyMediaId: number; variant: string; key: string }> = [];

  for (const media of input.media) {
    if (media.model_type !== MORPH_FILE) continue;
    const file = filesById.get(media.model_id);
    if (!file) continue;

    const playlistIds = playlistsByFile.get(file.id) ?? [];
    const hubFile = hubFileById.get(file.id);
    const gates = input.fileGates.get(file.id) ?? [];

    // Public anywhere in legacy wins, per spec 5.2.
    const inPublicPlaylist = playlistIds.some((id) => input.publicPlaylistIds.has(id));
    const explicitlyPublic = file.privacy === 'public' || hubFile?.privacy === 'public';
    const visibility: AssetVisibility =
      inPublicPlaylist || explicitlyPublic || (gates.length === 0 && !hubFile?.privacy && !file.privacy)
        ? 'public'
        : 'restricted';

    for (const variant of variantsOf(media)) {
      const result = await head(input.bucket, variant.key);
      if (!result) {
        missing.push({ legacyMediaId: media.id, variant: variant.variant, key: variant.key });
        continue;
      }
      entries.push({
        legacyFileId: file.id,
        legacyMediaId: media.id,
        variant: variant.variant,
        disk: variant.disk,
        sourceBucket: input.bucket,
        sourceKey: variant.key,
        sizeBytes: result.sizeBytes,
        etag: result.etag,
        versionId: result.versionId,
        checksumCrc64Nvme: result.checksumCrc64Nvme,
        mimeType: result.contentType ?? media.mime_type,
        cdnUrl: cdnUrlFor(variant.key, input.s3Url, input.cdnUrl),
        folderIds: file.folder_id === null ? [] : [file.folder_id],
        playlistIds,
        visibility,
        gates: visibility === 'restricted' ? gates : [],
        captionUrls: [],
      });
    }
  }

  return { entries, missing };
}

/**
 * For `extract --skip-s3`: a head that answers from the Spatie row so the
 * bundle carries every key but no S3 identity. `extract --s3-only` pins it later.
 */
export function unpinnedHeadFor(media: LegacyMedia[]): HeadObjectFn {
  const byKey = new Map<string, LegacyMedia>();
  for (const row of media) for (const variant of variantsOf(row)) byKey.set(variant.key, row);
  return async (_bucket, key) => {
    const row = byKey.get(key);
    if (!row) return null;
    return { sizeBytes: row.size, etag: '', versionId: null, checksumCrc64Nvme: null, contentType: row.mime_type };
  };
}

/** Fills the S3 identity of every manifest entry in place; returns the keys that were missing. */
export async function pinManifest(
  entries: AssetManifestEntry[],
  bucket: string,
  head: HeadObjectFn,
): Promise<Array<{ legacyMediaId: number; variant: string; key: string }>> {
  const missing: Array<{ legacyMediaId: number; variant: string; key: string }> = [];
  for (const entry of entries) {
    const result = await head(bucket, entry.sourceKey);
    if (!result) {
      missing.push({ legacyMediaId: entry.legacyMediaId, variant: entry.variant, key: entry.sourceKey });
      continue;
    }
    entry.sourceBucket = bucket;
    entry.sizeBytes = result.sizeBytes;
    entry.etag = result.etag;
    entry.versionId = result.versionId;
    entry.checksumCrc64Nvme = result.checksumCrc64Nvme;
    entry.mimeType = result.contentType ?? entry.mimeType;
  }
  return missing;
}
