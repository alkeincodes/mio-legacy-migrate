import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mapElement, type ElementContext } from '../../src/map/elements.js';
import { assetRef } from '../../src/map/sections.js';
import { nodeId } from '../../src/map/nodeId.js';
import type { LegacySection } from '../../src/extract/queries.js';
import type { PlanWarning } from '../../src/map/plan.js';

function fixture(name: string): LegacySection {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/elements/${name}.json`, import.meta.url), 'utf8'),
  ) as LegacySection;
}

function ctx(warnings: PlanWarning[] = []): ElementContext {
  return {
    legacyHubId: 7,
    legacyPageId: 100,
    pageSlug: 'home',
    warn: (w) => warnings.push(w),
    mediaIdForSection: (section) => (section.model_id === 5 ? 91234 : section.model_id === 6 ? 91235 : null),
  };
}

/** A legacy button maps to a chrome shell stack around the V3 button; tests read the button through it. */
function mapButton(section: LegacySection, ordinal: number, context: ElementContext): ReturnType<typeof mapElement> {
  const shell = mapElement(section, ordinal, context);
  expect(shell?.kind).toBe('stack');
  expect(shell?.settings?.['width']).toBe('fit');
  return shell?.children?.[0] ?? null;
}

describe('mapElement', () => {
  it('headline: emits a headline with the content in the top-level value', () => {
    const node = mapElement(fixture('headline'), 0, ctx());
    expect(node).toEqual({
      id: nodeId(7, 100, 21000, 0),
      kind: 'headline',
      value: 'Build better men',
      settings: { level: 2, weight: 700, align: 'center' },
    });
  });

  it('subheadline: a medium headline becomes level 3, because legacy collapses subHeadline into headline', () => {
    expect(mapElement(fixture('subheadline'), 1, ctx())?.settings?.['level']).toBe(3);
  });

  it('text: keeps the legacy HTML in the top-level value', () => {
    const node = mapElement(fixture('text'), 2, ctx());
    expect(node?.kind).toBe('text');
    expect(node?.value).toBe('<p>Weekly calls, a private forum and a library of talks.</p>');
    expect(node?.settings?.['align']).toBe('left');
  });

  it('image: puts a resolvable asset reference in the top-level value, not in settings', () => {
    const node = mapElement(fixture('image'), 3, ctx());
    expect(node?.kind).toBe('image');
    expect(node?.value).toBe(assetRef(91234, 'original'));
    expect(node?.settings?.['alt']).toBe('Group photo');
    expect(node?.settings).not.toHaveProperty('value');
  });

  it('video: emits a native video node whose value is the playback asset reference', () => {
    const node = mapElement(fixture('video'), 4, ctx());
    expect(node?.kind).toBe('video');
    expect(node?.value).toBe(assetRef(91235, 'original'));
    expect(node?.settings?.['embed_type']).toBe('native');
  });

  it('icon: puts the glyph name in the value, because icon reads value not settings.name', () => {
    const node = mapElement(fixture('icon'), 5, ctx());
    expect(node?.kind).toBe('icon');
    expect(node?.value).toBe('shield');
    expect(node?.settings?.['size']).toBe(24);
  });

  it('button: builds a url action object, not the deprecated href string', () => {
    const node = mapButton(fixture('button'), 6, ctx());
    expect(node?.kind).toBe('button');
    expect(node?.value).toBe('Join now');
    expect(node?.settings?.['action']).toEqual({
      type: 'url',
      value: 'https://mantalks.com/join',
    });
    expect(node?.settings).not.toHaveProperty('href');
  });

  it('button: rewrites a link to another page on this hub as a page action', () => {
    const section = fixture('button');
    section.settings = JSON.stringify({ link: { url: 'https://alliance.mantalks.com/courses' } });
    const node = mapButton(section, 6, { ...ctx(), pageSlug: 'home' });
    expect(node?.settings?.['action']).toEqual({ type: 'page', value: '/courses' });
  });

  it('line-break: emits a divider', () => {
    expect(mapElement(fixture('line-break'), 7, ctx())?.kind).toBe('divider');
  });

  it('input: has no catalog equivalent, so it becomes labelled text with an approximated warning', () => {
    const warnings: PlanWarning[] = [];
    const node = mapElement(fixture('input'), 8, ctx(warnings));
    expect(node?.kind).toBe('text');
    expect(node?.value).toBe('Email address');
    expect(warnings[0]).toMatchObject({ type: 'approximated', legacySectionId: 21008 });
    expect(warnings[0]?.reason).toContain('input');
  });

  it('embed-code: an embeddable URL becomes an iframe video node', () => {
    const warnings: PlanWarning[] = [];
    const node = mapElement(fixture('embed-code'), 9, ctx(warnings));
    expect(node?.kind).toBe('video');
    expect(node?.value).toBe('https://player.vimeo.com/video/12345');
    expect(node?.settings?.['embed_type']).toBe('iframe');
    expect(warnings[0]?.type).toBe('approximated');
  });

  it('embed-code: raw markup with no URL becomes text rather than being dropped', () => {
    const section = fixture('embed-code');
    section.settings = JSON.stringify({ embed: { src: '<script>alert(1)</script>' } });
    const warnings: PlanWarning[] = [];
    const node = mapElement(section, 9, ctx(warnings));
    expect(node?.kind).toBe('text');
    expect(warnings[0]?.type).toBe('approximated');
  });

  it('returns null for a hidden element so it does not reach the tree', () => {
    const section = fixture('text');
    section.hidden = 1;
    expect(mapElement(section, 2, ctx())).toBeNull();
  });

  it('never emits a node kind outside the catalog vocabulary', () => {
    const allowed = new Set(['headline', 'text', 'image', 'video', 'icon', 'button', 'divider', 'stack']);
    for (const name of ['headline', 'subheadline', 'text', 'image', 'video', 'icon', 'button', 'line-break', 'input', 'embed-code']) {
      const node = mapElement(fixture(name), 0, ctx());
      if (node) expect(allowed.has(node.kind)).toBe(true);
    }
  });
});

describe('image stored as settings.thumbnail.url', () => {
  it('resolves the legacy CDN URL to its manifest asset reference', () => {
    const section = fixture('image');
    section.model_type = null; section.model_id = null;
    section.settings = JSON.stringify({ thumbnail: { url: 'https://cdn.legacy.example.com/4189044/conversions/x-optimized_thumbnail.png' } });
    const node = mapElement(section, 3, { ...ctx(), assetForUrl: (url) => url.includes('4189044') ? { legacyMediaId: 4189044, variant: 'optimized_thumbnail' } : null });
    expect(node?.value).toBe(assetRef(4189044, 'optimized_thumbnail'));
  });

  it('falls back to the raw URL with a warning when the manifest does not know it', () => {
    const section = fixture('image');
    section.model_type = null; section.model_id = null;
    section.settings = JSON.stringify({ thumbnail: { url: 'https://elsewhere.example.com/pic.png' } });
    const warnings: PlanWarning[] = [];
    const node = mapElement(section, 3, { ...ctx(warnings), assetForUrl: () => null });
    expect(node?.value).toBe('https://elsewhere.example.com/pic.png');
    expect(warnings.find((w) => w.type === 'approximated')?.reason).toContain('not in the asset manifest');
  });
});

describe('links to renamed pages', () => {
  it('rewrites a same-origin link to a reserved slug onto the renamed slug', () => {
    const section = fixture('button');
    section.settings = JSON.stringify({ link: { url: 'https://alliance.mantalks.com/onboarding' } });
    const node = mapButton(section, 6, { ...ctx(), resolvePageSlug: (s) => (s === 'onboarding' ? 'onboarding-page' : s) });
    expect(node?.settings?.['action']).toEqual({ type: 'page', value: '/onboarding-page' });
  });
});

describe('real legacy content shapes', () => {
  const doc = (text: string) => JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

  it('headline: reads the TipTap document in title; settings.size decides the level, the label only when size is missing', () => {
    // Headline.vue:20-32 reads settings.size alone; the editor derives the label from it.
    const section = { ...fixture('headline'), label: 'Subheadline', title: doc('Build better men') };
    const node = mapElement(section, 0, ctx());
    expect(node?.value).toBe('Build better men');
    expect(node?.settings?.['level']).toBe(2);
    const unsized = { ...section, settings: JSON.stringify({ align: 'center' }) };
    expect(mapElement(unsized, 0, ctx())?.settings?.['level']).toBe(3);
  });

  it('text: reads the TipTap document in settings.value as plain text, because the V3 text node shows tags literally', () => {
    const section = { ...fixture('text'), label: 'Paragraph', settings: JSON.stringify({ value: doc('Weekly calls.') }) };
    expect(mapElement(section, 2, ctx())?.value).toBe('Weekly calls.');
  });

  it('button: label from settings.link.label and a page target from the row model_id', () => {
    const section = { ...fixture('button'), label: 'Button', model_type: 'App\\Page', model_id: 284465, settings: JSON.stringify({ type: 'page', link: { label: 'View Here' } }) };
    const node = mapButton(section, 6, { ...ctx(), pageSlugById: (id) => (id === 284465 ? 'training' : null) });
    expect(node?.value).toBe('View Here');
    expect(node?.settings?.['action']).toEqual({ type: 'page', value: '/training' });
  });

  it('button: a playlist target becomes a resolvable playlist reference', () => {
    const section = { ...fixture('button'), model_type: 'App\\Playlist', model_id: 42, settings: JSON.stringify({ type: 'playlist', link: { label: 'Watch' } }) };
    expect(mapButton(section, 6, ctx())?.settings?.['action']).toEqual({ type: 'page', value: 'ledger://playlist/42' });
  });

  it('button: a custom link keeps the URL out of the TipTap document', () => {
    const section = { ...fixture('button'), model_type: null, model_id: null, settings: JSON.stringify({ type: 'custom', link: { label: 'Download', url: doc('https://cdn.example.com/w.pdf'), newTab: true } }) };
    const node = mapButton(section, 6, ctx());
    expect(node?.settings?.['action']).toEqual({ type: 'url', value: 'https://cdn.example.com/w.pdf' });
    expect(node?.settings?.['newTab']).toBe(true);
  });
});

describe('image element that links a video file', () => {
  it('shows the thumbnail conversion the legacy element displays, not the video original', () => {
    const section = { ...fixture('image'), model_type: 'App\\File', model_id: 6, settings: JSON.stringify({ thumbnail: { url: 'https://cdn.legacy.example.com/4192507/conversions/x-optimized_thumbnail.png' } }) };
    const node = mapElement(section, 3, { ...ctx(), assetForUrl: () => ({ legacyMediaId: 4192507, variant: 'optimized_thumbnail' }) });
    expect(node?.value).toBe(assetRef(4192507, 'optimized_thumbnail'));
  });
});

describe('empty elements', () => {
  it('drops a paragraph whose document is empty rather than showing the editor label', () => {
    const section = { ...fixture('text'), label: 'Paragraph', settings: JSON.stringify({ value: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }) }) };
    expect(mapElement(section, 2, ctx())).toBeNull();
    expect(mapElement({ ...fixture('text'), label: 'Paragraph - Copy', settings: '{}' }, 2, ctx())).toBeNull();
  });
});
