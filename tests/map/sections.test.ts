import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SECTION_TABLE, lookupMapping } from '../../src/map/sectionTable.js';
import { assetRef, mapSection, playlistRef, type MapContext } from '../../src/map/sections.js';
import { nodeId } from '../../src/map/nodeId.js';
import type { LegacySection } from '../../src/extract/queries.js';
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

  it('maps a column block to a stack carrying the legacy width', () => {
    const fixture = loadFixture('row');
    const node = mapSection(fixture.section, 0, contextFor(fixture, []));
    const column = node.children?.[0];
    expect(column?.kind).toBe('stack');
    expect(column?.template).toBeUndefined();
    expect(column?.settings?.['width']).toBe('1/2');
    expect(column?.id).toBe(nodeId(7, 100, 11101, 0));
  });

  it('maps a grid-playlist block to a repeated content-card bound to the playlist', () => {
    const fixture = loadFixture('grid-playlist');
    const node = mapSection(fixture.section, 1, contextFor(fixture, []));
    expect(node.template).toBe('grid');
    const card = node.children?.[0];
    expect(card?.kind).toBe('content-card');
    expect(card?.dataSource).toEqual({ type: 'playlist', id: playlistRef(42) });
    expect(card?.repeat).toEqual({ over: 'dataSource' });
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
    expect(node.settings?.['surface']).toMatchObject({ visibility: { hidden: true } });
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
    expect((node.settings?.['surface'] as Record<string, unknown>)['background']).toEqual({ type: 'image', url: 'https://cdn.example.com/bg.png', blur: false });
  });
});

describe('page and url cards with real legacy shapes', () => {
  it('resolves a page card by the row model_id and takes its label from settings.link.label', () => {
    const fixture = loadFixture('grid-page');
    const card = { ...fixture.children[0]!, model_type: 'App\\Page', model_id: 284465, settings: JSON.stringify({ link: { label: 'Start' } }) };
    const node = mapSection(fixture.section, 0, { ...contextFor({ ...fixture, children: [card] }, []), pageSlugById: (id) => (id === 284465 ? 'start-here' : null) });
    const button = node.children?.[0]?.children?.[0];
    expect(button?.value).toBe('Start');
    expect(button?.settings?.['action']).toEqual({ type: 'page', value: '/start-here' });
  });

  it('reads a url card link out of its TipTap document', () => {
    const fixture = loadFixture('grid-url');
    const doc = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'https://x.example.com/a' }] }] });
    const card = { ...fixture.children[0]!, settings: JSON.stringify({ link: { url: doc, label: 'Go', newTab: true } }) };
    const button = mapSection(fixture.section, 0, contextFor({ ...fixture, children: [card] }, [])).children?.[0]?.children?.[0];
    expect(button?.settings?.['action']).toEqual({ type: 'url', value: 'https://x.example.com/a' });
    expect(button?.settings?.['newTab']).toBe(true);
  });
});
