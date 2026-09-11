import { describe, expect, it } from 'vitest';
import { s3OpsFor, type S3Sender } from '../../src/apply/s3Clients.js';

function recorder(): S3Sender & { commands: Array<{ name: string; input: Record<string, unknown> }> } {
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  return {
    commands,
    async send(command: unknown) {
      const c = command as { constructor: { name: string }; input: Record<string, unknown> };
      commands.push({ name: c.constructor.name, input: c.input });
      return { ContentLength: 1 };
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
});
