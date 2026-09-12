import type { CatalogNode } from '../catalog.js';
import { commonGap, visibleGaps } from '../profile/rhythm.js';
import type { Align, ColumnProfile, ElementProfile } from '../profile/types.js';
import { stackWidthFor, type Surface } from '../style.js';
import { FIDELITY_THRESHOLD_PX, STACK_GAP_PX, snapPx, stackGapSetting } from './fidelity.js';

export interface PlacedElement { node: CatalogNode; profile: ElementProfile; legacyId: number }

export interface ColumnStackArgs {
  id: string;
  profile: ColumnProfile;
  elements: PlacedElement[];
  surface: Surface | null;
  /** Mints a wrapper id for the element with this legacy id; n distinguishes wrappers on one element. */
  mintId(legacyId: number, n: number): string;
}

const STACK_ALIGN: Record<Align, string> = { left: 'start', center: 'center', right: 'end' };

/** A maximal run of consecutive buttons sharing one alignment, or a single element of any other kind. */
interface Unit { start: number; end: number; buttons: boolean }

function units(elements: PlacedElement[]): Unit[] {
  const out: Unit[] = [];
  let i = 0;
  while (i < elements.length) {
    const first = elements[i]!;
    if (first.profile.kind !== 'button') { out.push({ start: i, end: i, buttons: false }); i += 1; continue; }
    let j = i;
    while (j + 1 < elements.length && elements[j + 1]!.profile.kind === 'button' && elements[j + 1]!.profile.align === first.profile.align) j += 1;
    out.push({ start: i, end: j, buttons: true });
    i = j + 1;
  }
  return out;
}

/**
 * One legacy column as a V3 stack. The stack's gap is the column's most common
 * visible gap; buttons sit in a run wrapper so they shrink-wrap like legacy's
 * inline-block .btn; anything more than the threshold off the common gap gets a
 * wrapper carrying the exact offset as a freeform surface.margin.
 */
export function columnStack(args: ColumnStackArgs): CatalogNode {
  const { elements, profile } = args;
  const gaps = visibleGaps(elements.map((e) => e.profile));
  const stackGapPx = elements.length > 1 ? snapPx(commonGap(gaps), STACK_GAP_PX) : 0;

  const children: CatalogNode[] = [];
  for (const unit of units(elements)) {
    const first = elements[unit.start]!;
    const gapBefore = gaps[unit.start] ?? 0;
    // Before the first element there is no stack gap, so the whole margin is the offset.
    const delta = unit.start === 0 ? gapBefore : gapBefore - stackGapPx;
    const needsOffset = Math.abs(delta) > FIDELITY_THRESHOLD_PX;
    const nodes = elements.slice(unit.start, unit.end + 1).map((e) => e.node);

    if (!unit.buttons && !needsOffset) { children.push(first.node); continue; }

    const settings: Record<string, unknown> = {};
    if (unit.buttons) {
      settings['align'] = STACK_ALIGN[first.profile.align];
      const runGaps = gaps.slice(unit.start, unit.end + 1);
      settings['gap'] = runGaps.length > 1 ? stackGapSetting(snapPx(commonGap(runGaps), STACK_GAP_PX)) : 0;
    } else {
      settings['gap'] = 0;
    }
    if (needsOffset) settings['surface'] = { margin: `${delta}px 0 0` };
    children.push({ id: args.mintId(first.legacyId, 0), kind: 'stack', settings, children: nodes });
  }

  const settings: Record<string, unknown> = { gap: stackGapSetting(stackGapPx), width: stackWidthFor(profile.widthPct) };
  if (profile.justify !== 'start') settings['justify'] = profile.justify;
  if (args.surface) settings['surface'] = args.surface;
  return { id: args.id, kind: 'stack', settings, children };
}
