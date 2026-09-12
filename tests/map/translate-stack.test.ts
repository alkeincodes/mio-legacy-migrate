import { describe, expect, it } from 'vitest';
import type { CatalogNode } from '../../src/map/catalog.js';
import type { ColumnProfile, ElementProfile } from '../../src/map/profile/types.js';
import { columnStack, type PlacedElement } from '../../src/map/translate/stack.js';

const column: ColumnProfile = { widthPct: 50, justify: 'center', padding: null, radius: null, shadow: null };
const mintId = (legacyId: number, n: number): string => `w-${legacyId}-${n}`;

function placed(legacyId: number, profile: Partial<ElementProfile> & { kind: ElementProfile['kind'] }, node: Partial<CatalogNode> = {}): PlacedElement {
  const full = { align: 'left', marginTop: 30, bottomMargin: 0, ...profile } as ElementProfile;
  return { node: { id: `n-${legacyId}`, kind: profile.kind === 'other' ? 'video' : profile.kind, value: 'x', ...node }, profile: full, legacyId };
}

describe('columnStack', () => {
  it('the hero column: justify center, gap 20, the two buttons in one start-aligned run with a 32px gap', () => {
    const node = columnStack({
      id: 'col', profile: column, surface: null, mintId,
      elements: [
        placed(1, { kind: 'headline', level: 2, fontSize: 32, marginTop: 0, bottomMargin: 20 }),
        placed(2, { kind: 'text', marginTop: 0, bottomMargin: 20 }),
        placed(3, { kind: 'button', marginTop: 0, chrome: {} as never, fullWidth: false, colours: null }),
        placed(4, { kind: 'button', marginTop: 30, chrome: {} as never, fullWidth: false, colours: null }),
      ],
    });
    expect(node).toEqual({
      id: 'col', kind: 'stack', settings: { gap: 5, width: '1/2', justify: 'center' },
      children: [
        { id: 'n-1', kind: 'headline', value: 'x' },
        { id: 'n-2', kind: 'text', value: 'x' },
        { id: 'w-3-0', kind: 'stack', settings: { align: 'start', gap: 8 }, children: [{ id: 'n-3', kind: 'button', value: 'x' }, { id: 'n-4', kind: 'button', value: 'x' }] },
      ],
    });
  });

  it('a lone element: gap 0, no justify for top, the column surface carried', () => {
    const node = columnStack({ id: 'col', profile: { ...column, justify: 'start' }, surface: { padding: '20px' }, mintId, elements: [placed(1, { kind: 'text', marginTop: 0, bottomMargin: 20 })] });
    expect(node).toEqual({ id: 'col', kind: 'stack', settings: { gap: 0, width: '1/2', surface: { padding: '20px' } }, children: [{ id: 'n-1', kind: 'text', value: 'x' }] });
  });

  it('a centred button gets its own centred run; buttons with different alignment do not share a run', () => {
    const node = columnStack({
      id: 'col', profile: { ...column, justify: 'start' }, surface: null, mintId,
      elements: [
        placed(1, { kind: 'button', marginTop: 0, align: 'center', chrome: {} as never, fullWidth: false, colours: null }),
        placed(2, { kind: 'button', marginTop: 30, align: 'right', chrome: {} as never, fullWidth: false, colours: null }),
      ],
    });
    expect(node.children).toEqual([
      { id: 'w-1-0', kind: 'stack', settings: { align: 'center', gap: 0 }, children: [{ id: 'n-1', kind: 'button', value: 'x' }] },
      { id: 'w-2-0', kind: 'stack', settings: { align: 'end', gap: 0 }, children: [{ id: 'n-2', kind: 'button', value: 'x' }] },
    ]);
  });

  it('an element far off the common gap gets a rhythm wrapper with the exact offset, negative allowed', () => {
    const node = columnStack({
      id: 'col', profile: { ...column, justify: 'start' }, surface: null, mintId,
      elements: [
        placed(1, { kind: 'headline', level: 2, fontSize: 32, marginTop: 0, bottomMargin: 20 }),
        placed(2, { kind: 'text', marginTop: 30, bottomMargin: 20 }),
        placed(3, { kind: 'text', marginTop: 30, bottomMargin: 20 }),
        placed(4, { kind: 'text', marginTop: 55, bottomMargin: 20 }),
        placed(5, { kind: 'text', marginTop: 0, bottomMargin: 20 }),
      ],
    });
    // gaps 0, 30, 30, 55, 20; common 30 snaps to 32
    expect(node.settings).toEqual({ gap: 8, width: '1/2' });
    expect(node.children?.[3]).toEqual({ id: 'w-4-0', kind: 'stack', settings: { gap: 0, surface: { margin: '23px 0 0' } }, children: [{ id: 'n-4', kind: 'text', value: 'x' }] });
    expect(node.children?.[4]).toEqual({ id: 'w-5-0', kind: 'stack', settings: { gap: 0, surface: { margin: '-12px 0 0' } }, children: [{ id: 'n-5', kind: 'text', value: 'x' }] });
    expect(node.children?.[1]).toEqual({ id: 'n-2', kind: 'text', value: 'x' });
  });

  it('a first element with its own margin-top is offset by the whole margin', () => {
    const node = columnStack({ id: 'col', profile: { ...column, justify: 'start' }, surface: null, mintId, elements: [placed(1, { kind: 'text', marginTop: 30, bottomMargin: 20 }), placed(2, { kind: 'text', marginTop: 30, bottomMargin: 20 })] });
    expect(node.children?.[0]).toEqual({ id: 'w-1-0', kind: 'stack', settings: { gap: 0, surface: { margin: '30px 0 0' } }, children: [{ id: 'n-1', kind: 'text', value: 'x' }] });
  });

  it('a button run that also needs an offset carries the margin on the run wrapper', () => {
    const node = columnStack({
      id: 'col', profile: { ...column, justify: 'start' }, surface: null, mintId,
      elements: [
        placed(1, { kind: 'text', marginTop: 0, bottomMargin: 20 }),
        placed(2, { kind: 'text', marginTop: 30, bottomMargin: 20 }),
        placed(3, { kind: 'button', marginTop: 60, chrome: {} as never, fullWidth: false, colours: null }),
      ],
    });
    // gaps 0, 30, 60; common 30 -> 32; button delta 28
    expect(node.children?.[2]).toEqual({ id: 'w-3-0', kind: 'stack', settings: { align: 'start', gap: 0, surface: { margin: '28px 0 0' } }, children: [{ id: 'n-3', kind: 'button', value: 'x' }] });
  });
});
