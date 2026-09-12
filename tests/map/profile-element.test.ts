import { describe, expect, it } from 'vitest';
import type { LegacySection } from '../../src/extract/queries.js';
import { elementProfile } from '../../src/map/profile/element.js';
import { DEFAULT_HUB_PROFILE, hubStyleProfile } from '../../src/map/profile/hub.js';
import { commonGap, visibleGaps } from '../../src/map/profile/rhythm.js';

function el(type: string, settings: Record<string, unknown>, label: string | null = null): LegacySection {
  return { id: 1, hub_id: 7, page_id: null, parent_id: 2, model_type: null, model_id: null, hidden: 0, type, title: null, label, settings: JSON.stringify(settings), permissions: null, meta: null, position: 0, segment_id: null };
}

describe('elementProfile', () => {
  it('headline: large is h2 at the heading size, medium h3 at 0.75, small h4 at 18', () => {
    expect(elementProfile(el('headline', { size: 'large' }), DEFAULT_HUB_PROFILE)).toEqual({ kind: 'headline', level: 2, fontSize: 32, align: 'left', marginTop: 30, bottomMargin: 20 });
    expect(elementProfile(el('headline', { size: 'medium' }), hubStyleProfile({ fonts: { headingFontSize: 40 } }))).toMatchObject({ level: 3, fontSize: 30 });
    expect(elementProfile(el('headline', { size: 'small' }), DEFAULT_HUB_PROFILE)).toMatchObject({ level: 4, fontSize: 18, bottomMargin: 10 });
    expect(elementProfile(el('headline', {}, 'Subheadline - Copy'), DEFAULT_HUB_PROFILE)).toMatchObject({ level: 3 });
  });

  it('reads align and margins.top, with left and 30 as the legacy defaults', () => {
    expect(elementProfile(el('text', { align: 'center', margins: { top: 0 } }), DEFAULT_HUB_PROFILE)).toEqual({ kind: 'text', align: 'center', marginTop: 0, bottomMargin: 20 });
    expect(elementProfile(el('text', {}), DEFAULT_HUB_PROFILE)).toMatchObject({ align: 'left', marginTop: 30 });
  });

  it('image: width types, transparent flag, chrome from the element when it overwrites, else the hub', () => {
    const hub = hubStyleProfile({ appearance: { thumbnails: { cornerRadius: { show: true, topLeft: 30, topRight: 30, bottomRight: 30, bottomLeft: 30 } } } });
    expect(elementProfile(el('image', { align: 'center', styles: { width: { type: 'custom', value: 250 } }, thumbnail: { is_thumbnail_transparent: true } }), hub))
      .toEqual({ kind: 'image', align: 'center', marginTop: 30, bottomMargin: 0, maxWidth: 250, fill: false, chrome: { radius: [30, 30, 30, 30], border: null, shadow: null }, transparent: true });
    expect(elementProfile(el('image', { styles: { width: { type: 'custom' } } }), hub)).toMatchObject({ maxWidth: 400 });
    expect(elementProfile(el('image', { styles: { width: { type: 'full' } } }), hub)).toMatchObject({ maxWidth: null, fill: true });
    expect(elementProfile(el('image', { appearance: { overwrite: true }, styles: { cornerRadius: { show: true } } }), hub)).toMatchObject({ chrome: { radius: [0, 0, 0, 0] } });
  });

  it('button: chrome from the hub unless it overwrites, full width, own colours', () => {
    const hub = hubStyleProfile({ appearance: { buttons: { cornerRadius: { show: true, topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }, dropShadow: { show: true, size: 'large' } } } });
    expect(elementProfile(el('button', { styles: { theme: { show: true, colors: { background: '#5770D1', text: '#F7F2E8' } } } }), hub))
      .toEqual({ kind: 'button', align: 'left', marginTop: 30, bottomMargin: 0, chrome: hub.button, fullWidth: false, colours: { background: '#5770D1', text: '#F7F2E8' } });
    expect(elementProfile(el('button', { appearance: { overwrite: true }, styles: { size: { show: true, type: 'large' } } }), hub)).toMatchObject({ chrome: { paddingX: 63, radius: [40, 40, 40, 40], shadow: null } });
    expect(elementProfile(el('button', { styles: { width: { type: 'full' } } }), hub)).toMatchObject({ fullWidth: true });
    expect(elementProfile(el('button', { fullSize: true }), hub)).toMatchObject({ fullWidth: true });
    expect(elementProfile(el('button', { styles: { theme: { show: false, colors: { background: '#5770D1', text: '#F7F2E8' } } } }), hub)).toMatchObject({ colours: null });
  });

  it('everything else is placed but not styled', () => {
    expect(elementProfile(el('video', { margins: { top: 50 } }), DEFAULT_HUB_PROFILE)).toEqual({ kind: 'other', align: 'left', marginTop: 50, bottomMargin: 0 });
  });
});

describe('rhythm', () => {
  it('reproduces the hero: gaps 0, 20, 20, 30 after margin collapse', () => {
    const hub = DEFAULT_HUB_PROFILE;
    const profiles = [
      elementProfile(el('headline', { size: 'large', margins: { top: 0 } }), hub),
      elementProfile(el('text', { margins: { top: 0 } }), hub),
      elementProfile(el('button', { margins: { top: 0 } }), hub),
      elementProfile(el('button', { margins: { top: 30 } }), hub),
    ];
    expect(visibleGaps(profiles)).toEqual([0, 20, 20, 30]);
    expect(commonGap(visibleGaps(profiles))).toBe(20);
  });

  it('the first element keeps its own margin-top; a lone element has no common gap', () => {
    const one = [elementProfile(el('text', { margins: { top: 30 } }), DEFAULT_HUB_PROFILE)];
    expect(visibleGaps(one)).toEqual([30]);
    expect(commonGap(visibleGaps(one))).toBe(0);
    expect(visibleGaps([])).toEqual([]);
  });

  it('breaks a tie towards the smaller gap', () => {
    expect(commonGap([0, 20, 30])).toBe(20);
  });
});
