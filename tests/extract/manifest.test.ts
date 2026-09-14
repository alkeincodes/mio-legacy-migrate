import { describe, expect, it, vi } from 'vitest';
import { buildManifest, pinManifest, unpinnedHeadFor, type HeadResult } from '../../src/extract/manifest.js';
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

describe('unpinnedHeadFor and pinManifest', () => {
  it('answers from the Spatie row so --skip-s3 carries every key with no S3 identity', async () => {
    const head = unpinnedHeadFor([mediaRow]);
    expect(await head('', '91234/intro.png')).toEqual({ sizeBytes: 0, etag: '', versionId: null, checksumCrc64Nvme: null, contentType: 'image/png' });
    expect(await head('', 'nope')).toBeNull();
  });

  it('pins an unpinned manifest in place and reports keys that no longer exist', async () => {
    const { entries } = await buildManifest(base, unpinnedHeadFor([mediaRow]));
    expect(entries[0]?.etag).toBe('');
    const missing = await pinManifest(entries, 'legacy-bucket', async (_b, key) =>
      key.includes('conversions') ? null : { sizeBytes: 77, etag: '"pinned"', versionId: 'v9', checksumCrc64Nvme: 'C', contentType: 'image/png' },
    );
    expect(entries[0]).toMatchObject({ sourceBucket: 'legacy-bucket', sizeBytes: 77, etag: '"pinned"', versionId: 'v9', checksumCrc64Nvme: 'C' });
    expect(missing).toEqual([{ legacyMediaId: 91234, variant: 'optimized_thumbnail', key: '91234/conversions/intro-optimized_thumbnail.png' }]);
  });
});

describe('hub-owned decoration media', () => {
  it('enters the manifest as public decoration with its owner recorded, unless it is a branding collection', async () => {
    const logo: LegacyMedia = { ...mediaRow, id: 1, model_type: 'App\\Hub', model_id: 7, collection_name: 'custom-logo', file_name: 'logo.png', generated_conversions: null };
    expect((await buildManifest({ ...base, media: [logo] }, head)).entries).toEqual([]);
    const decoration: LegacyMedia = { ...mediaRow, id: 4189044, model_type: 'App\\Hub', model_id: 7, collection_name: 'thumbnails', file_name: 'pathway.png', generated_conversions: JSON.stringify({ optimized_thumbnail: true }) };
    const { entries } = await buildManifest({ ...base, media: [decoration] }, head);
    expect(entries.map((e) => e.variant)).toEqual(['original', 'optimized_thumbnail']);
    expect(entries[0]).toMatchObject({ legacyFileId: 0, legacyOwner: { type: 'App\\Hub', id: 7 }, visibility: 'public' });
    expect(entries[1]?.cdnUrl).toBe('https://cdn.legacy.example.com/4189044/conversions/pathway-optimized_thumbnail.png');
  });

  it('re-pins an already pinned entry at its recorded version, so a re-run reads the same object', async () => {
    const pinnedHead = vi.fn(async (_bucket: string, _key: string, versionId?: string | null): Promise<HeadResult | null> => ({
      sizeBytes: 5, etag: '"p"', versionId: versionId ?? 'fresh', checksumCrc64Nvme: null, contentType: 'image/png',
    }));
    const entry = { legacyFileId: 5, legacyMediaId: 91234, variant: 'original', disk: 's3', sourceBucket: '', sourceKey: '91234/intro.png', sizeBytes: 0, etag: '', versionId: 'v1', checksumCrc64Nvme: null, mimeType: 'image/png', cdnUrl: 'u', folderIds: [], playlistIds: [], visibility: 'public' as const, gates: [], captionUrls: [] };
    const unpinned = { ...entry, legacyMediaId: 91235, sourceKey: '91235/b.png', versionId: null };
    expect(await pinManifest([entry, unpinned], 'legacy', pinnedHead)).toEqual([]);
    expect(pinnedHead).toHaveBeenNthCalledWith(1, 'legacy', '91234/intro.png', 'v1');
    expect(pinnedHead).toHaveBeenNthCalledWith(2, 'legacy', '91235/b.png', null);
    expect(entry.versionId).toBe('v1');
    expect(unpinned.versionId).toBe('fresh');
  });
});

describe('head concurrency and progress', () => {
  const variants = 8;
  const rows: LegacyMedia[] = Array.from({ length: variants / 2 }, (_, i) => ({
    ...mediaRow, id: 100 + i, model_id: 5, file_name: `f${i}.png`,
  }));

  function trackingHead(delayFor: (key: string) => number) {
    let inFlight = 0;
    let peak = 0;
    const fn = async (_b: string, key: string): Promise<HeadResult> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, delayFor(key)));
      inFlight -= 1;
      return { sizeBytes: 1, etag: `"${key}"`, versionId: 'v', checksumCrc64Nvme: null, contentType: 'image/png' };
    };
    return { fn, peak: () => peak };
  }

  it('runs heads in parallel up to the concurrency limit', async () => {
    const tracker = trackingHead(() => 5);
    await buildManifest({ ...base, media: rows }, tracker.fn, { concurrency: 3 });
    expect(tracker.peak()).toBe(3);
  });

  it('keeps entries in media and variant order however the heads resolve', async () => {
    // Originals answer last so a naive push-on-resolve would reverse the order.
    const tracker = trackingHead((key) => (key.includes('conversions') ? 1 : 20));
    const { entries } = await buildManifest({ ...base, media: rows }, tracker.fn, { concurrency: 8 });
    expect(entries.map((e) => `${e.legacyMediaId}:${e.variant}`)).toEqual(
      rows.flatMap((r) => [`${r.id}:original`, `${r.id}:optimized_thumbnail`]),
    );
  });

  it('reports progress once per head, ending at the total', async () => {
    const seen: Array<[number, number]> = [];
    await buildManifest({ ...base, media: rows }, head, { concurrency: 4, onProgress: (d, t) => seen.push([d, t]) });
    expect(seen.map(([d]) => d)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(seen.every(([, t]) => t === variants)).toBe(true);
  });

  it('pinManifest reports progress the same way', async () => {
    const { entries } = await buildManifest({ ...base, media: rows }, unpinnedHeadFor(rows));
    const seen: number[] = [];
    await pinManifest(entries, 'legacy-bucket', head, { concurrency: 4, onProgress: (d) => seen.push(d) });
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
