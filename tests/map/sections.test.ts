import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SECTION_TABLE, lookupMapping } from '../../src/map/sectionTable.js';
import { assetRef, mapSection, playlistRef, type MapContext } from '../../src/map/sections.js';
import { nodeId } from '../../src/map/nodeId.js';
import type { LegacySection } from '../../src/extract/queries.js';
import type { CatalogNode } from '../../src/map/catalog.js';
import type { PlanWarning } from '../../src/map/plan.js';

interface Fixture {
  section: LegacySection;
  children: LegacySection[];
  grandchildren: LegacySection[];
}

function loadFixture(name: string): Fixture {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/sections/${name}.json`, import.meta.url), 'utf8'),
  ) as Fixture;
}

/** The cards of a tile section: container -> stack(title, strip|grid) -> cards. */
function cardsOf(node: CatalogNode): CatalogNode[] | undefined {
  return node.children?.[0]?.children?.find((c) => c.kind === 'grid' || c.kind === 'horizontal-scroll')?.children;
}

function contextFor(fixture: Fixture, warnings: PlanWarning[]): MapContext {
  const all = [...fixture.children, ...fixture.grandchildren];
  return {
    legacyHubId: 7,
    legacyPageId: 100,
    pageSlug: 'home',
    childrenOf: (id) => all.filter((s) => s.parent_id === id).sort((a, b) => a.position - b.position),
    warn: (w) => warnings.push(w),
    mapElement: () => null,
  };
}

describe('SECTION_TABLE', () => {
  it('has no duplicate (legacyType, level) pairs', () => {
    const keys = SECTION_TABLE.map((m) => `${m.level}:${m.legacyType}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('carries a review column on every row', () => {
    for (const mapping of SECTION_TABLE) {
      expect(['yes', 'no']).toContain(mapping.reviewed);
    }
  });

  it('gives every level-1 mapping a template and every block mapping none', () => {
    for (const mapping of SECTION_TABLE) {
      if (mapping.level === 'section') expect(mapping.template).not.toBeNull();
      else expect(mapping.template).toBeNull();
    }
  });
});

