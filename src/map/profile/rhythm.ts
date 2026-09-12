import type { ElementProfile } from './types.js';

/**
 * The gap a member sees above each element: the first element's own margin-top,
 * then max(previous bottom margin, this margin-top), which is what the browser
 * shows after the two margins collapse (Item.vue:56-60, _typography.scss).
 */
export function visibleGaps(profiles: ElementProfile[]): number[] {
  return profiles.map((p, i) => {
    const prev = profiles[i - 1];
    return prev ? Math.max(prev.bottomMargin, p.marginTop) : p.marginTop;
  });
}

/** The gap that occurs most often between neighbours (index 1 onward); ties go to the smaller. */
export function commonGap(gaps: number[]): number {
  const counts = new Map<number, number>();
  for (const gap of gaps.slice(1)) counts.set(gap, (counts.get(gap) ?? 0) + 1);
  let best: { gap: number; n: number } | null = null;
  for (const [gap, n] of counts) {
    if (!best || n > best.n || (n === best.n && gap < best.gap)) best = { gap, n };
  }
  return best?.gap ?? 0;
}
