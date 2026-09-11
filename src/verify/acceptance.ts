import type { Plan } from '../map/plan.js';
import type { LedgerStore } from '../ledger/store.js';
import type { PlaybackResult } from '../apply/playbackPrefilter.js';
import type { StructuralReport } from './report.js';
import type { AuthzResult } from './authz.js';

export interface AcceptanceInput {
  report: StructuralReport;
  plan: Plan;
  store: LedgerStore;
  playback: PlaybackResult[];
  authz: AuthzResult[];
  milestone: 'M1' | 'M2';
}

export interface AcceptanceVerdict {
  accepted: boolean;
  failures: string[];
  forSignoff: string[];
}

/** Spec 7.4, with the M1 relaxation that legacy-linked counts as an acceptable asset state. */
export function evaluateAcceptance(input: AcceptanceInput): AcceptanceVerdict {
  const failures: string[] = [];

  if (input.report.counts.planPages !== input.report.counts.targetPages) {
    failures.push(
      `page count mismatch: the plan has ${input.report.counts.planPages} and the target has ${input.report.counts.targetPages}`,
    );
  }
  for (const page of input.report.pages) {
    if (page.targetSectionCount !== null && page.targetSectionCount !== page.catalogSectionCount) {
      failures.push(
        `section count mismatch on /${page.slug}: emitted ${page.catalogSectionCount}, target has ${page.targetSectionCount}`,
      );
    }
  }
  if (input.report.driftedPages.length > 0) {
    failures.push(`target-edited pages: ${input.report.driftedPages.join(', ')}`);
  }

  const dropped = input.plan.warnings.filter((w) => w.type === 'dropped');
  for (const warning of dropped) {
    failures.push(`dropped warning on ${warning.pageSlug ?? 'the hub'}: ${warning.reason}`);
  }

  for (const result of input.playback) {
    if (!result.ok) failures.push(`playback ${result.stage} failed for ${result.url}: ${result.reason ?? 'unknown'}`);
  }

  for (const result of input.authz) {
    if (!result.pass) {
      failures.push(`authorization check failed for ${result.target.kind} ${result.target.ref}: ${result.reason ?? 'unknown'}`);
    }
  }

  const acceptableAssetStates = input.milestone === 'M1'
    ? new Set(['verified', 'legacy-linked'])
    : new Set(['verified']);
  for (const entry of input.store.all()) {
    if (entry.kind !== 'asset') continue;
    if ((entry.state === 'pending-import' || entry.state === 'pending-copy') && input.milestone === 'M1') continue;
    if (!acceptableAssetStates.has(entry.state) && entry.state !== 'pending-import' && entry.state !== 'pending-copy') {
      failures.push(`asset ${entry.legacyId}/${entry.variant ?? 'original'} is in state ${entry.state}`);
    }
    if (input.milestone === 'M2' && entry.state !== 'verified') {
      failures.push(`asset ${entry.legacyId}/${entry.variant ?? 'original'} is ${entry.state}; M2 requires verified`);
    }
  }

  const forSignoff = input.plan.warnings
    .filter((w) => w.type === 'approximated' || w.type === 'access-unmapped')
    .map((w) => `${w.type} on ${w.pageSlug ?? 'the hub'}: ${w.reason}`);

  return { accepted: failures.length === 0, failures, forSignoff };
}