describe('mapSection, container level', () => {
  it('maps a row to a container carrying the row template with deterministic ids', () => {
    const fixture = loadFixture('row');
    const warnings: PlanWarning[] = [];
    const node = mapSection(fixture.section, 0, contextFor(fixture, warnings));
    expect(node.kind).toBe('container');
    expect(node.template).toBe('row');
    expect(node.id).toBe(nodeId(7, 100, 11100, 0));
    expect(warnings).toEqual([]);
  });

  it('carries the legacy background colour onto surface.background as a 6-digit hex', () => {
    const fixture = loadFixture('row');
    const node = mapSection(fixture.section, 0, contextFor(fixture, []));
    const surface = node.settings?.['surface'] as Record<string, unknown>;
    expect(surface['background']).toEqual({ type: 'custom-color', value: '#101820' });
  });

  it('lays columns out in the catalog row recipe: a layout row of stacks carrying the legacy width', () => {
    const fixture = loadFixture('row');
    const node = mapSection(fixture.section, 0, contextFor(fixture, []));
    const layout = node.children?.[0];
    expect(layout?.kind).toBe('row');
    expect(layout?.settings).toMatchObject({ responsive: true, wrap: true });
    const column = layout?.children?.[0];
    expect(column?.kind).toBe('stack');
    expect(column?.template).toBeUndefined();
    expect(column?.settings?.['width']).toBe('1/2');
    expect(column?.id).toBe(nodeId(7, 100, 11101, 0));
  });

  it('turns a numeric legacy column size into the width enum', () => {
    const fixture = loadFixture('row');
    const column = { ...fixture.children[0]!, settings: JSON.stringify({ size: 33.333 }) };
    const node = mapSection(fixture.section, 0, contextFor({ ...fixture, children: [column] }, []));
    expect(node.children?.[0]?.children?.[0]?.settings?.['width']).toBe('1/3');
  });

  it('carries the section surface the recipe expects: padding, background, maxWidth', () => {
    const fixture = loadFixture('row');
    const node = mapSection(fixture.section, 0, contextFor(fixture, []));
    expect(node.settings).toMatchObject({ maxWidth: 'content', padding: 0, surface: { padding: '50px 0', background: { type: 'custom-color', value: '#101820' } } });
  });

  it('maps a grid of one playlist onto one tile bound to that playlist, not a listing of its files', () => {
    const fixture = loadFixture('grid-playlist');
    const node = mapSection(fixture.section, 1, contextFor(fixture, []));
    expect(node.template).toBe('grid');
    expect(node.dataSource).toBeUndefined();
    const walk = (n: CatalogNode): CatalogNode[] => [n, ...(n.children ?? []).flatMap(walk)];
    expect(walk(node).some((n) => n.repeat)).toBe(false);
    const tile = walk(node).find((n) => n.kind === 'content-card');
    expect(tile?.dataSource).toEqual({ type: 'playlist', id: playlistRef(42) });
    expect(tile?.settings).toEqual({ actionFromScope: 'action' });
    expect(walk(tile!).some((n) => n.kind === 'media-slot')).toBe(true);
    const ids = walk(node).map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a compact section keeps the catalog playlist recipe, because legacy Compact.vue lists one playlist\'s files', () => {
    const fixture = loadFixture('grid-playlist');
    const section = { ...fixture.section, type: 'compact' };
    const node = mapSection(section, 1, contextFor({ ...fixture, section }, []));
    expect(node.template).toBe('compact');
    expect(node.dataSource).toEqual({ type: 'playlist', id: playlistRef(42) });
    const walk = (n: CatalogNode): CatalogNode[] => [n, ...(n.children ?? []).flatMap(walk)];
    expect(walk(node).some((n) => n.repeat)).toBe(true);
  });

  it('never sets both value and children on a container', () => {
    const fixture = loadFixture('row');
    const node = mapSection(fixture.section, 0, contextFor(fixture, []));
    expect(node.value).toBeUndefined();
    expect(Array.isArray(node.children)).toBe(true);
  });

  it('raises an approximated warning for a mapping flagged as lossy', () => {
    const fixture = loadFixture('row');
    const cta: LegacySection = { ...fixture.section, id: 999, type: 'cta' };
    const warnings: PlanWarning[] = [];
    mapSection(cta, 0, contextFor({ ...fixture, section: cta }, warnings));
    expect(warnings).toEqual([
      { pageSlug: 'home', legacySectionId: 999, type: 'approximated', reason: expect.stringContaining('cta') },
    ]);
  });

  it('falls back to a row holding a text node for an unmapped legacy type', () => {
    const fixture = loadFixture('row');
    const unknown: LegacySection = { ...fixture.section, id: 555, type: 'wormhole', title: 'Mystery' };
    const warnings: PlanWarning[] = [];
    const node = mapSection(unknown, 3, contextFor({ ...fixture, section: unknown, children: [] }, warnings));
    expect(node.template).toBe('row');
    expect(node.children?.[0]).toMatchObject({ kind: 'text', value: 'Mystery' });
    expect(warnings[0]?.type).toBe('approximated');
    expect(warnings[0]?.reason).toContain('wormhole');
  });

  it('skips a hidden legacy section by returning an empty container with no children', () => {
    const fixture = loadFixture('row');
    const hidden: LegacySection = { ...fixture.section, hidden: 1 };
    const node = mapSection(hidden, 0, contextFor({ ...fixture, section: hidden }, []));
    expect(node.settings?.['surface']).toMatchObject({ visibility: { desktop: false, mobile: false } });
  });
});

describe('reference placeholders', () => {
  it('encodes an asset reference apply can resolve from the ledger', () => {
    expect(assetRef(91234, 'original')).toBe('ledger://asset/91234/original');
  });

  it('encodes a playlist reference apply can resolve from the ledger', () => {
    expect(playlistRef(42)).toBe('ledger://playlist/42');
  });
});

describe('lookupMapping', () => {
  it('distinguishes a section-level type from a block-level type of the same name', () => {
    expect(lookupMapping('grid', 'section')?.template).toBe('grid');
    expect(lookupMapping('grid', 'block')).toBeNull();
  });
});

describe('settings that arrive already parsed', () => {
  it('reads an object settings value the same as its JSON string, because mysql2 parses JSON columns', () => {
    const fixture = loadFixture('row');
    const asObject = { ...fixture.section, settings: JSON.parse(fixture.section.settings ?? '{}') as unknown as string };
    const node = mapSection(asObject, 0, contextFor({ ...fixture, section: asObject }, []));
    expect((node.settings?.['surface'] as Record<string, unknown>)['background']).toEqual({ type: 'custom-color', value: '#101820' });
  });

  it('carries a background image given as a plain URL string', () => {
    const fixture = loadFixture('row');
    const section = { ...fixture.section, settings: JSON.stringify({ background: { type: 'image', image: 'https://cdn.example.com/bg.png' } }) };
    const node = mapSection(section, 0, contextFor({ ...fixture, section }, []));
    expect((node.settings?.['surface'] as Record<string, unknown>)['background']).toEqual({ type: 'image', url: 'https://cdn.example.com/bg.png', blur: false, scrim: false });
  });
});

describe('page and url cards with real legacy shapes', () => {
  it('resolves a page card by the row model_id and takes its label from settings.link.label', () => {
    const fixture = loadFixture('grid-page');
    const card = { ...fixture.children[0]!, model_type: 'App\\Page', model_id: 284465, settings: JSON.stringify({ link: { label: 'Start' } }) };
    const warnings: PlanWarning[] = [];
    const node = mapSection(fixture.section, 0, { ...contextFor({ ...fixture, children: [card] }, warnings), pageSlugById: (id) => (id === 284465 ? 'start-here' : null) });
    // Legacy tiles have no button; the lost link is recorded with its target.
    expect(cardsOf(node)?.[0]?.children?.some((c) => c.kind === 'button')).toBe(false);
    const lost = warnings.find((w) => w.property === 'tile.link');
    expect(lost?.legacy).toBe('the image tile links to /start-here');
  });

  it('reads a url card link out of its TipTap document', () => {
    const fixture = loadFixture('grid-url');
    const doc = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'https://x.example.com/a' }] }] });
    const card = { ...fixture.children[0]!, settings: JSON.stringify({ link: { url: doc, label: 'Go', newTab: true } }) };
    const warnings: PlanWarning[] = [];
    const cards = cardsOf(mapSection(fixture.section, 0, contextFor({ ...fixture, children: [card] }, warnings)));
    expect(cards?.[0]?.children?.some((c) => c.kind === 'button')).toBe(false);
    expect(warnings.find((w) => w.property === 'tile.link')?.legacy).toBe('the image tile links to https://x.example.com/a');
  });
});

