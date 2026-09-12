import { describe, expect, it } from 'vitest';
import { columnProfile, sectionProfile } from '../../src/map/profile/section.js';
import { LAYOUT_ROW_SETTINGS, columnSurface, cornersShorthand, inkFor, luminance, paddingShorthand, sectionSurface } from '../../src/map/translate/surface.js';

describe('shorthands', () => {
  it('collapses a box the way CSS does', () => {
    expect(paddingShorthand({ top: 150, right: 0, bottom: 150, left: 0 })).toBe('150px 0');
    expect(paddingShorthand({ top: 50, right: 0, bottom: 50, left: 0 })).toBe('50px 0');
    expect(paddingShorthand({ top: 20, right: 20, bottom: 20, left: 20 })).toBe('20px');
    expect(paddingShorthand({ top: 10, right: 20, bottom: 30, left: 20 })).toBe('10px 20px 30px');
    expect(paddingShorthand({ top: 1, right: 2, bottom: 3, left: 4 })).toBe('1px 2px 3px 4px');
    expect(cornersShorthand([12, 12, 12, 12])).toBe('12px');
    expect(cornersShorthand([0, 12, 0, 12])).toBe('0 12px');
  });
});

describe('ink', () => {
  it('passes the poles through and picks a pole for a custom hex by luminance', () => {
    expect(inkFor('light')).toEqual({ value: 'light', fidelity: null });
    expect(inkFor('dark')).toEqual({ value: 'dark', fidelity: null });
    expect(inkFor(null)).toEqual({ value: null, fidelity: null });
    expect(luminance('#F7F2E8')).toBeGreaterThan(0.5);
    expect(luminance('#333333')).toBeLessThan(0.5);
    expect(inkFor({ hex: '#F7F2E8' })).toEqual({ value: 'light', fidelity: { property: 'section.ink', legacy: '#F7F2E8', v3: 'light' } });
    expect(inkFor({ hex: '#333333' }).value).toBe('dark');
  });
});

describe('sectionSurface', () => {
  const hero = { styles: { padding: { top: '150', show: true, bottom: '150' }, visibility: 'desktop' }, textTheme: 'custom', textThemeColor: '#F7F2E8', background: { type: 'image', image: { url: 'https://cdn/x.png' } } };

  it('carries exact padding, ink, background and visibility for the hero', () => {
    const { surface, fidelity } = sectionSurface(sectionProfile(hero), hero, false, {});
    expect(surface).toEqual({ padding: '150px 0', ink: 'light', background: { type: 'image', url: 'https://cdn/x.png', blur: false, scrim: false }, visibility: { desktop: true, mobile: false } });
    expect(fidelity).toEqual([{ property: 'section.ink', legacy: '#F7F2E8', v3: 'light' }]);
  });

  it('writes the legacy base padding and no ink for a plain section', () => {
    const { surface, fidelity } = sectionSurface(sectionProfile({}), {}, false, {});
    expect(surface).toEqual({ padding: '50px 0', background: { type: 'none' } });
    expect(fidelity).toEqual([]);
  });

  it('hides a hidden section on both devices', () => {
    expect(sectionSurface(sectionProfile({}), {}, true, {}).surface['visibility']).toEqual({ desktop: false, mobile: false });
  });
});

describe('columnSurface', () => {
  it('turns the scrim off on a column image background too', () => {
    const settings = { background: { type: 'image', image: { url: 'https://cdn/c.png' } } };
    expect(columnSurface(columnProfile(settings, 2), settings, {})).toEqual({ background: { type: 'image', url: 'https://cdn/c.png', blur: false, scrim: false } });
  });

  it('is null for an undecorated column and exact px for a decorated one', () => {
    expect(columnSurface(columnProfile({}, 2), {}, {})).toBeNull();
    const settings = { styles: { padding: { show: true, top: 20, bottom: 20, left: 10, right: 10 }, cornerRadius: { show: true, topLeft: 12, topRight: 12, bottomRight: 12, bottomLeft: 12 }, dropShadow: { show: true, size: 'large' } }, background: { type: 'custom-color', color: '#101820' } };
    expect(columnSurface(columnProfile(settings, 2), settings, {})).toEqual({ background: { type: 'custom-color', value: '#101820' }, padding: '20px 10px', borderRadius: '12px', shadow: 'lg' });
  });
});

describe('LAYOUT_ROW_SETTINGS', () => {
  it('is the legacy 20px gutter on a stretched, wrapping, responsive row', () => {
    expect(LAYOUT_ROW_SETTINGS).toEqual({ gap: 5, mobileGap: 6, align: 'stretch', wrap: true, responsive: true });
  });
});
