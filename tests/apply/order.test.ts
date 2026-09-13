import { describe, expect, it } from 'vitest';
import { APPLY_ORDER, resolveRefs, shouldPublish } from '../../src/apply/order.js';
import type { PlanPage } from '../../src/map/plan.js';
import type { CatalogNode } from '../../src/map/catalog.js';

describe('APPLY_ORDER', () => {
  it('puts segments and access rules before anything that attaches to them', () => {
    expect(APPLY_ORDER.indexOf('tags')).toBeLessThan(APPLY_ORDER.indexOf('segments'));
    expect(APPLY_ORDER.indexOf('segments')).toBeLessThan(APPLY_ORDER.indexOf('assets'));
    expect(APPLY_ORDER.indexOf('accessRules')).toBeLessThan(APPLY_ORDER.indexOf('playlists'));
    expect(APPLY_ORDER.indexOf('removals')).toBeGreaterThan(APPLY_ORDER.indexOf('pageTrees'));
    expect(APPLY_ORDER.indexOf('removals')).toBeLessThan(APPLY_ORDER.indexOf('navigation'));
    expect(APPLY_ORDER.indexOf('accessRules')).toBeLessThan(APPLY_ORDER.indexOf('pageTrees'));
  });

  it('creates every page as a draft before writing any tree, so mutual links need no ordering', () => {
    expect(APPLY_ORDER.indexOf('pageDrafts')).toBeLessThan(APPLY_ORDER.indexOf('pageTrees'));
  });

  it('puts achievements last, because they reference pages and playlists', () => {
    expect(APPLY_ORDER[APPLY_ORDER.length - 1]).toBe('achievements');
  });

  it('puts the hub first', () => {
    expect(APPLY_ORDER[0]).toBe('hub');
  });

  it('writes navigation after the pages it points at', () => {
    expect(APPLY_ORDER.indexOf('navigation')).toBeGreaterThan(APPLY_ORDER.indexOf('pageDrafts'));
  });
});

function page(overrides: Partial<PlanPage> = {}): PlanPage {
  return {
    legacyPageId: 100, slug: 'about', title: 'About', pageType: 'generic',
    privacy: 'members', isHomepage: false,
    tree: { id: 'root', kind: 'stack', children: [] },
    restrictedSectionNodeIds: [],
    ...overrides,
  };
}

describe('shouldPublish', () => {
  it('publishes a page with no restricted sections', () => {
    expect(shouldPublish(page(), new Set())).toBe(true);
  });

  it('publishes a page whose every restricted section has a mapped rule', () => {
    expect(shouldPublish(page({ restrictedSectionNodeIds: ['n1'] }), new Set(['n1']))).toBe(true);
  });

  it('refuses to publish a page with a restricted section and no mapped rule', () => {
    expect(shouldPublish(page({ restrictedSectionNodeIds: ['n1'] }), new Set())).toBe(false);
  });

  it('refuses when only some restricted sections have rules', () => {
    expect(shouldPublish(page({ restrictedSectionNodeIds: ['n1', 'n2'] }), new Set(['n1']))).toBe(false);
  });
});

describe('resolveRefs', () => {
  const tree: CatalogNode = {
    id: 'root', kind: 'stack',
    children: [
      { id: 'a', kind: 'image', value: 'ledger://asset/91234/original', settings: { alt: 'x' } },
      { id: 'b', kind: 'video', value: 'ledger://asset/91235/original', settings: { embed_type: 'native' } },
      { id: 'c', kind: 'content-card', dataSource: { type: 'playlist', id: 'ledger://playlist/42' }, children: [] },
    ],
  };

  it('rewrites a resolvable asset reference to its URL', () => {
    const out = resolveRefs(tree, {
      asset: () => ({ url: 'https://cdn.member.dev/team/media/m/original' }),
      playlist: () => 'pl_1',
    });
    expect(out.children?.[0]?.value).toBe('https://cdn.member.dev/team/media/m/original');
  });

  it('rewrites a playlist dataSource to the V3 playlist id', () => {
    const out = resolveRefs(tree, { asset: () => ({ url: 'u' }), playlist: () => 'pl_1' });
    expect(out.children?.[2]?.dataSource).toEqual({ type: 'playlist', id: 'pl_1' });
  });

  it('empties the value of a node whose asset is still pending, rather than leaving the placeholder', () => {
    const out = resolveRefs(tree, { asset: () => ({ pending: true }), playlist: () => 'pl_1' });
    expect(out.children?.[1]?.value).toBe('');
  });

  it('leaves nodes with no references untouched', () => {
    const plain: CatalogNode = { id: 'root', kind: 'stack', children: [{ id: 'h', kind: 'headline', value: 'Hi' }] };
    expect(resolveRefs(plain, { asset: () => ({ url: 'u' }), playlist: () => null })).toEqual(plain);
  });

  it('does not mutate the input tree', () => {
    const before = JSON.stringify(tree);
    resolveRefs(tree, { asset: () => ({ url: 'u' }), playlist: () => 'pl_1' });
    expect(JSON.stringify(tree)).toBe(before);
  });
});

describe('resolveRefs on button actions', () => {
  it('rewrites a playlist reference in a button action to the content page with the V3 id', () => {
    const tree: CatalogNode = { id: 'r', kind: 'stack', children: [{ id: 'b', kind: 'button', value: 'Watch', settings: { action: { type: 'page', value: 'ledger://playlist/42' } } }] };
    const out = resolveRefs(tree, { asset: () => ({ pending: true }), playlist: () => 'pl_1' });
    expect(out.children?.[0]?.settings?.['action']).toEqual({ type: 'playlist', value: 'pl_1' });
  });
});

describe('resolveRefs on file cards', () => {
  const tree: CatalogNode = { id: 'r', kind: 'stack', children: [{ id: 'c', kind: 'content-card', dataSource: { type: 'file', id: 'ledger://asset/91234/original' }, children: [] }] };
  it('swaps in the V3 file id once the asset is verified', () => {
    const out = resolveRefs(tree, { asset: () => ({ pending: true }), playlist: () => null, file: () => 'file_9' });
    expect(out.children?.[0]?.dataSource).toEqual({ type: 'file', id: 'file_9' });
  });
  it('drops the data source while the asset is pending, so V3 is not asked for a legacy id', () => {
    const out = resolveRefs(tree, { asset: () => ({ pending: true }), playlist: () => null, file: () => null });
    expect(out.children?.[0]?.dataSource).toBeUndefined();
  });
});
