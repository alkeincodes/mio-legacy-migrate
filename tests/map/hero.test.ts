import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { LegacySection } from '../../src/extract/queries.js';
import { mapElement } from '../../src/map/elements.js';
import { nodeId } from '../../src/map/nodeId.js';
import type { PlanWarning } from '../../src/map/plan.js';
import { hubStyleProfile } from '../../src/map/profile/hub.js';
import { mapSection, type MapContext } from '../../src/map/sections.js';

interface Fixture { section: LegacySection; children: LegacySection[]; grandchildren: LegacySection[] }
const fixture = JSON.parse(readFileSync(new URL('../fixtures/sections/hero-row.json', import.meta.url), 'utf8')) as Fixture;

const HUB = 38827;
const PAGE = 280338;
const EXTRA = 1000;

const hubProfile = hubStyleProfile({
  colors: { primary: '#F7F2E8', secondary: '#333333' },
  appearance: {
    buttons: { dropShadow: { show: true, size: 'large' }, cornerRadius: { show: true, topLeft: '0', topRight: '0', bottomLeft: '0', bottomRight: '0' } },
    thumbnails: { cornerRadius: { show: true, topLeft: '30', topRight: '30', bottomLeft: '30', bottomRight: '30' } },
  },
});

function ctx(warnings: PlanWarning[]): MapContext {
  const all = [...fixture.children, ...fixture.grandchildren];
  const base = {
    legacyHubId: HUB, legacyPageId: PAGE, pageSlug: 'home-page',
    warn: (w: PlanWarning) => warnings.push(w),
    pageSlugById: (id: number) => (id === 284460 ? 'discussions' : id === 284461 ? '5d-challenge' : null),
    mediaIdForSection: () => null,
    assetForUrl: (url: string) => (url === 'https://cdn.example.com/wordmark.png' ? { legacyMediaId: 4213361, variant: 'thumbnail' } : null),
    themeColours: { primary: '#F7F2E8', secondary: '#333333' },
    hubProfile,
    dominantButtonBackground: '#5770D1',
  };
  return {
    ...base,
    childrenOf: (id) => all.filter((s) => s.parent_id === id).sort((a, b) => a.position - b.position),
    mapElement: (section, ordinal, extra) => mapElement(section, ordinal, { ...base, columnContentWidth: extra?.columnContentWidth ?? null }),
  };
}

describe('the ManTalks home hero', () => {
  const warnings: PlanWarning[] = [];
  const node = mapSection(fixture.section, 1, ctx(warnings));
  const row = node.children?.[0];
  const [left, right] = row?.children ?? [];

  it('is a row container with exact 150px padding, light ink and the background image', () => {
    expect(node).toMatchObject({
      id: nodeId(HUB, PAGE, 3398809, 1), kind: 'container', template: 'row',
      settings: { maxWidth: 'content', padding: 0, surface: { padding: '150px 0', ink: 'light', background: { type: 'image', url: 'https://cdn.example.com/hero-bg.png', blur: false, scrim: false }, visibility: { desktop: true, mobile: false } } },
    });
    expect(row?.settings).toEqual({ gap: 5, mobileGap: 6, align: 'stretch', wrap: true, responsive: true });
  });

  it('left column: the wordmark, centred, capped at 352, transparent, its own square radius', () => {
    expect(left?.settings).toEqual({ gap: 0, width: '1/2' });
    expect(left?.children).toEqual([
      { id: nodeId(HUB, PAGE, 3516756, 0), kind: 'image', value: 'ledger://asset/4213361/thumbnail', settings: { alt: 'Wordmark', aspectRatio: 'auto', objectFit: 'contain', alignX: 'center', maxWidth: 352, radius: 'control', backdrop: false } },
    ]);
  });

  it('right column: vertically centred, 20px rhythm, left-aligned copy, buttons in a start run 32px apart', () => {
    expect(right?.settings).toEqual({ gap: 5, width: '1/2', justify: 'center' });
    expect(right?.children).toEqual([
      { id: nodeId(HUB, PAGE, 3398812, 0), kind: 'headline', value: 'Welcome, member', settings: { level: 2, weight: 700, align: 'left' } },
      { id: nodeId(HUB, PAGE, 3398813, 1), kind: 'text', value: 'A short welcome paragraph.', settings: { align: 'left', marginBottom: 0 } },
      {
        id: nodeId(HUB, PAGE, 3424620, EXTRA), kind: 'stack', settings: { align: 'start', gap: 8 },
        children: [
          { id: nodeId(HUB, PAGE, 3424620, 2), kind: 'button', value: 'Join The Conversation', settings: { action: { type: 'page', value: '/discussions' }, variant: 'primary', size: 'lg', newTab: false, iconRight: 'chat' } },
          { id: nodeId(HUB, PAGE, 4048781, 3), kind: 'button', value: '5-Day Challenge', settings: { action: { type: 'page', value: '/5d-challenge' }, variant: 'primary', size: 'lg', newTab: false, iconRight: 'activity' } },
        ],
      },
    ]);
  });

  it('reports exactly the values V3 cannot draw', () => {
    const fidelity = warnings.filter((w) => w.type === 'fidelity').map((w) => [w.property, w.legacy, w.v3]);
    expect(fidelity).toEqual([
      ['section.ink', '#F7F2E8', 'light'],
      ['image.maxWidth', '250px', '352px'],
      ['image.radius', '0px', 'control (12px)'],
      ['button.chrome', '0px radius, 13px 30px, shadow large, weight 700', 'size lg: 14.4px radius, 14px x 46px, no shadow, weight 400'],
      ['button.chrome', '0px radius, 13px 30px, shadow large, weight 700', 'size lg: 14.4px radius, 14px x 46px, no shadow, weight 400'],
    ]);
    expect(warnings.filter((w) => w.type !== 'fidelity').map((w) => w.reason)).toEqual([]);
  });
});
