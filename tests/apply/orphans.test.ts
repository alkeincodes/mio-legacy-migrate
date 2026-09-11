import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteOrphans, findOrphans } from '../../src/apply/assets.js';
import { LedgerStore } from '../../src/ledger/store.js';
import type { LedgerEntry, LedgerHeader } from '../../src/ledger/schema.js';

const header: LedgerHeader = {
  ledgerVersion: 1, toolVersion: '0.1.0', sourceHost: 'h', legacyHubId: 7,
  profileName: 'test', targetApiBase: 'a', targetTeamId: 't',
  targetHubId: 'hub_1', runId: 'run-1', planHash: 'p',
};

const DAY_MS = 24 * 60 * 60 * 1000;

function entry(state: LedgerEntry['state'], updatedAt: string, marker: string): LedgerEntry {
  return {
    legacyTable: 'media', legacyId: 1, kind: 'asset', variant: 'original',
    marker, v3Id: 'file_1', state, runId: 'run-1',
    createdAt: updatedAt, updatedAt, contentHash: 'c', referenceHash: null,
    revisionToken: null,
    asset: {
      sourceBucket: 'b', sourceKey: 'k', sourceEtag: 'e', sourceVersionId: null,
      sourceSizeBytes: 1, sourceChecksumCrc64Nvme: null, v3MediaId: 'med_1',
      v3FileId: 'file_1', destinationKey: 'team/media/med_1/original',
      destinationSizeBytes: null, destinationChecksumCrc64Nvme: null,
      visibility: 'public', legacyCdnUrl: 'u', importJobId: null,
    },
  };
}

function store(): LedgerStore {
  return LedgerStore.create(mkdtempSync(join(tmpdir(), 'ledger-')), header);
}

const now = new Date('2026-09-12T12:00:00.000Z');
const old = '2026-09-10T12:00:00.000Z';
const recent = '2026-09-12T11:00:00.000Z';

describe('findOrphans', () => {
  it('finds an allocated row older than a day', () => {
    const s = store();
    s.upsert(entry('allocated', old, 'm1'));
    expect(findOrphans(s, DAY_MS, now).map((e) => e.marker)).toEqual(['m1']);
  });

  it('leaves a recently allocated row alone, because a run may still be in flight', () => {
    const s = store();
    s.upsert(entry('allocated', recent, 'm1'));
    expect(findOrphans(s, DAY_MS, now)).toEqual([]);
  });

  it('leaves a copied row alone, because verification may simply not have run yet', () => {
    const s = store();
    s.upsert(entry('copied', old, 'm1'));
    expect(findOrphans(s, DAY_MS, now)).toEqual([]);
  });

  it('never touches a verified row', () => {
    const s = store();
    s.upsert(entry('verified', old, 'm1'));
    expect(findOrphans(s, DAY_MS, now)).toEqual([]);
  });

  it('never touches a non-asset entry', () => {
    const s = store();
    s.upsert({ ...entry('allocated', old, 'm1'), kind: 'page', asset: null });
    expect(findOrphans(s, DAY_MS, now)).toEqual([]);
  });
});

describe('deleteOrphans', () => {
  it('deletes each orphan file and removes its ledger entry', async () => {
    const s = store();
    s.upsert(entry('allocated', old, 'm1'));
    const deleteFile = vi.fn(async () => {});
    const count = await deleteOrphans(s, findOrphans(s, DAY_MS, now), deleteFile);
    expect(count).toBe(1);
    expect(deleteFile).toHaveBeenCalledWith('file_1');
    expect(s.find('m1')?.state).toBe('intent');
    expect(s.find('m1')?.v3Id).toBeNull();
  });

  it('skips an orphan with no V3 id rather than calling delete with an empty string', async () => {
    const s = store();
    s.upsert({ ...entry('allocated', old, 'm1'), v3Id: null });
    const deleteFile = vi.fn(async () => {});
    expect(await deleteOrphans(s, findOrphans(s, DAY_MS, now), deleteFile)).toBe(0);
    expect(deleteFile).not.toHaveBeenCalled();
  });
});
