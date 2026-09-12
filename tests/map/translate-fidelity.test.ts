import { describe, expect, it } from 'vitest';
import { STACK_GAP_PX, collapseFidelity, fidelityWarning, snapPx, stackGapSetting } from '../../src/map/translate/fidelity.js';

describe('fidelityWarning', () => {
  it('builds a plan warning with the structured fields and a readable reason', () => {
    expect(fidelityWarning({ property: 'image.maxWidth', legacy: '250px', v3: '352px' }, 'home', 42)).toEqual({
      pageSlug: 'home', legacySectionId: 42, type: 'fidelity', reason: 'image.maxWidth: 250px -> 352px', property: 'image.maxWidth', legacy: '250px', v3: '352px', count: 1,
    });
  });

  it('a hub-wide entry carries no page or section', () => {
    expect(fidelityWarning({ property: 'button.chrome', legacy: 'a', v3: 'b', hubWide: true }, 'home', 42)).toMatchObject({ pageSlug: null, legacySectionId: null, count: 1 });
  });
});

describe('collapseFidelity', () => {
  it('merges identical hub-wide entries into one with a count, leaves everything else alone', () => {
    const a = fidelityWarning({ property: 'button.chrome', legacy: 'a', v3: 'b', hubWide: true }, 'home', 1);
    const b = fidelityWarning({ property: 'button.chrome', legacy: 'a', v3: 'b', hubWide: true }, 'about', 2);
    const c = fidelityWarning({ property: 'image.maxWidth', legacy: '250px', v3: '352px' }, 'home', 3);
    const other = { pageSlug: 'home', legacySectionId: 4, type: 'approximated' as const, reason: 'x' };
    expect(collapseFidelity([a, other, b, c])).toEqual([{ ...a, count: 2 }, other, c]);
  });
});

describe('snapping', () => {
  it('snaps to the nearest allowed value, lower on a tie', () => {
    expect(snapPx(30, STACK_GAP_PX)).toBe(32);
    expect(snapPx(20, STACK_GAP_PX)).toBe(20);
    expect(snapPx(18, STACK_GAP_PX)).toBe(16);
    expect(snapPx(100, STACK_GAP_PX)).toBe(48);
  });

  it('turns a snapped px into the stack gap setting (4px units)', () => {
    expect(stackGapSetting(20)).toBe(5);
    expect(stackGapSetting(32)).toBe(8);
    expect(stackGapSetting(2)).toBe(0.5);
    expect(stackGapSetting(0)).toBe(0);
  });
});
