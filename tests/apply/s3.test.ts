import { describe, expect, it, vi } from 'vitest';
import { copyObject, destinationKeyFor, MULTIPART_THRESHOLD_BYTES, verifyCopy, type S3Ops } from '../../src/apply/s3.js';

const source = { bucket: 'legacy', key: '91234/intro.mp4', versionId: 'v1', etag: '"abc"', sizeBytes: 1_000 };
const destination = { bucket: 'v3', key: 'team-1/media/med_1/original', contentType: 'video/mp4' };

/** The source answers as the manifest pinned it; the destination is empty. */
const sourceHead = { sizeBytes: 1_000, etag: '"abc"', versionId: 'v1', checksumCrc64Nvme: null, contentType: 'video/mp4' };

function ops(overrides: Partial<S3Ops> = {}): S3Ops {
  return {
    head: vi.fn(async (bucket: string) => (bucket === 'legacy' ? sourceHead : null)),
    copy: vi.fn(async () => {}),
    multipartCopy: vi.fn(async () => {}),
    abortIncompleteUploads: vi.fn(async () => 0),
    delete: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('destinationKeyFor', () => {
  it('matches the V3 scheme with the original variant', () => {
    expect(destinationKeyFor('team-1', 'med_1')).toBe('team-1/media/med_1/original');
  });
});

describe('copyObject', () => {
  it('copies when the destination is empty, after reading the source at its pinned version', async () => {
    const o = ops();
    expect(await copyObject(o, source, destination)).toBe('copied');
    expect(o.copy).toHaveBeenCalledWith(source, destination);
    expect(o.head).toHaveBeenCalledWith('legacy', '91234/intro.mp4', 'v1');
  });

  it('stops before copying when the source is gone or no longer the pinned size', async () => {
    const gone = ops({ head: vi.fn(async () => null) });
    await expect(copyObject(gone, source, destination)).rejects.toThrow(/legacy\/91234\/intro.mp4\?versionId=v1 is gone/);
    expect(gone.copy).not.toHaveBeenCalled();
    const grown = ops({ head: vi.fn(async (bucket: string) => (bucket === 'legacy' ? { ...sourceHead, sizeBytes: 1_001 } : null)) });
    await expect(copyObject(grown, source, destination)).rejects.toThrow(/1001 bytes but the manifest pinned 1000/);
    expect(grown.copy).not.toHaveBeenCalled();
  });

  it('on an unversioned bucket, stops when the source ETag moved since pinning', async () => {
    const moved = ops({ head: vi.fn(async (bucket: string) => (bucket === 'legacy' ? { ...sourceHead, versionId: null, etag: '"zzz"' } : null)) });
    await expect(copyObject(moved, { ...source, versionId: null }, destination)).rejects.toThrow(/ETag "zzz" but the manifest pinned "abc"/);
    expect(moved.copy).not.toHaveBeenCalled();
    expect(moved.head).toHaveBeenCalledWith('legacy', '91234/intro.mp4', null);
  });

  const huge = { ...source, sizeBytes: MULTIPART_THRESHOLD_BYTES + 1 };
  const hugeOps = (overrides: Partial<S3Ops> = {}) =>
    ops({ head: vi.fn(async (bucket: string) => (bucket === 'legacy' ? { ...sourceHead, sizeBytes: huge.sizeBytes } : null)), ...overrides });

  it('uses a multipart copy above the 5 GB threshold', async () => {
    const o = hugeOps();
    await copyObject(o, huge, destination);
    expect(o.multipartCopy).toHaveBeenCalled();
    expect(o.copy).not.toHaveBeenCalled();
  });

  it('aborts incomplete multipart uploads for the destination key before retrying', async () => {
    const abort = vi.fn(async () => 2);
    const o = hugeOps({ abortIncompleteUploads: abort });
    await copyObject(o, huge, destination);
    expect(abort).toHaveBeenCalledWith('v3', 'team-1/media/med_1/original');
  });

  it('adopts a non-empty destination whose size matches, because it can only be our own retry', async () => {
    const o = ops({
      head: vi.fn(async () => ({ sizeBytes: 1_000, etag: '"zzz"', versionId: null, checksumCrc64Nvme: null, contentType: null })),
    });
    expect(await copyObject(o, source, destination)).toBe('adopted');
    expect(o.copy).not.toHaveBeenCalled();
  });

  it('refuses a non-empty destination whose size differs', async () => {
    const o = ops({
      head: vi.fn(async () => ({ sizeBytes: 7, etag: '"zzz"', versionId: null, checksumCrc64Nvme: null, contentType: null })),
    });
    await expect(copyObject(o, source, destination)).rejects.toThrow(/already holds an object of 7 bytes/);
  });

  it('lets a conditional-copy failure through, so changed source bytes stop the run', async () => {
    const o = ops({ copy: vi.fn(async () => { throw new Error('PreconditionFailed'); }) });
    await expect(copyObject(o, source, destination)).rejects.toThrow(/PreconditionFailed/);
  });
});

describe('verifyCopy', () => {
  it('passes on matching size when the source exposed no checksum', async () => {
    const o = ops({
      head: vi.fn(async () => ({ sizeBytes: 1_000, etag: '"x"', versionId: null, checksumCrc64Nvme: 'DEST', contentType: null })),
    });
    const result = await verifyCopy(o, source, destination, null);
    expect(result.ok).toBe(true);
    expect(result.destinationChecksum).toBe('DEST');
  });

  it('fails on a size mismatch', async () => {
    const o = ops({
      head: vi.fn(async () => ({ sizeBytes: 999, etag: '"x"', versionId: null, checksumCrc64Nvme: null, contentType: null })),
    });
    expect((await verifyCopy(o, source, destination, null)).reason).toContain('size');
  });

  it('compares the full-object checksum when the source exposed one', async () => {
    const o = ops({
      head: vi.fn(async () => ({ sizeBytes: 1_000, etag: '"x"', versionId: null, checksumCrc64Nvme: 'DIFFERENT', contentType: null })),
    });
    const result = await verifyCopy(o, source, destination, 'SOURCE');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('checksum');
  });

  it('fails when the destination is missing entirely', async () => {
    expect((await verifyCopy(ops(), source, destination, null)).reason).toContain('no object');
  });

  it('never uses the ETag as an integrity check', async () => {
    const o = ops({
      head: vi.fn(async () => ({ sizeBytes: 1_000, etag: '"completely-different"', versionId: null, checksumCrc64Nvme: null, contentType: null })),
    });
    expect((await verifyCopy(o, source, destination, null)).ok).toBe(true);
  });
});
