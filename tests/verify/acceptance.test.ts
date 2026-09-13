import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateAcceptance } from '../../src/verify/acceptance.js';
import { LedgerStore } from '../../src/ledger/store.js';
import type { LedgerHeader } from '../../src/ledger/schema.js';
import type { StructuralReport } from '../../src/verify/report.js';
import type { Plan } from '../../src/map/plan.js';

const header: LedgerHeader = {
  ledgerVersion: 1, toolVersion: '0.1.0', sourceHost: 'h', legacyHubId: 7,
  profileName: 'test', targetApiBase: 'https://api.example.com', targetTeamId: 't',
  targetHubId: 'hub_1', runId: 'run-1', planHash: 'h',
};

function store(): LedgerStore {
  return LedgerStore.create(mkdtempSync(join(tmpdir(), 'ledger-')), header);
}

function report(overrides: Partial<StructuralReport> = {}): StructuralReport {
  return {
    runId: 'run-1',
    pages: [{ slug: 'about', pageType: 'generic', legacySectionCount: 1, catalogSectionCount: 1, nodeCount: 3, warningsByType: {}, targetSectionCount: 1, drift: 'match' }],
    counts: { planPages: 1, targetPages: 1, planPlaylists: 0, targetPlaylists: 0, planFolders: 0, targetFolders: 0, planAssets: 0, targetFiles: 0 },
    warningsByType: {}, driftedPages: [],
    ...overrides,
  };
}

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1, toolVersion: '0.1.0', catalogVersion: '0.23.6', catalogDigest: 'd',
    legacyHubId: 7, sourceHost: 'h',
    hub: { title: 'T', slug: 's', description: null, isPrivate: true },
    branding: {}, pages: [], playlists: [], folders: [], assets: [], spaces: [],
    achievements: [], segments: [], tags: [], accessRules: [], excludedPages: [],
    navigation: { header: [], footer: [], mobile: [] }, warnings: [],
    ...overrides,
  } as Plan;
}

const clean = { report: report(), plan: plan(), store: store(), playback: [], authz: [], milestone: 'M1' as const };

describe('evaluateAcceptance', () => {
  it('accepts a clean run', () => {
    expect(evaluateAcceptance(clean).accepted).toBe(true);
  });

  it('rejects a page count mismatch between plan and target', () => {
    const verdict = evaluateAcceptance({
      ...clean,
      report: report({ counts: { ...report().counts, targetPages: 0 } }),
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.failures.join(' ')).toContain('page count');
  });

  it('rejects a section count mismatch on any page', () => {
    const verdict = evaluateAcceptance({
      ...clean,
      report: report({ pages: [{ ...report().pages[0]!, targetSectionCount: 4 }] }),
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.failures.join(' ')).toContain('about');
  });

  it('does not fail on the content page, which V3 renders itself, but notes it for sign-off', () => {
    const verdict = evaluateAcceptance({
      ...clean,
      report: report({ pages: [{ ...report().pages[0]!, slug: 'content', pageType: 'content', targetSectionCount: 0 }] }),
    });
    expect(verdict.accepted).toBe(true);
    expect(verdict.forSignoff.join(' ')).toContain("V3's content page");
  });

  it('rejects any dropped warning', () => {
    const verdict = evaluateAcceptance({
      ...clean,
      plan: plan({ warnings: [{ pageSlug: 'about', legacySectionId: 1, type: 'dropped', reason: 'lost a section' }] }),
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.failures.join(' ')).toContain('dropped');
  });

  it('rejects a failed playback result at either stage', () => {
    const verdict = evaluateAcceptance({
      ...clean,
      playback: [{ url: 'u', stage: 'browser', ok: false, reason: 'CORS', contentType: null, checkedAt: 'x' }],
    });
    expect(verdict.accepted).toBe(false);
  });

  it('rejects a failed authorization check', () => {
    const verdict = evaluateAcceptance({
      ...clean,
      authz: [{
        target: { kind: 'asset', ref: 'f1', url: 'u', rule: 'members' },
        observed: { anonymous: 'allowed', memberNoEntitlement: 'allowed', memberEntitled: 'allowed' },
        pass: false, reason: 'anonymous was allowed',
      }],
    });
    expect(verdict.accepted).toBe(false);
  });

  it('accepts a legacy-linked asset in M1 but rejects it in M2', () => {
    const s = store();
    s.upsert({
      legacyTable: 'media', legacyId: 1, kind: 'asset', variant: 'original',
      marker: 'm', v3Id: null, state: 'legacy-linked', runId: 'run-1',
      createdAt: 'x', updatedAt: 'x', contentHash: 'c', referenceHash: null,
      revisionToken: null, asset: null,
    });
    expect(evaluateAcceptance({ ...clean, store: s, milestone: 'M1' }).accepted).toBe(true);
    expect(evaluateAcceptance({ ...clean, store: s, milestone: 'M2' }).accepted).toBe(false);
  });

  it('lists approximated and access-unmapped warnings for sign-off without failing the run', () => {
    const verdict = evaluateAcceptance({
      ...clean,
      plan: plan({
        warnings: [
          { pageSlug: 'about', legacySectionId: 1, type: 'approximated', reason: 'cta band' },
          { pageSlug: 'about', legacySectionId: 2, type: 'access-unmapped', reason: 'segment 99' },
        ],
      }),
    });
    expect(verdict.accepted).toBe(true);
    expect(verdict.forSignoff).toHaveLength(2);
  });

  it('rejects a run whose page drifted on the target', () => {
    const verdict = evaluateAcceptance({ ...clean, report: report({ driftedPages: ['about'] }) });
    expect(verdict.accepted).toBe(false);
    expect(verdict.failures.join(' ')).toContain('target-edited');
  });
});
