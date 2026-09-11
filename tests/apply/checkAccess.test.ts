import { describe, expect, it, vi } from 'vitest';
import { checkAccess } from '../../src/apply/checkAccess.js';
import type { S3Ops } from '../../src/apply/s3.js';
import type { ApiClient } from '../../src/apply/api.js';
import type { PlanAsset } from '../../src/map/plan.js';

const probe: PlanAsset = {
  legacyFileId: 5, legacyMediaId: 1, variant: 'original', sourceBucket: 'legacy', sourceKey: '1/a.png',
  sizeBytes: 10, etag: '"e"', versionId: null, checksumCrc64Nvme: null, mimeType: 'image/png', cdnUrl: 'u',
  title: 't', visibility: 'public', isVideo: false, folderLegacyIds: [], playlistLegacyIds: [],
};

function s3(exists: (bucket: string) => boolean): S3Ops {
  return {
    head: vi.fn(async () => ({ sizeBytes: 10, etag: '"e"', versionId: null, checksumCrc64Nvme: null, contentType: null })),
    copy: vi.fn(async () => {}),
    multipartCopy: vi.fn(async () => {}),
    abortIncompleteUploads: vi.fn(async () => 0),
    delete: vi.fn(async () => {}),
    bucketExists: vi.fn(async (b: string) => exists(b)),
  };
}

const api = {
  get: vi.fn(async () => ({
    body: { data: [{ attributes: { email: 'migrate-test-noentitlement@membership.io' } }, { attributes: { email: 'migrate-test-entitled@membership.io' } }] },
    etag: null,
  })),
} as unknown as ApiClient;

describe('checkAccess', () => {
  it('names the V3 destination bucket and the profile field when that bucket is missing', async () => {
    await expect(
      checkAccess({ probe, s3: s3((b) => b === 'legacy'), api, teamId: 'team-1', bucket: 'v3-wrong' }),
    ).rejects.toThrow(/destination bucket "v3-wrong" \(profiles/);
  });

  it('names the legacy bucket when that one is missing', async () => {
    await expect(
      checkAccess({ probe, s3: s3((b) => b === 'v3'), api, teamId: 'team-1', bucket: 'v3' }),
    ).rejects.toThrow(/legacy bucket "legacy" \(LEGACY_S3_BUCKET\)/);
  });

  it('loads the committed profile with the bucket the backend team confirmed and an unconfirmed cdnBase', async () => {
    const { loadProfile } = await import('../../src/config/profile.js');
    const profile = loadProfile('mantalks-prod');
    expect(profile.bucket).toBe('mio-backend-assets-production');
    expect(profile.cdnBaseConfirmed).toBe(false);
  });

  it('copies a probe, verifies it, deletes it and confirms the test members when everything exists', async () => {
    const ops = s3(() => true);
    const result = await checkAccess({ probe: { ...probe, versionId: 'v-src' }, s3: ops, api, teamId: 'team-1', bucket: 'v3' });
    // Source read at the pinned version first, then the destination after the copy.
    expect(ops.head).toHaveBeenNthCalledWith(1, 'legacy', '1/a.png', 'v-src');
    expect(ops.copy).toHaveBeenCalledTimes(1);
    expect(ops.delete).toHaveBeenCalledTimes(1);
    expect(result.notes).toEqual([]);
  });

  it('says when the destination bucket is versioned, because the probe delete leaves a marker and a version behind', async () => {
    const ops = { ...s3(() => true), bucketVersioning: vi.fn(async () => 'Enabled' as const) };
    const result = await checkAccess({ probe, s3: ops, api, teamId: 'team-1', bucket: 'v3' });
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toMatch(/versioning enabled.*delete marker.*noncurrent version.*team-1\/media\/probe-/);
    expect(ops.bucketVersioning).toHaveBeenCalledWith('v3');
  });

  it('stops before the probe copy when the source no longer matches the manifest', async () => {
    const ops = s3(() => true);
    ops.head = vi.fn(async () => ({ sizeBytes: 99, etag: '"e"', versionId: null, checksumCrc64Nvme: null, contentType: null }));
    await expect(checkAccess({ probe, s3: ops, api, teamId: 'team-1', bucket: 'v3' })).rejects.toThrow(/99 bytes but the manifest pinned 10/);
    expect(ops.copy).not.toHaveBeenCalled();
  });
});
