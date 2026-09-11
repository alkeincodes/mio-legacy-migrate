import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportJsonl } from '../../src/ledger/exportJsonl.js';
import { LedgerStore } from '../../src/ledger/store.js';
import type { LedgerHeader } from '../../src/ledger/schema.js';

const header: LedgerHeader = {
  ledgerVersion: 1, toolVersion: '0.1.0', sourceHost: 'replica.example.com',
  legacyHubId: 7, profileName: 'test', targetApiBase: 'a', targetTeamId: 't',
  targetHubId: 'hub_1', runId: 'run-1', planHash: 'p',
};

describe('exportJsonl', () => {
  it('emits one line per entry', () => {
    const store = LedgerStore.create(mkdtempSync(join(tmpdir(), 'ledger-')), header);
    for (const legacyId of [1, 2]) {
      store.upsert({
        legacyTable: 'pages', legacyId, kind: 'page', variant: null,
        marker: `m${legacyId}`, v3Id: `pg_${legacyId}`, state: 'done', runId: 'run-1',
        createdAt: 'x', updatedAt: 'x', contentHash: 'c', referenceHash: null,
        revisionToken: '1', asset: null,
      });
    }
    expect(exportJsonl(store).trim().split('\n')).toHaveLength(2);
  });

  it('flattens every header field onto every row, so a row stands alone', () => {
    const store = LedgerStore.create(mkdtempSync(join(tmpdir(), 'ledger-')), header);
    store.upsert({
      legacyTable: 'pages', legacyId: 1, kind: 'page', variant: null, marker: 'm1',
      v3Id: 'pg_1', state: 'done', runId: 'run-1', createdAt: 'x', updatedAt: 'x',
      contentHash: 'c', referenceHash: null, revisionToken: '1', asset: null,
    });
    const row = JSON.parse(exportJsonl(store).trim()) as Record<string, unknown>;
    expect(row['sourceHost']).toBe('replica.example.com');
    expect(row['ledgerVersion']).toBe(1);
    expect(row['marker']).toBe('m1');
  });

  it('emits nothing but a trailing newline for an empty ledger', () => {
    const store = LedgerStore.create(mkdtempSync(join(tmpdir(), 'ledger-')), header);
    expect(exportJsonl(store).trim()).toBe('');
  });
});
