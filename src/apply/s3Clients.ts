import {
  CopyObjectCommand, DeleteObjectCommand, GetBucketVersioningCommand, HeadBucketCommand, HeadObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import type { Env } from '../config/env.js';
import { logger } from '../log/logger.js';
import type { HeadResult } from '../extract/manifest.js';
import type { CopyDestination, CopySource, S3Ops } from './s3.js';

/** The subset of the SDK client the ops use, so tests can hand in a recorder. */
export interface S3Sender {
  send(command: unknown): Promise<unknown>;
}

export interface S3Principals {
  legacy: S3Sender;
  v3: S3Sender;
  /** True when the V3 pair was empty and the legacy pair serves both buckets. */
  v3IsFallback: boolean;
}

export function principalsFromEnv(env: Env, region: string): S3Principals {
  const legacy = new S3Client({
    region,
    credentials: { accessKeyId: env.awsAccessKeyId, secretAccessKey: env.awsSecretAccessKey },
  });
  const hasV3 = env.v3AwsAccessKeyId.length > 0 && env.v3AwsSecretAccessKey.length > 0;
  if (!hasV3) {
    logger.warn(
      'V3_AWS_ACCESS_KEY_ID / V3_AWS_SECRET_ACCESS_KEY are empty; falling back to the legacy AWS pair for every call on the V3 bucket',
    );
    return { legacy, v3: legacy, v3IsFallback: true };
  }
  const v3 = new S3Client({
    region,
    credentials: { accessKeyId: env.v3AwsAccessKeyId, secretAccessKey: env.v3AwsSecretAccessKey },
  });
  return { legacy, v3, v3IsFallback: false };
}

/**
 * Every call whose Bucket is the V3 bucket runs under the V3 principal:
 * HeadBucket, GetBucketVersioning, HeadObject and DeleteObject on it, and
 * CopyObject, whose Bucket is the destination. So the V3 principal also needs
 * s3:GetObject (and s3:GetObjectVersion when the legacy bucket is versioned) on
 * the legacy bucket. Everything on the legacy bucket runs under the legacy
 * principal. The exact action list per call is in docs/contracts.md.
 */
export function s3OpsFor(principals: S3Principals, v3Bucket: string): S3Ops {
  const clientFor = (bucket: string): S3Sender => (bucket === v3Bucket ? principals.v3 : principals.legacy);
  return {
    async head(bucket, key, versionId): Promise<HeadResult | null> {
      try {
        const out = (await clientFor(bucket).send(
          new HeadObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: 'ENABLED', ...(versionId ? { VersionId: versionId } : {}) }),
        )) as { ContentLength?: number; ETag?: string; VersionId?: string; ChecksumCRC64NVME?: string; ContentType?: string };
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
    async copy(source: CopySource, destination: CopyDestination) {
      const copySource = `${source.bucket}/${encodeURIComponent(source.key)}${source.versionId ? `?versionId=${source.versionId}` : ''}`;
      // CopyObject takes only the algorithm (no ChecksumType input exists on the
      // request, SDK 3.1130 CopyObjectRequest); CRC64NVME is a full-object
      // algorithm, and the response says which type S3 recorded, so a composite
      // answer is refused here rather than at verify.
      const out = (await clientFor(destination.bucket).send(new CopyObjectCommand({
        Bucket: destination.bucket,
        Key: destination.key,
        CopySource: copySource,
        ...(source.versionId ? {} : { CopySourceIfMatch: source.etag }),
        ChecksumAlgorithm: 'CRC64NVME',
        ContentType: destination.contentType ?? undefined,
        MetadataDirective: 'REPLACE',
        // REPLACE with no Tagging: the copy inherits no source tags and needs no s3:PutObjectTagging on the destination.
        TaggingDirective: 'REPLACE',
      }))) as { CopyObjectResult?: { ChecksumType?: string } };
      const checksumType = out.CopyObjectResult?.ChecksumType;
      if (checksumType && checksumType !== 'FULL_OBJECT') {
        throw new Error(`copy of ${copySource} to ${destination.bucket}/${destination.key} recorded a ${checksumType} checksum, not FULL_OBJECT; the verify step cannot compare it with the source`);
      }
    },
    async multipartCopy(source, destination) {
      throw new Error(
        `object ${source.bucket}/${source.key} is ${source.sizeBytes} bytes and needs a multipart copy, which is not wired up. Copy it by hand with: aws s3 cp s3://${source.bucket}/${source.key} s3://${destination.bucket}/${destination.key} --copy-props metadata-directive`,
      );
    },
    async abortIncompleteUploads() { return 0; },
    async delete(bucket, key) {
      await clientFor(bucket).send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async bucketExists(bucket) {
      try {
        await clientFor(bucket).send(new HeadBucketCommand({ Bucket: bucket }));
        return true;
      } catch {
        return false;
      }
    },
    async bucketVersioning(bucket) {
      try {
        const out = (await clientFor(bucket).send(new GetBucketVersioningCommand({ Bucket: bucket }))) as { Status?: string };
        return out.Status === 'Enabled' || out.Status === 'Suspended' ? out.Status : null;
      } catch {
        return null;
      }
    },
  };
}
