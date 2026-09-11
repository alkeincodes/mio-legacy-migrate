import { describe, expect, it, vi } from 'vitest';
import { buildManifest, type HeadResult } from '../../src/extract/manifest.js';
import type { LegacyFile, LegacyMedia } from '../../src/extract/queries.js';

const file: LegacyFile = {
  id: 5, team_id: 1, folder_id: 9, title: 'Intro', description: null,
  content_type: 'media', privacy: null, current_media_id: 91234, meta: null,
  thumb_url: null, source_url: null,
};

const mediaRow: LegacyMedia = {
  id: 91234, model_type: 'App\\File', model_id: 5, uuid: null,
  collection_name: 'default', name: 'intro', file_name: 'intro.png',
  mime_type: 'image/png', disk: 's3', conversions_disk: null, size: 0,
  generated_conversions: JSON.stringify({ optimized_thumbnail: true }),
  custom_properties: null, responsive_images: null, order_column: 1,
};

const head = vi.fn(
  async (_bucket: string, key: string): Promise<HeadResult | null> => ({
    sizeBytes: key.includes('conversions') ? 4_096 : 1_048_576,
    etag: `"etag-${key}"`,
    versionId: 'v1',
    checksumCrc64Nvme: 'AAAAAAAAAAA=',
    contentType: 'image/png',
  }),
);

const base = {
  files: [file],
  media: [mediaRow],
  hubFiles: [],
  playlistItems: [{ file_id: 5, playlist_id: 3 }],
  publicPlaylistIds: new Set([3]),
  fileGates: new Map(),
  bucket: 'legacy-bucket',
  s3Url: 'https://legacy-bucket.s3.amazonaws.com',
  cdnUrl: 'https://cdn.legacy.example.com',
};

describe('buildManifest', () => {
  it('emits one entry per variant with the resolved bucket, key and CDN URL', async () => {
    const { entries } = await buildManifest(base, head);
    expect(entries.map((e) => e.variant)).toEqual(['original', 'optimized_thumbnail']);
    expect(entries[0]).toMatchObject({
      legacyFileId: 5,
      legacyMediaId: 91234,
      sourceBucket: 'legacy-bucket',
      sourceKey: '91234/intro.png',
      sizeBytes: 1_048_576,
      etag: '"etag-91234/intro.png"',
      versionId: 'v1',
      checksumCrc64Nvme: 'AAAAAAAAAAA=',
      cdnUrl: 'https://cdn.legacy.example.com/91234/intro.png',
    });
  });

  it('marks an asset public when any public playlist references it', async () => {
    const { entries } = await buildManifest(base, head);
    expect(entries.every((e) => e.visibility === 'public')).toBe(true);
    expect(entries[0]?.gates).toEqual([]);
  });

  it('marks an asset restricted and carries its gates when nothing public references it', async () => {
    const { entries } = await buildManifest(
      {
        ...base,
        publicPlaylistIds: new Set<number>(),
        fileGates: new Map([[5, [{ kind: 'segment' as const, segmentId: 77 }]]]),
      },
      head,
    );
    expect(entries[0]?.visibility).toBe('restricted');
    expect(entries[0]?.gates).toEqual([{ kind: 'segment', segmentId: 77 }]);
  });

  it('records playlist and folder membership so apply can attach without re-querying', async () => {
    const { entries } = await buildManifest(base, head);
    expect(entries[0]?.playlistIds).toEqual([3]);
    expect(entries[0]?.folderIds).toEqual([9]);
  });

  it('reports a variant whose object is absent instead of inventing a size', async () => {
    const missingHead = vi.fn(async (_b: string, key: string) =>
      key.includes('conversions') ? null : await head(_b, key),
    );
    const { entries, missing } = await buildManifest(base, missingHead);
    expect(entries.map((e) => e.variant)).toEqual(['original']);
    expect(missing).toEqual([
      { legacyMediaId: 91234, variant: 'optimized_thumbnail', key: '91234/conversions/intro-optimized_thumbnail.png' },
    ]);
  });

  it('skips media rows whose owner file is not in the extract set', async () => {
    const stray: LegacyMedia = { ...mediaRow, id: 7, model_id: 999, file_name: 'x.png', generated_conversions: null };
    const { entries } = await buildManifest({ ...base, media: [mediaRow, stray] }, head);
    expect(entries.every((e) => e.legacyFileId === 5)).toBe(true);
  });
});
