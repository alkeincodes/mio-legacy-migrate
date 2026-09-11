import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStructuralReport, publishedRootOf, renderReportMarkdown } from '../../src/verify/report.js';
import { LedgerStore } from '../../src/ledger/store.js';
import { contentHash, type Plan } from '../../src/map/plan.js';
import type { LedgerHeader } from '../../src/ledger/schema.js';

const header: LedgerHeader = {
  ledgerVersion: 1, toolVersion: '0.1.0', sourceHost: 'replica.example.com',
  legacyHubId: 7, profileName: 'test', targetApiBase: 'https://api.example.com',
  targetTeamId: 'team-1', targetHubId: 'hub_1', runId: 'run-1', planHash: 'h',
};

function plan(): Plan {
  return {
    planVersion: 1, toolVersion: '0.1.0', catalogVersion: '0.23.6',
    catalogDigest: 'sha256:abc', legacyHubId: 7, sourceHost: 'replica.example.com',
    hub: { title: 'ManTalks', slug: 'alliance', description: null, isPrivate: true },
    branding: {},
    pages: [
      {
        legacyPageId: 100, slug: 'about', title: 'About', pageType: 'generic',
        privacy: 'members', isHomepage: false, restrictedSectionNodeIds: [],
        tree: {
          id: 'root', kind: 'stack',
          children: [
            { id: 's1', kind: 'container', template: 'row', children: [{ id: 'h', kind: 'headline', value: 'Hi' }] },
          ],
        },
      },
    ],
    playlists: [], folders: [], assets: [], spaces: [], achievements: [],
    segments: [], accessRules: [],
    navigation: { header: [], footer: [], mobile: [] },
    warnings: [
      { pageSlug: 'about', legacySectionId: 1, type: 'approximated', reason: 'cta' },
      { pageSlug: 'about', legacySectionId: 2, type: 'access-unmapped', reason: 'segment 99' },
    ],
  };
}

function store(): LedgerStore {
  return LedgerStore.create(mkdtempSync(join(tmpdir(), 'ledger-')), header);
}

describe('buildStructuralReport', () => {
  it('counts catalog sections and nodes per page', () => {
    const report = buildStructuralReport({
      plan: plan(), store: store(),
      live: { pages: [{ slug: 'about', sectionCount: 1, publishedTreeDigest: null }], playlists: 0, folders: 0, files: 0 },
    });
    expect(report.pages[0]?.catalogSectionCount).toBe(1);
    expect(report.pages[0]?.nodeCount).toBe(3);
  });

  it('groups warnings by type per page and across the run', () => {
    const report = buildStructuralReport({
      plan: plan(), store: store(),
      live: { pages: [{ slug: 'about', sectionCount: 1, publishedTreeDigest: null }], playlists: 0, folders: 0, files: 0 },
    });
    expect(report.pages[0]?.warningsByType).toEqual({ approximated: 1, 'access-unmapped': 1 });
    expect(report.warningsByType).toEqual({ approximated: 1, 'access-unmapped': 1 });
  });

  it('compares plan counts with live target counts', () => {
    const report = buildStructuralReport({
      plan: plan(), store: store(),
      live: { pages: [{ slug: 'about', sectionCount: 1, publishedTreeDigest: null }], playlists: 3, folders: 2, files: 9 },
    });
    expect(report.counts).toMatchObject({ planPages: 1, targetPages: 1, targetPlaylists: 3, targetFolders: 2, targetFiles: 9 });
  });

  it('reports a section-count mismatch on the page row', () => {
    const report = buildStructuralReport({
      plan: plan(), store: store(),
      live: { pages: [{ slug: 'about', sectionCount: 4, publishedTreeDigest: null }], playlists: 0, folders: 0, files: 0 },
    });
    expect(report.pages[0]?.targetSectionCount).toBe(4);
    expect(report.pages[0]?.catalogSectionCount).toBe(1);
  });

  it('flags target-edited when the published digest differs from what apply wrote', () => {
    const s = store();
    const p = plan();
    s.upsert({
      legacyTable: 'pages', legacyId: 100, kind: 'page', variant: null,
      marker: 'm1', v3Id: 'pg_1', state: 'done', runId: 'run-1',
      createdAt: 'x', updatedAt: 'x',
      contentHash: contentHash(p.pages[0]?.tree), referenceHash: null,
      revisionToken: '3', asset: null,
    });
    const report = buildStructuralReport({
      plan: p, store: s,
      live: { pages: [{ slug: 'about', sectionCount: 1, publishedTreeDigest: 'a-different-digest' }], playlists: 0, folders: 0, files: 0 },
    });
    expect(report.pages[0]?.drift).toBe('target-edited');
    expect(report.driftedPages).toEqual(['about']);
  });

  it('reports match when the published digest equals what apply wrote', () => {
    const s = store();
    const p = plan();
    const digest = contentHash(p.pages[0]?.tree);
    s.upsert({
      legacyTable: 'pages', legacyId: 100, kind: 'page', variant: null,
      marker: 'm1', v3Id: 'pg_1', state: 'done', runId: 'run-1',
      createdAt: 'x', updatedAt: 'x', contentHash: digest,
      referenceHash: null, revisionToken: '3', asset: null,
    });
    const report = buildStructuralReport({
      plan: p, store: s,
      live: { pages: [{ slug: 'about', sectionCount: 1, publishedTreeDigest: digest }], playlists: 0, folders: 0, files: 0 },
    });
    expect(report.pages[0]?.drift).toBe('match');
  });

  it('reports unknown drift when the page has no live digest, rather than claiming a match', () => {
    const report = buildStructuralReport({
      plan: plan(), store: store(),
      live: { pages: [{ slug: 'about', sectionCount: 1, publishedTreeDigest: null }], playlists: 0, folders: 0, files: 0 },
    });
    expect(report.pages[0]?.drift).toBe('unknown');
  });
});

