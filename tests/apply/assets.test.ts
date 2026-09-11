import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAssetStage } from '../../src/apply/assets.js';
import { LedgerStore } from '../../src/ledger/store.js';
import { assetMarker, generationHash } from '../../src/ledger/marker.js';
import type { PlanAsset } from '../../src/map/plan.js';
import type { LedgerHeader } from '../../src/ledger/schema.js';
import type { S3Ops } from '../../src/apply/s3.js';

const header: LedgerHeader = {
  ledgerVersion: 1, toolVersion: '0.1.0', sourceHost: 'replica.example.com',
  legacyHubId: 7, profileName: 'test', targetApiBase: 'https://api.example.com',
  targetTeamId: 'team-1', targetHubId: 'hub_1', runId: 'run-1', planHash: 'h',
};

function asset(overrides: Partial<PlanAsset> = {}): PlanAsset {
  return {
    legacyFileId: 5, legacyMediaId: 91234, variant: 'original',
    sourceBucket: 'legacy', sourceKey: '91234/hero.png', sizeBytes: 1_000,
    etag: '"abc"', versionId: 'v1', checksumCrc64Nvme: null, mimeType: 'image/png',
    cdnUrl: 'https://cdn.legacy.example.com/91234/hero.png', title: 'Hero',
    visibility: 'public', isVideo: false, folderLegacyIds: [], playlistLegacyIds: [],
    ...overrides,
  };
}

function s3(overrides: Partial<S3Ops> = {}): S3Ops {
  return {
    head: vi.fn(async (_b: string, key: string) =>
      key.startsWith('team-1/')
        ? { sizeBytes: 1_000, etag: '"d"', versionId: null, checksumCrc64Nvme: null, contentType: null }
        : null,
    ),
    copy: vi.fn(async () => {}),
    multipartCopy: vi.fn(async () => {}),
    abortIncompleteUploads: vi.fn(async () => 0),
    delete: vi.fn(async () => {}),
    ...overrides,
  };
}

function store(): LedgerStore {
  return LedgerStore.create(mkdtempSync(join(tmpdir(), 'ledger-')), header);
}

const runner = {
  register: vi.fn(async () => ({ fileId: 'file_1', mediaId: 'med_1' })),
  listByMarker: vi.fn(async () => []),
};

