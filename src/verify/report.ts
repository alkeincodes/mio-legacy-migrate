import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogNode } from '../map/catalog.js';
import { contentHash, type Plan } from '../map/plan.js';
import type { LedgerStore } from '../ledger/store.js';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export interface PageReportRow {
  slug: string;
  legacySectionCount: number;
  catalogSectionCount: number;
  nodeCount: number;
  warningsByType: Record<string, number>;
  targetSectionCount: number | null;
  drift: 'match' | 'target-edited' | 'unknown';
}

export interface LiveCounts {
  pages: Array<{ slug: string; sectionCount: number; publishedTreeDigest: string | null }>;
  playlists: number;
  folders: number;
  files: number;
}

export interface StructuralReport {
  runId: string;
  pages: PageReportRow[];
  counts: {
    planPages: number; targetPages: number;
    planPlaylists: number; targetPlaylists: number;
    planFolders: number; targetFolders: number;
    planAssets: number; targetFiles: number;
  };
  warningsByType: Record<string, number>;
  driftedPages: string[];
}

function countNodes(node: CatalogNode): number {
  let count = 1;
  for (const child of node.children ?? []) count += countNodes(child);
  return count;
}

export function buildStructuralReport(opts: {
  plan: Plan;
  store: LedgerStore;
  live: LiveCounts;
}): StructuralReport {
  const liveBySlug = new Map(opts.live.pages.map((p) => [p.slug, p]));
  const writtenDigestByPageId = new Map(
    opts.store.all().filter((e) => e.kind === 'page').map((e) => [e.legacyId, e.contentHash]),
  );

  const warningsByType: Record<string, number> = {};
  const driftedPages: string[] = [];
  const pages: PageReportRow[] = [];

  for (const page of opts.plan.pages) {
    const pageWarnings: Record<string, number> = {};
    for (const warning of opts.plan.warnings) {
      if (warning.pageSlug !== page.slug) continue;
      pageWarnings[warning.type] = (pageWarnings[warning.type] ?? 0) + 1;
      warningsByType[warning.type] = (warningsByType[warning.type] ?? 0) + 1;
    }

    const liveRow = liveBySlug.get(page.slug);
    const writtenDigest = writtenDigestByPageId.get(page.legacyPageId);
    let drift: PageReportRow['drift'] = 'unknown';
    if (liveRow?.publishedTreeDigest && writtenDigest) {
      drift = liveRow.publishedTreeDigest === writtenDigest ? 'match' : 'target-edited';
      if (drift === 'target-edited') driftedPages.push(page.slug);
    }

    pages.push({
      slug: page.slug,
      legacySectionCount: page.tree.children?.length ?? 0,
      catalogSectionCount: (page.tree.children ?? []).filter((c) => c.template !== undefined).length,
      nodeCount: countNodes(page.tree),
      warningsByType: pageWarnings,
      targetSectionCount: liveRow?.sectionCount ?? null,
      drift,
    });
  }

  // Warnings with no page (branding, navigation) still belong in the run total.
  for (const warning of opts.plan.warnings) {
    if (warning.pageSlug !== null) continue;
    warningsByType[warning.type] = (warningsByType[warning.type] ?? 0) + 1;
  }

  return {
    runId: opts.store.header.runId,
    pages,
    counts: {
      planPages: opts.plan.pages.length,
      targetPages: opts.live.pages.length,
      planPlaylists: opts.plan.playlists.length,
      targetPlaylists: opts.live.playlists,
      planFolders: opts.plan.folders.length,
      targetFolders: opts.live.folders,
      planAssets: opts.plan.assets.length,
      targetFiles: opts.live.files,
    },
    warningsByType,
    driftedPages,
  };
}

function redact(text: string): string {
  return text.replace(EMAIL, '[redacted-email]');
}

export function renderReportMarkdown(report: StructuralReport, plan: Plan): string {
  const lines: string[] = [];
  lines.push(`# Migration run ${report.runId}`);
  lines.push('');
  lines.push(`Legacy hub ${plan.legacyHubId} on ${plan.sourceHost}, catalog ${plan.catalogVersion}.`);
  lines.push('');
  lines.push('## Counts');
  lines.push('');
  lines.push('| thing | plan | target |');
  lines.push('| --- | --- | --- |');
  lines.push(`| pages | ${report.counts.planPages} | ${report.counts.targetPages} |`);
  lines.push(`| playlists | ${report.counts.planPlaylists} | ${report.counts.targetPlaylists} |`);
  lines.push(`| folders | ${report.counts.planFolders} | ${report.counts.targetFolders} |`);
  lines.push(`| assets | ${report.counts.planAssets} | ${report.counts.targetFiles} |`);
  lines.push('');
  lines.push('## Pages');
  lines.push('');
  lines.push('| slug | sections emitted | sections on target | nodes | drift | warnings |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const row of report.pages) {
    const warnings = Object.entries(row.warningsByType).map(([t, n]) => `${t}:${n}`).join(' ') || 'none';
    lines.push(
      `| ${row.slug} | ${row.catalogSectionCount} | ${row.targetSectionCount ?? 'unknown'} | ${row.nodeCount} | ${row.drift} | ${warnings} |`,
    );
  }
  lines.push('');
  lines.push('## Warnings for sign-off');
  lines.push('');
  const forSignoff = plan.warnings.filter(
    (w) => w.type === 'approximated' || w.type === 'access-unmapped',
  );
  if (forSignoff.length === 0) {
    lines.push('None.');
  } else {
    for (const warning of forSignoff) {
      lines.push(`- ${warning.type} on ${warning.pageSlug ?? 'the hub'}: ${redact(warning.reason)}`);
    }
  }
  lines.push('');
  lines.push('## Acceptance');
  lines.push('');
  lines.push('Signed off by: ______________________  date: ____________');
  return lines.join('\n');
}

export function writeReport(markdown: string, runDir: string): string {
  mkdirSync(runDir, { recursive: true });
  const path = join(runDir, 'report.md');
  writeFileSync(path, markdown, 'utf8');
  return path;
}
