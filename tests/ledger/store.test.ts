import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LedgerMismatchError, LedgerStore, ledgerDir } from '../../src/ledger/store.js';
import type { LedgerEntry, LedgerHeader } from '../../src/ledger/schema.js';

function header(overrides: Partial<LedgerHeader> = {}): LedgerHeader {
  return {
    ledgerVersion: 1, toolVersion: '0.1.0', sourceHost: 'replica.example.com',
    legacyHubId: 7, profileName: 'mantalks-prod',
    targetApiBase: 'https://api.member.dev',
    targetTeamId: '01a090ff-5ac3-7402-b686-66fd46af67bc',
    targetHubId: null, runId: 'run-1', planHash: 'abc123',
    ...overrides,
  };
}

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    legacyTable: 'pages', legacyId: 100, kind: 'page', variant: null,
    marker: 'lgc:aabbccdd:100:run:run-1', v3Id: null, state: 'intent',
    runId: 'run-1', createdAt: '2026-09-12T10:00:00.000Z',
    updatedAt: '2026-09-12T10:00:00.000Z', contentHash: 'h1',
    referenceHash: null, revisionToken: null, asset: null,
    ...overrides,
  };
}

describe('ledgerDir', () => {
  it('is keyed by profile and legacy hub', () => {
    expect(ledgerDir('mantalks-prod', 7)).toBe('ledger/mantalks-prod/7');
  });
});

describe('LedgerStore', () => {
  it('creates a run file named by the run id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    const store = LedgerStore.create(dir, header());
    expect(store.path.endsWith('run-1.json')).toBe(true);
    expect(readdirSync(dir)).toContain('run-1.json');
  });

  it('writes atomically, leaving no temp file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    const store = LedgerStore.create(dir, header());
    store.upsert(entry());
    expect(readdirSync(dir).some((f) => f.includes('.tmp'))).toBe(false);
  });

  it('upserts on marker rather than appending a duplicate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    const store = LedgerStore.create(dir, header());
    store.upsert(entry());
    store.upsert(entry({ state: 'done', v3Id: 'pg_1' }));
    expect(store.all()).toHaveLength(1);
    expect(store.find('lgc:aabbccdd:100:run:run-1')?.state).toBe('done');
  });

  it('survives a reopen of the same run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    LedgerStore.create(dir, header()).upsert(entry({ state: 'done', v3Id: 'pg_1' }));
    expect(LedgerStore.open(dir, 'run-1').find('lgc:aabbccdd:100:run:run-1')?.v3Id).toBe('pg_1');
  });

  it('records the target hub id on the header once the hub exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    const store = LedgerStore.create(dir, header());
    store.setTargetHubId('hub_abc');
    expect(LedgerStore.open(dir, 'run-1').header.targetHubId).toBe('hub_abc');
  });

  it('lists entries by state so resume can find every intent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    const store = LedgerStore.create(dir, header());
    store.upsert(entry({ marker: 'm1', state: 'intent' }));
    store.upsert(entry({ marker: 'm2', state: 'done' }));
    expect(store.byState('intent').map((e) => e.marker)).toEqual(['m1']);
  });
});

describe('LedgerStore.openForResume', () => {
  it('opens when every header field matches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    LedgerStore.create(dir, header());
    expect(() => LedgerStore.openForResume(dir, 'run-1', header())).not.toThrow();
  });

  it.each([
    ['sourceHost', { sourceHost: 'other.example.com' }],
    ['legacyHubId', { legacyHubId: 8 }],
    ['profileName', { profileName: 'dev' }],
    ['targetApiBase', { targetApiBase: 'https://api.example.com' }],
    ['targetTeamId', { targetTeamId: 'other-team' }],
    ['planHash', { planHash: 'different' }],
  ])('refuses a resume whose %s differs', (field, patch) => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    LedgerStore.create(dir, header());
    expect(() => LedgerStore.openForResume(dir, 'run-1', header(patch))).toThrow(LedgerMismatchError);
    expect(() => LedgerStore.openForResume(dir, 'run-1', header(patch))).toThrow(new RegExp(field));
  });

  it('accepts a changed plan hash only with acceptPlanChange, and records the new hash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    LedgerStore.create(dir, header());
    const store = LedgerStore.openForResume(dir, 'run-1', header({ planHash: 'different' }), { acceptPlanChange: true });
    expect(store.header.planHash).toBe('abc123');
    store.acceptPlanChange('different');
    expect(LedgerStore.open(dir, 'run-1').header).toMatchObject({ planHash: 'different', previousPlanHash: 'abc123' });
  });

  it('refuses a resume whose target hub id differs from the recorded one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    LedgerStore.create(dir, header()).setTargetHubId('hub_abc');
    expect(() =>
      LedgerStore.openForResume(dir, 'run-1', header({ targetHubId: 'hub_xyz' })),
    ).toThrow(/targetHubId/);
  });

  it('rejects a corrupt ledger file with a message naming the path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    writeFileSync(join(dir, 'run-1.json'), '{ not json', 'utf8');
    expect(() => LedgerStore.open(dir, 'run-1')).toThrow(/run-1\.json is not valid JSON/);
  });
});