describe('runAssetStage', () => {
  it('drives an image from intent to verified', async () => {
    const s = store();
    const ops = s3();
    // head returns null for the destination on the first call, then the copied object
    let headCalls = 0;
    ops.head = vi.fn(async (_b: string, key: string) => {
      if (!key.startsWith('team-1/')) return { sizeBytes: 1_000, etag: '"abc"', versionId: 'v1', checksumCrc64Nvme: null, contentType: 'image/png' };
      headCalls += 1;
      return headCalls === 1 ? null : { sizeBytes: 1_000, etag: '"d"', versionId: null, checksumCrc64Nvme: 'DEST', contentType: null };
    });
    await runAssetStage({ assets: [asset()], store: s, s3: ops, runner, teamId: 'team-1', bucket: 'v3', sourceHost: 'replica.example.com' });
    const marker = assetMarker('replica.example.com', 91234, 'original', generationHash('legacy', '91234/hero.png', 'v1'));
    const entry = s.find(marker);
    expect(entry?.state).toBe('verified');
    expect(entry?.asset?.v3MediaId).toBe('med_1');
    expect(entry?.asset?.destinationKey).toBe('team-1/media/med_1/original');
    expect(entry?.asset?.destinationChecksumCrc64Nvme).toBe('DEST');
  });

  it('persists the allocation before copying, so a kill leaves allocated not lost', async () => {
    const s = store();
    const states: string[] = [];
    const ops = s3();
    let copied = false;
    ops.head = vi.fn(async (_b: string, key: string) =>
      key.startsWith('team-1/')
        ? copied ? { sizeBytes: 1_000, etag: '"d"', versionId: null, checksumCrc64Nvme: null, contentType: null } : null
        : { sizeBytes: 1_000, etag: '"abc"', versionId: 'v1', checksumCrc64Nvme: null, contentType: 'image/png' },
    );
    ops.copy = vi.fn(async () => {
      copied = true;
      const marker = assetMarker('replica.example.com', 91234, 'original', generationHash('legacy', '91234/hero.png', 'v1'));
      states.push(s.find(marker)?.state ?? 'missing');
    });
    await runAssetStage({ assets: [asset()], store: s, s3: ops, runner, teamId: 'team-1', bucket: 'v3', sourceHost: 'replica.example.com' });
    expect(states).toEqual(['allocated']);
  });

  it('records a video as pending-import and never copies its bytes in M1', async () => {
    const s = store();
    const ops = s3();
    await runAssetStage({
      assets: [asset({ isVideo: true, mimeType: 'video/mp4' })],
      store: s, s3: ops, runner, teamId: 'team-1', bucket: 'v3', sourceHost: 'replica.example.com',
    });
    const marker = assetMarker('replica.example.com', 91234, 'original', generationHash('legacy', '91234/hero.png', 'v1'));
    expect(s.find(marker)?.state).toBe('pending-import');
    expect(s.find(marker)?.asset?.legacyCdnUrl).toBe('https://cdn.legacy.example.com/91234/hero.png');
    expect(ops.copy).not.toHaveBeenCalled();
  });

  it('reuses a verified asset from another ledger when the source identity is unchanged', async () => {
    const s = store();
    const marker = assetMarker('replica.example.com', 91234, 'original', generationHash('legacy', '91234/hero.png', 'v1'));
    const reusable = {
      register: vi.fn(async () => ({ fileId: 'file_new', mediaId: 'med_new' })),
      listByMarker: vi.fn(async () => ['file_existing']),
    };
    await runAssetStage({ assets: [asset()], store: s, s3: s3(), runner: reusable, teamId: 'team-1', bucket: 'v3', sourceHost: 'replica.example.com' });
    expect(reusable.register).not.toHaveBeenCalled();
    expect(s.find(marker)?.v3Id).toBe('file_existing');
  });

  it('allocates a new asset when the source generation changed, leaving the old entry alone', async () => {
    const s = store();
    const oldMarker = assetMarker('replica.example.com', 91234, 'original', generationHash('legacy', '91234/hero.png', 'v1'));
    const newMarker = assetMarker('replica.example.com', 91234, 'original', generationHash('legacy', '91234/hero.png', 'v2'));
    await runAssetStage({ assets: [asset()], store: s, s3: s3(), runner, teamId: 'team-1', bucket: 'v3', sourceHost: 'replica.example.com' });
    await runAssetStage({ assets: [asset({ versionId: 'v2' })], store: s, s3: s3(), runner, teamId: 'team-1', bucket: 'v3', sourceHost: 'replica.example.com' });
    expect(s.find(oldMarker)).not.toBeNull();
    expect(s.find(newMarker)).not.toBeNull();
    expect(oldMarker).not.toBe(newMarker);
  });

  it('carries the restricted visibility onto the ledger entry', async () => {
    const s = store();
    await runAssetStage({
      assets: [asset({ visibility: 'restricted' })],
      store: s, s3: s3(), runner, teamId: 'team-1', bucket: 'v3', sourceHost: 'replica.example.com',
    });
    const marker = assetMarker('replica.example.com', 91234, 'original', generationHash('legacy', '91234/hero.png', 'v1'));
    expect(s.find(marker)?.asset?.visibility).toBe('restricted');
  });

  it('falls back to the source ETag for the generation hash when the bucket is unversioned', async () => {
    const s = store();
    await runAssetStage({
      assets: [asset({ versionId: null })],
      store: s, s3: s3(), runner, teamId: 'team-1', bucket: 'v3', sourceHost: 'replica.example.com',
    });
    const marker = assetMarker('replica.example.com', 91234, 'original', generationHash('legacy', '91234/hero.png', '"abc"'));
    expect(s.find(marker)).not.toBeNull();
  });
});

