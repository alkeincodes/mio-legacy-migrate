import { describe, expect, it } from 'vitest';
import { columnProfile, sectionProfile } from '../../src/map/profile/section.js';

describe('sectionProfile', () => {
  it('reads explicit padding per side, with 50/0/50/0 for a missing side', () => {
    expect(sectionProfile({ styles: { padding: { show: true, top: '150', bottom: '150' } } }).padding).toEqual({ top: 150, right: 0, bottom: 150, left: 0 });
    expect(sectionProfile({ styles: { padding: { show: true, top: 0, right: '12' } } }).padding).toEqual({ top: 0, right: 12, bottom: 50, left: 0 });
  });

  it('uses the SCSS base when padding.show is off or absent', () => {
    expect(sectionProfile({ styles: { padding: { show: false, top: 150, bottom: 150 } } }).padding).toEqual({ top: 50, right: 0, bottom: 50, left: 0 });
    expect(sectionProfile({}).padding).toEqual({ top: 50, right: 0, bottom: 50, left: 0 });
  });

  it('carries ink only over an image, custom-color or gradient background', () => {
    expect(sectionProfile({ background: { type: 'image' }, textTheme: 'light' }).ink).toBe('light');
    expect(sectionProfile({ background: { type: 'custom-color' }, textTheme: 'dark' }).ink).toBe('dark');
    expect(sectionProfile({ background: { type: 'gradient' }, textTheme: 'custom', textThemeColor: '#F7F2E8' }).ink).toEqual({ hex: '#F7F2E8' });
    expect(sectionProfile({ background: { type: 'image' }, textTheme: 'custom' }, '#333333').ink).toEqual({ hex: '#333333' });
    expect(sectionProfile({ background: { type: 'default' }, textTheme: 'dark' }).ink).toBeNull();
    expect(sectionProfile({ background: { type: 'image' } }).ink).toBe('light');
  });

  it('records that legacy paints no tint over an image background, on sections and columns alike', () => {
    expect(sectionProfile({ background: { type: 'image' } }).imageOverlayOpacity).toBe(0);
    expect(columnProfile({}, 1).imageOverlayOpacity).toBe(0);
  });
});

describe('columnProfile', () => {
  it('turns styles.align into a vertical justify, default top', () => {
    expect(columnProfile({ styles: { align: 'center' } }, 2).justify).toBe('center');
    expect(columnProfile({ styles: { align: 'bottom' } }, 2).justify).toBe('end');
    expect(columnProfile({ styles: { align: 'top' } }, 2).justify).toBe('start');
    expect(columnProfile({}, 2).justify).toBe('start');
  });

  it('reads the width percentage, or splits the row evenly', () => {
    expect(columnProfile({ size: 50 }, 2).widthPct).toBe(50);
    expect(columnProfile({ size: '33.333333' }, 3).widthPct).toBeCloseTo(33.33, 1);
    expect(columnProfile({}, 4).widthPct).toBe(25);
  });

  it('reads the column decoration only when each block is shown', () => {
    const p = columnProfile({ styles: { padding: { show: true, top: 20, bottom: 20 }, cornerRadius: { show: true, topLeft: 12, topRight: 12, bottomRight: 12, bottomLeft: 12 }, dropShadow: { show: true, size: 'large' } } }, 1);
    expect(p.padding).toEqual({ top: 20, right: 0, bottom: 20, left: 0 });
    expect(p.radius).toEqual([12, 12, 12, 12]);
    expect(p.shadow).toBe('large');
    expect(columnProfile({ styles: { padding: { show: false, top: 20 } } }, 1)).toMatchObject({ padding: null, radius: null, shadow: null });
  });
});
