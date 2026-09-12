import type { PlanWarning } from '../plan.js';

/** A legacy value V3 cannot draw exactly, with what it will draw instead. */
export interface FidelityEntry {
  property: string;
  legacy: string;
  v3: string;
  /** True for entries that describe the whole hub (button chrome); they carry no page or section. */
  hubWide?: boolean;
}

/** Differences of this many px or fewer are not worth an entry (spec 5.6). */
export const FIDELITY_THRESHOLD_PX = 4;

export function fidelityWarning(entry: FidelityEntry, pageSlug: string | null, legacySectionId: number | null): PlanWarning {
  return {
    pageSlug: entry.hubWide ? null : pageSlug,
    legacySectionId: entry.hubWide ? null : legacySectionId,
    type: 'fidelity',
    reason: `${entry.property}: ${entry.legacy} -> ${entry.v3}`,
    property: entry.property,
    legacy: entry.legacy,
    v3: entry.v3,
    count: 1,
  };
}

/** Hub-wide fidelity warnings with the same reason become one entry whose count is their number. */
export function collapseFidelity(warnings: PlanWarning[]): PlanWarning[] {
  const out: PlanWarning[] = [];
  const hubWide = new Map<string, PlanWarning>();
  for (const w of warnings) {
    if (w.type !== 'fidelity' || w.pageSlug !== null || w.legacySectionId !== null) { out.push(w); continue; }
    const existing = hubWide.get(w.reason);
    if (existing) existing.count = (existing.count ?? 1) + (w.count ?? 1);
    else { const copy = { ...w, count: w.count ?? 1 }; hubWide.set(w.reason, copy); out.push(copy); }
  }
  return out;
}

/** stack.tsx:160-178: gap enum 0 .. 12 in 4px units. */
export const STACK_GAP_PX: readonly number[] = [0, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 48];

export function snapPx(value: number, allowed: readonly number[]): number {
  let best = allowed[0] ?? 0;
  for (const candidate of allowed) {
    const d = Math.abs(candidate - value);
    const bestD = Math.abs(best - value);
    if (d < bestD || (d === bestD && candidate < best)) best = candidate;
  }
  return best;
}

/** A snapped px value to the setting V3 wants (px / 4). */
export function stackGapSetting(snapped: number): number {
  return snapped / 4;
}