describe('runAssetStage in skip mode', () => {
  const pageRef = { kind: 'page-node' as const, legacyPageId: 100, pageSlug: 'home', nodeId: 'n1' };
  const playlistRef = { kind: 'playlist-item' as const, legacyPlaylistId: 42, position: 0 };
  const base = { teamId: 'team-1', bucket: 'v3', sourceHost: 'replica.example.com', mode: 'skip' as const };
  const markerOf = (key: string, ver: string | null = 'v1', etag = '"abc"') =>
    assetMarker('replica.example.com', 91234, 'original', generationHash('legacy', key, ver ?? etag));

  it('records every asset as pending-copy with its pinned source and references, registering and copying nothing', async () => {
    const s = store();
    const register = vi.fn(async () => ({ fileId: 'f', mediaId: 'm' }));
    const ops = s3();
    await runAssetStage({ ...base, assets: [asset()], store: s, s3: ops, runner: { register, listByMarker: vi.fn(async () => []) },
      references: new Map([['91234/original', [playlistRef]]]), playbackOk: new Set() });
    const entry = s.find(markerOf('91234/hero.png'))!;
    expect(entry.state).toBe('pending-copy');
    expect(entry.asset?.sourceVersionId).toBe('v1');
    expect(entry.asset?.references).toEqual([playlistRef]);
    expect(register).not.toHaveBeenCalled();
    expect(ops.copy).not.toHaveBeenCalled();
  });

  it('marks a public image on a page as legacy-linked when the prefilter passed', async () => {
    const s = store();
    await runAssetStage({ ...base, assets: [asset()], store: s, s3: s3(), runner,
      references: new Map([['91234/original', [pageRef]]]), playbackOk: new Set(['https://cdn.legacy.example.com/91234/hero.png']) });
    expect(s.find(markerOf('91234/hero.png'))?.state).toBe('legacy-linked');
  });

  it('keeps a public image pending-copy when the prefilter did not pass, and a restricted one regardless', async () => {
    const s = store();
    await runAssetStage({ ...base, assets: [asset()], store: s, s3: s3(), runner,
      references: new Map([['91234/original', [pageRef]]]), playbackOk: new Set() });
    expect(s.find(markerOf('91234/hero.png'))?.state).toBe('pending-copy');
    const s2 = store();
    await runAssetStage({ ...base, assets: [asset({ visibility: 'restricted' })], store: s2, s3: s3(), runner,
      references: new Map([['91234/original', [pageRef]]]), playbackOk: new Set(['https://cdn.legacy.example.com/91234/hero.png']) });
    expect(s2.find(markerOf('91234/hero.png'))?.state).toBe('pending-copy');
  });

  it('warns with type asset-pending for a pdf or audio file in a playlist', async () => {
    const s = store();
    const warnings: Array<[string, string]> = [];
    await runAssetStage({ ...base, assets: [asset({ mimeType: 'application/pdf', sourceKey: '91234/deck.pdf' })], store: s, s3: s3(), runner,
      references: new Map([['91234/original', [playlistRef]]]), playbackOk: new Set(), warn: (r, t) => warnings.push([r, t]) });
    expect(warnings[0]?.[1]).toBe('asset-pending');
    expect(s.find(markerOf('91234/deck.pdf'))?.state).toBe('pending-copy');
  });

  it('records video as pending-import, not pending-copy', async () => {
    const s = store();
    await runAssetStage({ ...base, assets: [asset({ isVideo: true, mimeType: 'video/mp4', sourceKey: '91234/a.mp4' })], store: s, s3: s3(), runner,
      references: new Map(), playbackOk: new Set() });
    expect(s.find(markerOf('91234/a.mp4'))?.state).toBe('pending-import');
  });
});

describe('runAssetStage in assets-only mode', () => {
  const markerOf = (key: string) => assetMarker('replica.example.com', 91234, 'original', generationHash('legacy', key, 'v1'));
  const only = { teamId: 'team-1', bucket: 'v3', sourceHost: 'replica.example.com', mode: 'assets-only' as const };

  async function seeded(state: 'pending-copy' | 'legacy-linked' | 'verified', overrides: Partial<PlanAsset> = {}) {
    const s = store();
    await runAssetStage({ ...only, mode: 'skip', assets: [asset(overrides)], store: s, s3: s3(), runner, references: new Map(), playbackOk: new Set() });
    const key = overrides.sourceKey ?? '91234/hero.png';
    const entry = s.find(markerOf(key))!;
    s.upsert({ ...entry, state });
    return s;
  }

  it('copies a pending-copy image through to verified', async () => {
    const s = await seeded('pending-copy');
    const ops = s3();
    let headCalls = 0;
    ops.head = vi.fn(async (_b: string, key: string) => {
      if (!key.startsWith('team-1/')) return { sizeBytes: 1_000, etag: '"abc"', versionId: 'v1', checksumCrc64Nvme: null, contentType: 'image/png' };
      headCalls += 1;
      return headCalls === 1 ? null : { sizeBytes: 1_000, etag: '"d"', versionId: null, checksumCrc64Nvme: null, contentType: null };
    });
    await runAssetStage({ ...only, assets: [asset()], store: s, s3: ops, runner });
    expect(s.find(markerOf('91234/hero.png'))?.state).toBe('verified');
    expect(ops.copy).toHaveBeenCalledTimes(1);
  });

  it('also copies a legacy-linked image, so the page can be rewritten off the legacy CDN', async () => {
    const s = await seeded('legacy-linked');
    const ops = s3();
    await runAssetStage({ ...only, assets: [asset()], store: s, s3: ops, runner });
    expect(s.find(markerOf('91234/hero.png'))?.state).toBe('verified');
  });

  it('leaves video and already-verified entries alone', async () => {
    const s = await seeded('verified');
    const ops = s3();
    await runAssetStage({ ...only, assets: [asset()], store: s, s3: ops, runner });
    expect(ops.copy).not.toHaveBeenCalled();
    const v = await seeded('pending-copy', { isVideo: true, mimeType: 'video/mp4', sourceKey: '91234/a.mp4' });
    await runAssetStage({ ...only, assets: [asset({ isVideo: true, mimeType: 'video/mp4', sourceKey: '91234/a.mp4' })], store: v, s3: ops, runner });
    expect(ops.copy).not.toHaveBeenCalled();
  });
});
