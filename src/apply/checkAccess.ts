import { logger } from '../log/logger.js';
import { assertSourceMatches, destinationKeyFor, type S3Ops } from './s3.js';
import type { ApiClient } from './api.js';
import type { PlanAsset } from '../map/plan.js';

/**
 * Proves, before the first run on a profile, that the credentials can read the
 * legacy bucket and write the V3 bucket (including the KMS permissions each
 * side needs), and that the two test members the authorization checks use exist.
 */
export async function checkAccess(opts: {
  probe: PlanAsset;
  s3: S3Ops;
  api: ApiClient;
  teamId: string;
  bucket: string;
  cdnBase?: string;
  cdnBaseConfirmed?: boolean;
}): Promise<{ notes: string[] }> {
  const notes: string[] = [];
  if (opts.cdnBase !== undefined) {
    logger.info(
      opts.cdnBaseConfirmed === false
        ? 'check-access: cdnBase is UNCONFIRMED; page trees will point migrated assets at this base, so confirm it against a real V3 media URL before a real apply'
        : 'check-access: cdnBase in use',
      { cdnBase: opts.cdnBase, bucket: opts.bucket },
    );
  }
  const probeKey = destinationKeyFor(opts.teamId, `probe-${Date.now()}`);
  const destination = { bucket: opts.bucket, key: probeKey, contentType: opts.probe.mimeType };
  const source = {
    bucket: opts.probe.sourceBucket,
    key: opts.probe.sourceKey,
    versionId: opts.probe.versionId,
    etag: opts.probe.etag,
    sizeBytes: opts.probe.sizeBytes,
  };

  if (opts.s3.bucketExists) {
    if (!(await opts.s3.bucketExists(source.bucket))) {
      throw new Error(`the legacy bucket "${source.bucket}" (LEGACY_S3_BUCKET) does not exist or the AWS key cannot see it`);
    }
    if (!(await opts.s3.bucketExists(opts.bucket))) {
      throw new Error(
        `the V3 destination bucket "${opts.bucket}" (profiles/<name>.json "bucket") does not exist or the AWS key cannot see it; confirm the production media bucket name with the backend team`,
      );
    }
  }

  if (opts.s3.bucketVersioning && (await opts.s3.bucketVersioning(opts.bucket)) === 'Enabled') {
    const note = `check-access: destination bucket "${opts.bucket}" has versioning enabled, so the probe delete leaves a delete marker plus a noncurrent version at ${probeKey}; a lifecycle rule on ${opts.teamId}/media/probe-* can expire them`;
    notes.push(note);
    logger.info(note);
  }

  try {
    // The same source read the copy does, at the pinned version, under the legacy principal.
    await assertSourceMatches(opts.s3, source);
    await opts.s3.copy(source, destination);
    const head = await opts.s3.head(opts.bucket, probeKey);
    if (!head) throw new Error(`the probe copy wrote nothing to ${opts.bucket}/${probeKey}`);
    if (head.sizeBytes !== source.sizeBytes) {
      throw new Error(
        `the probe copy landed ${head.sizeBytes} bytes but the source is ${source.sizeBytes}`,
      );
    }
    logger.info('check-access: cross-account copy proved', {
      sourceBucket: source.bucket, destinationBucket: opts.bucket, sizeBytes: head.sizeBytes,
    });
  } finally {
    await opts.s3.delete(opts.bucket, probeKey).catch(() => undefined);
  }

  const members = await opts.api.get<{ data?: Array<{ id?: string; attributes?: { email?: string } }> }>(
    `/api/v1/teams/${opts.teamId}/contacts?page[size]=100`,
  );
  const emails = new Set((members.body.data ?? []).map((c) => c.attributes?.email));
  for (const required of ['migrate-test-noentitlement@membership.io', 'migrate-test-entitled@membership.io']) {
    if (!emails.has(required)) {
      throw new Error(
        `the authorization checks need test member ${required} on team ${opts.teamId}; create it with: mio contacts create --email ${required}`,
      );
    }
  }
  logger.info('check-access: both authorization test members exist');
  return { notes };
}