describe('renderReportMarkdown', () => {
  it('redacts email addresses, because the report is the one artifact that gets shared', () => {
    const p = plan();
    p.warnings.push({ pageSlug: 'about', legacySectionId: 3, type: 'approximated', reason: 'testimonial from jo@example.com' });
    const report = buildStructuralReport({
      plan: p, store: store(),
      live: { pages: [{ slug: 'about', sectionCount: 1, publishedTreeDigest: null }], playlists: 0, folders: 0, files: 0 },
    });
    const markdown = renderReportMarkdown(report, p);
    expect(markdown).not.toContain('jo@example.com');
    expect(markdown).toContain('[redacted-email]');
  });

  it('lists approximated and access-unmapped warnings for human sign-off', () => {
    const p = plan();
    const report = buildStructuralReport({
      plan: p, store: store(),
      live: { pages: [{ slug: 'about', sectionCount: 1, publishedTreeDigest: null }], playlists: 0, folders: 0, files: 0 },
    });
    const markdown = renderReportMarkdown(report, p);
    expect(markdown).toContain('Warnings for sign-off');
    expect(markdown).toContain('segment 99');
  });

  it('carries a signature line, because a run is accepted when a named person signs it', () => {
    const p = plan();
    const report = buildStructuralReport({
      plan: p, store: store(),
      live: { pages: [{ slug: 'about', sectionCount: 1, publishedTreeDigest: null }], playlists: 0, folders: 0, files: 0 },
    });
    expect(renderReportMarkdown(report, p)).toContain('Signed off by:');
  });
});

describe('publishedRootOf', () => {
  it('unwraps the {root} envelope the resolve=false read returns', () => {
    const root = { id: 'r', kind: 'stack', children: [{ id: 'a', kind: 'container', template: 'row', children: [] }] };
    expect(publishedRootOf({ data: { attributes: { tree: { root } } } })).toEqual(root);
  });

  it('returns null for a page with no published tree or a non-tree body', () => {
    expect(publishedRootOf({ data: { attributes: { slug: 'x' } } })).toBeNull();
    expect(publishedRootOf(null)).toBeNull();
  });
});
