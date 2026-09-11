import { describe, expect, it } from 'vitest';
import { mapNavigation, menuItemHref } from '../../src/map/navigation.js';
import type { Bundle } from '../../src/extract/bundle.js';
import type { LegacyMenuItem } from '../../src/extract/queries.js';

function item(overrides: Partial<LegacyMenuItem> = {}): LegacyMenuItem {
  return {
    id: 1, hub_id: 7, menu: 'header', title: 'About', hidden: 0, type: 'page',
    model_type: 'App\\Page', model_id: 100, settings: null, position: 0,
    segment_id: null,
    ...overrides,
  };
}

function bundle(menuItems: LegacyMenuItem[]): Bundle {
  return { menuItems } as unknown as Bundle;
}

const slugs = new Map([[100, 'about']]);

describe('mapNavigation', () => {
  it('splits items into the header and footer buckets', () => {
    const { navigation } = mapNavigation(
      bundle([item(), item({ id: 2, menu: 'footer', title: 'Terms' })]),
      slugs,
    );
    expect(navigation.header).toHaveLength(1);
    expect(navigation.footer).toHaveLength(1);
  });

  it('leaves the mobile bucket empty, because legacy has no source for it', () => {
    expect(mapNavigation(bundle([item()]), slugs).navigation.mobile).toEqual([]);
  });

  it('orders each bucket by the legacy position column', () => {
    const { navigation } = mapNavigation(
      bundle([item({ id: 1, title: 'B', position: 1 }), item({ id: 2, title: 'A', position: 0 })]),
      slugs,
    );
    expect(navigation.header.map((i) => i.label)).toEqual(['A', 'B']);
  });

  it('emits a page item as a slug reference, not a legacy id', () => {
    expect(mapNavigation(bundle([item()]), slugs).navigation.header[0]).toEqual({
      type: 'page', label: 'About', pageSlugRef: 'about', position: 0,
    });
  });

  it('emits a url item with its href', () => {
    const menuItem = item({ type: 'custom', model_type: null, model_id: null, title: 'Blog', settings: JSON.stringify({ link: { url: 'https://blog.example.com' } }) });
    expect(mapNavigation(bundle([menuItem]), slugs).navigation.header[0]).toEqual({
      type: 'url', label: 'Blog', href: 'https://blog.example.com', position: 0,
    });
  });

  it('skips a hidden menu item', () => {
    expect(mapNavigation(bundle([item({ hidden: 1 })]), slugs).navigation.header).toEqual([]);
  });

  it('warns rather than emitting a dangling item when the page is not in the plan', () => {
    const { navigation, warnings } = mapNavigation(bundle([item({ model_id: 999 })]), slugs);
    expect(navigation.header).toEqual([]);
    expect(warnings[0]?.type).toBe('approximated');
    expect(warnings[0]?.reason).toContain('999');
  });

  it('truncates a label over the 120 character V3 limit instead of letting the write 422', () => {
    const long = 'x'.repeat(200);
    const { navigation, warnings } = mapNavigation(bundle([item({ title: long })]), slugs);
    expect(navigation.header[0]?.label).toHaveLength(120);
    expect(warnings.some((w) => w.reason.includes('truncated'))).toBe(true);
  });
});

describe('menuItemHref', () => {
  it('reads a plain settings.url', () => {
    expect(menuItemHref({ url: 'https://blog.example.com ' })).toBe('https://blog.example.com');
  });

  it('reads the text of a TipTap document stored in settings.url, which is how the legacy editor saves it', () => {
    const doc = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'mailto:info@example.com' }] }] });
    expect(menuItemHref({ url: doc })).toBe('mailto:info@example.com');
  });

  it('still honours the older settings.link.url shape', () => {
    expect(menuItemHref({ link: { url: '/courses' } })).toBe('/courses');
  });
});

describe('the legacy discussions page in the menu', () => {
  it('becomes a typed discussions item, which V3 routes to its own community page', () => {
    const { navigation } = mapNavigation(bundle([item({ title: 'COMMUNITY', model_id: 100 })]), slugs, new Map([[100, 'discussions']]));
    expect(navigation.header[0]).toEqual({ type: 'discussions', label: 'COMMUNITY', position: 0 });
  });
});