describe('file cards', () => {
  it('reference the asset rather than the legacy file id, which V3 would 404 on', () => {
    const fixture = loadFixture('grid-file');
    const node = mapSection(fixture.section, 0, { ...contextFor(fixture, []), mediaIdForSection: () => 91234 });
    expect(cardsOf(node)?.[0]?.dataSource).toEqual({ type: 'file', id: 'ledger://asset/91234/original' });
  });
});

describe('playlist section titles', () => {
  it('keeps the legacy section title as a headline above the playlist recipe', () => {
    const fixture = loadFixture('grid-playlist');
    const node = mapSection({ ...fixture.section, title: 'Begin Training' }, 1, contextFor(fixture, []));
    expect(node.children?.[0]?.children?.[0]).toMatchObject({ kind: 'headline', value: 'Begin Training' });
  });
});

describe('a legacy scroll of tiles (ManTalks Begin Training)', () => {
  it('is the catalog Scroll section: title and a horizontal strip of six cards in legacy order, playlists bound without repeat', () => {
    const fixture = loadFixture('scroll-tiles');
    const warnings: PlanWarning[] = [];
    const node = mapSection(fixture.section, 2, { ...contextFor(fixture, warnings), pageSlugById: (id) => (id === 418149 ? 'attachment' : null), pageTitleById: (id) => (id === 418149 ? 'Training: Attachment' : null) });
    expect(node.template).toBe('compact');
    const body = node.children?.[0];
    expect(body?.kind).toBe('stack');
    expect(body?.children?.[0]).toMatchObject({ kind: 'headline', value: 'Begin Training' });
    const strip = body?.children?.[1];
    expect(strip?.kind).toBe('horizontal-scroll');
    expect(strip?.settings).toEqual({ itemWidth: 'card' });
    const cards = strip?.children ?? [];
    expect(cards.map((c) => c.dataSource?.type ?? c.children?.map((k) => k.kind))).toEqual([
      'playlist', 'playlist', 'playlist',
      ['image'],
      ['image'],
      ['image'],
    ]);
    for (const card of cards.slice(0, 3)) {
      expect(card.repeat).toBeUndefined();
      expect(card.children?.map((k) => k.kind)).toEqual(['media-slot', 'stack']);
    }
    expect(cards[0]?.dataSource).toEqual({ type: 'playlist', id: playlistRef(323878) });
    // Legacy tiles are pictures that link; V3 has no clickable picture, so the
    // link is recorded as lost for the tiles that had one (`#` tiles had none).
    expect(warnings.filter((w) => w.type !== 'fidelity')).toEqual([]);
    expect(warnings.filter((w) => w.property === 'tile.link').map((w) => [w.legacySectionId, w.legacy])).toEqual([
      [4289652, 'the image tile links to /attachment'],
      [4289651, 'the image tile links to https://example.com/shop'],
    ]);
  });

  it('reads a TipTap tile title for the shown title', () => {
    const fixture = loadFixture('scroll-tiles');
    const doc = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Book a call' }] }] });
    const tile = { ...fixture.children[5]!, title: doc, settings: JSON.stringify({ link: { url: 'https://example.com/book' }, showTitle: true, background: { type: 'image', image: { url: 'https://cdn.example.com/x.png' } } }) };
    const node = mapSection(fixture.section, 2, contextFor({ ...fixture, children: [tile] }, []));
    const card = node.children?.[0]?.children?.[1]?.children?.[0];
    expect(card?.children?.map((k) => k.kind)).toEqual(['image', 'text']);
    expect(card?.children?.[1]).toMatchObject({ kind: 'text', value: 'Book a call' });
  });
});

