import { describe, expect, it } from 'vitest';
import { s3OpsFor, type S3Sender } from '../../src/apply/s3Clients.js';

function recorder(response: Record<string, unknown> = { ContentLength: 1 }): S3Sender & { commands: Array<{ name: string; input: Record<string, unknown> }> } {
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  return {
    commands,
    async send(command: unknown) {
      const c = command as { constructor: { name: string }; input: Record<string, unknown> };
      commands.push({ name: c.constructor.name, input: c.input });
      return response;
    },
  };
}

describe('s3OpsFor', () => {
  it('runs every call on the V3 bucket under the V3 principal and the rest under the legacy one', async () => {
    const legacy = recorder();
    const v3 = recorder();
    const ops = s3OpsFor({ legacy, v3, v3IsFallback: false }, 'v3-bucket');
    await ops.head('legacy-bucket', 'a');
    await ops.head('v3-bucket', 'b');
    await ops.bucketExists?.('v3-bucket');
    await ops.delete('v3-bucket', 'b');
    await ops.copy(
      { bucket: 'legacy-bucket', key: 'a', versionId: 'v1', etag: '"e"', sizeBytes: 1 },
      { bucket: 'v3-bucket', key: 'b', contentType: 'image/png' },
    );
    expect(legacy.commands.map((c) => c.name)).toEqual(['HeadObjectCommand']);
    expect(v3.commands.map((c) => c.name)).toEqual(['HeadObjectCommand', 'HeadBucketCommand', 'DeleteObjectCommand', 'CopyObjectCommand']);
  });

  it('pins the copy to the source version when the bucket is versioned, else to the ETag', async () => {
    const v3 = recorder();
    const ops = s3OpsFor({ legacy: recorder(), v3, v3IsFallback: false }, 'v3-bucket');
    await ops.copy({ bucket: 'l', key: 'k', versionId: 'v1', etag: '"e"', sizeBytes: 1 }, { bucket: 'v3-bucket', key: 'd', contentType: null });
    await ops.copy({ bucket: 'l', key: 'k', versionId: null, etag: '"e"', sizeBytes: 1 }, { bucket: 'v3-bucket', key: 'd', contentType: null });
    expect(v3.commands[0]?.input).toMatchObject({ CopySource: 'l/k?versionId=v1' });
    expect(v3.commands[0]?.input).not.toHaveProperty('CopySourceIfMatch');
    expect(v3.commands[1]?.input).toMatchObject({ CopySource: 'l/k', CopySourceIfMatch: '"e"' });
  });

  it('asks for CRC64NVME on the copy and replaces tags with none, so no PutObjectTagging is needed', async () => {
    const v3 = recorder({ CopyObjectResult: { ChecksumType: 'FULL_OBJECT' } });
    const ops = s3OpsFor({ legacy: recorder(), v3, v3IsFallback: false }, 'v3-bucket');
    await ops.copy({ bucket: 'l', key: 'k', versionId: 'v1', etag: '"e"', sizeBytes: 1 }, { bucket: 'v3-bucket', key: 'd', contentType: null });
    expect(v3.commands[0]?.input).toMatchObject({ ChecksumAlgorithm: 'CRC64NVME', TaggingDirective: 'REPLACE', MetadataDirective: 'REPLACE' });
    expect(v3.commands[0]?.input).not.toHaveProperty('Tagging');
    // CopyObjectRequest has no ChecksumType input; the response carries the type S3 recorded.
    expect(v3.commands[0]?.input).not.toHaveProperty('ChecksumType');
  });

  it('refuses a copy whose recorded checksum is not full-object, since verify could not compare it', async () => {
    const composite = recorder({ CopyObjectResult: { ChecksumType: 'COMPOSITE' } });
    const ops = s3OpsFor({ legacy: recorder(), v3: composite, v3IsFallback: false }, 'v3-bucket');
    await expect(
      ops.copy({ bucket: 'l', key: 'k', versionId: null, etag: '"e"', sizeBytes: 1 }, { bucket: 'v3-bucket', key: 'd', contentType: null }),
    ).rejects.toThrow(/COMPOSITE checksum, not FULL_OBJECT/);
    // An older endpoint that reports no type is not refused.
    await expect(s3OpsFor({ legacy: recorder(), v3: recorder(), v3IsFallback: false }, 'v3-bucket').copy(
      { bucket: 'l', key: 'k', versionId: null, etag: '"e"', sizeBytes: 1 }, { bucket: 'v3-bucket', key: 'd', contentType: null },
    )).resolves.toBeUndefined();
  });

  it('reads the source at its pinned version and leaves VersionId off an unpinned head', async () => {
    const legacy = recorder();
    const ops = s3OpsFor({ legacy, v3: recorder(), v3IsFallback: false }, 'v3-bucket');
    await ops.head('legacy-bucket', 'a', 'v9');
    await ops.head('legacy-bucket', 'a', null);
    await ops.head('legacy-bucket', 'a');
    expect(legacy.commands[0]?.input).toMatchObject({ Bucket: 'legacy-bucket', Key: 'a', VersionId: 'v9' });
    expect(legacy.commands[1]?.input).not.toHaveProperty('VersionId');
    expect(legacy.commands[2]?.input).not.toHaveProperty('VersionId');
  });

  it('reports the destination bucket versioning status under the V3 principal, and null when the call is refused', async () => {
    const v3 = recorder({ Status: 'Enabled' });
    const ops = s3OpsFor({ legacy: recorder(), v3, v3IsFallback: false }, 'v3-bucket');
    expect(await ops.bucketVersioning?.('v3-bucket')).toBe('Enabled');
    expect(v3.commands.map((c) => c.name)).toEqual(['GetBucketVersioningCommand']);
    const refused: S3Sender = { async send() { throw new Error('AccessDenied'); } };
    expect(await s3OpsFor({ legacy: recorder(), v3: refused, v3IsFallback: false }, 'v3-bucket').bucketVersioning?.('v3-bucket')).toBeNull();
    expect(await s3OpsFor({ legacy: recorder(), v3: recorder({}), v3IsFallback: false }, 'v3-bucket').bucketVersioning?.('v3-bucket')).toBeNull();
  });
});
