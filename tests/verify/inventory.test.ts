import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildInventory, renderInventory } from '../../src/verify/inventory.js';

function seedLedger(root: string, legacyHubId: number, runId: string, entries: unknown[]): void {
  const dir = join(root, 'mantalks-prod', String(legacyHubId));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${runId}.json`),
    JSON.stringify({
      header: {
        ledgerVersion: 1, toolVersion: '0.1.0', sourceHost: 'h', legacyHubId,
        profileName: 'mantalks-prod', targetApiBase: 'a', targetTeamId: 't',
        targetHubId: 'hub_1', runId, planHash: 'p',
      },
      entries,
    }),
    'utf8',
  );
}

function assetEntry(state: string, legacyId: number): unknown {
  return {
    legacyTable: 'media', legacyId, kind: 'asset', variant: 'original',
    marker: `m-${legacyId}`, v3Id: null, state, runId: 'run-1',
    createdAt: 'x', updatedAt: 'x', contentHash: 'c', referenceHash: null,
    revisionToken: null,
    asset: {
      sourceBucket: 'b', sourceKey: 'k', sourceEtag: 'e', sourceVersionId: null,
      sourceSizeBytes: 1, sourceChecksumCrc64Nvme: null, v3MediaId: null,
      v3FileId: null, destinationKey: null, destinationSizeBytes: null,
      destinationChecksumCrc64Nvme: null, visibility: 'public',
      legacyCdnUrl: `https://cdn.legacy.example.com/${legacyId}/x.mp4`, importJobId: null,
    },
  };
}

describe('buildInventory', () => {
  it('lists legacy-linked and pending-import entries', () => {
    const root = mkdtempSync(join(tmpdir(), 'ledger-root-'));
    seedLedger(root, 7, 'run-1', [assetEntry('legacy-linked', 1), assetEntry('pending-import', 2)]);
    const rows = buildInventory('mantalks-prod', root);
    expect(rows.map((r) => r.state).sort()).toEqual(['legacy-linked', 'pending-import']);
  });

  it('excludes verified entries, which no longer depend on legacy serving', () => {
    const root = mkdtempSync(join(tmpdir(), 'ledger-root-'));
    seedLedger(root, 7, 'run-1', [assetEntry('verified', 1)]);
    expect(buildInventory('mantalks-prod', root)).toEqual([]);
  });

  it('spans every legacy hub under the profile', () => {
    const root = mkdtempSync(join(tmpdir(), 'ledger-root-'));
    seedLedger(root, 7, 'run-1', [assetEntry('legacy-linked', 1)]);
    seedLedger(root, 8, 'run-2', [assetEntry('pending-import', 2)]);
    expect(buildInventory('mantalks-prod', root).map((r) => r.legacyHubId).sort()).toEqual([7, 8]);
  });

  it('carries the legacy CDN URL, which is the dependency being recorded', () => {
    const root = mkdtempSync(join(tmpdir(), 'ledger-root-'));
    seedLedger(root, 7, 'run-1', [assetEntry('legacy-linked', 1)]);
    expect(buildInventory('mantalks-prod', root)[0]?.legacyCdnUrl).toBe('https://cdn.legacy.example.com/1/x.mp4');
  });

  it('returns nothing for a profile with no ledgers, rather than throwing', () => {
    expect(buildInventory('nobody', mkdtempSync(join(tmpdir(), 'ledger-root-')))).toEqual([]);
  });
});

describe('renderInventory', () => {
  it('states the M2 exit condition when the inventory is empty', () => {
    expect(renderInventory([])).toContain('legacy serving can be switched off');
  });

  it('states that legacy serving must stay on while rows remain', () => {
    const text = renderInventory([
      { legacyHubId: 7, runId: 'run-1', legacyMediaId: 1, variant: 'original', state: 'legacy-linked', legacyCdnUrl: 'u' },
    ]);
    expect(text).toContain('legacy serving cannot be switched off');
    expect(text).toContain('1');
  });
});
