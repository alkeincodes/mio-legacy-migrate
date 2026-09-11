import type { HeadResult } from '../extract/manifest.js';

export const MULTIPART_THRESHOLD_BYTES = 5 * 1024 * 1024 * 1024;

export interface CopySource {
  bucket: string;
  key: string;
  versionId: string | null;
  etag: string;
  sizeBytes: number;
}

export interface CopyDestination {
  bucket: string;
  key: string;
  contentType: string | null;
}

export interface S3Ops {
  head(bucket: string, key: string): Promise<HeadResult | null>;
  copy(source: CopySource, destination: CopyDestination): Promise<void>;
  multipartCopy(source: CopySource, destination: CopyDestination): Promise<void>;
  abortIncompleteUploads(bucket: string, key: string): Promise<number>;
  delete(bucket: string, key: string): Promise<void>;
  /** HeadBucket; lets check-access say which side is missing before a copy fails with a bare NoSuchBucket. */
  bucketExists?(bucket: string): Promise<boolean>;
}

/** app/media/storage_paths.py: {team_id}/media/{media_id}/{variant}, and register-synthetic uses "original". */
export function destinationKeyFor(teamId: string, mediaId: string): string {
  return `${teamId}/media/${mediaId}/original`;
}

/**
 * Destination keys are freshly allocated media ids, so the only object that can
 * already be there is our own earlier attempt: a matching size is adopted, any
 * other non-empty destination is an error.
 */
export async function copyObject(
  ops: S3Ops,
  source: CopySource,
  destination: CopyDestination,
): Promise<'copied' | 'adopted'> {
  const existing = await ops.head(destination.bucket, destination.key);
  if (existing) {
    if (existing.sizeBytes === source.sizeBytes) return 'adopted';
    throw new Error(
      `destination ${destination.bucket}/${destination.key} already holds an object of ${existing.sizeBytes} bytes but the source is ${source.sizeBytes}; refusing to overwrite`,
    );
  }

  if (source.sizeBytes > MULTIPART_THRESHOLD_BYTES) {
    await ops.abortIncompleteUploads(destination.bucket, destination.key);
    await ops.multipartCopy(source, destination);
    return 'copied';
  }

  await ops.copy(source, destination);
  return 'copied';
}

/**
 * Size always, plus the full-object CRC64NVME checksum when the source exposed
 * one. ETags and composite checksums are never used, because they depend on part
 * boundaries and encryption.
 */
export async function verifyCopy(
  ops: S3Ops,
  source: CopySource,
  destination: CopyDestination,
  sourceChecksum: string | null,
): Promise<{
  ok: boolean;
  reason: string | null;
  destinationChecksum: string | null;
  destinationSizeBytes: number;
}> {
  const head = await ops.head(destination.bucket, destination.key);
  if (!head) {
    return {
      ok: false,
      reason: `no object at ${destination.bucket}/${destination.key} after the copy`,
      destinationChecksum: null,
      destinationSizeBytes: 0,
    };
  }
  if (head.sizeBytes !== source.sizeBytes) {
    return {
      ok: false,
      reason: `size mismatch: source ${source.sizeBytes}, destination ${head.sizeBytes}`,
      destinationChecksum: head.checksumCrc64Nvme,
      destinationSizeBytes: head.sizeBytes,
    };
  }
  if (sourceChecksum !== null && head.checksumCrc64Nvme !== null && head.checksumCrc64Nvme !== sourceChecksum) {
    return {
      ok: false,
      reason: `full-object checksum mismatch: source ${sourceChecksum}, destination ${head.checksumCrc64Nvme}`,
      destinationChecksum: head.checksumCrc64Nvme,
      destinationSizeBytes: head.sizeBytes,
    };
  }
  return {
    ok: true,
    reason: null,
    destinationChecksum: head.checksumCrc64Nvme,
    destinationSizeBytes: head.sizeBytes,
  };
}
