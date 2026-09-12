import { describe, expect, it } from 'vitest';
import { DEFAULT_HUB_PROFILE, buttonChromeFrom, hubStyleProfile, imageChromeFrom } from '../../src/map/profile/hub.js';

describe('hubStyleProfile', () => {
  it('reads the ManTalks theme: square shadowed buttons, 30px thumbnails, default font sizes', () => {
    const profile = hubStyleProfile({
      fonts: { body: 'Mulish', heading: 'Mulish' },
      colors: { primary: '#F7F2E8', secondary: '#333333' },
      appearance: {
        buttons: { dropShadow: { show: true, size: 'large' }, cornerRadius: { show: true, topLeft: '0', topRight: '0', bottomLeft: '0', bottomRight: '0' } },
        thumbnails: { cornerRadius: { show: true, topLeft: '30', topRight: '30', bottomLeft: '30', bottomRight: '30' } },
      },
    });
    expect(profile.headingFontSize).toBe(32);
    expect(profile.bodyFontSize).toBe(16);
    expect(profile.button).toEqual({ paddingY: 13, paddingX: 30, radius: [0, 0, 0, 0], border: null, shadow: 'large', fontSize: 16, fontWeight: 700 });
    expect(profile.thumbnail).toEqual({ radius: [30, 30, 30, 30], border: null, shadow: null });
    expect(profile.colours).toEqual({ primary: '#F7F2E8', secondary: '#333333' });
  });

  it('carries the legacy font sizes when the theme sets them', () => {
    const profile = hubStyleProfile({ fonts: { headingFontSize: 40, bodyFontSize: '18' } });
    expect(profile.headingFontSize).toBe(40);
    expect(profile.bodyFontSize).toBe(18);
  });

  it('defaults to the SCSS base: 40px pill, 13px 30px, no shadow', () => {
    expect(hubStyleProfile({}).button).toEqual(DEFAULT_HUB_PROFILE.button);
    expect(DEFAULT_HUB_PROFILE.button).toEqual({ paddingY: 13, paddingX: 30, radius: [40, 40, 40, 40], border: null, shadow: null, fontSize: 16, fontWeight: 700 });
    expect(DEFAULT_HUB_PROFILE.thumbnail).toEqual({ radius: [0, 0, 0, 0], border: null, shadow: null });
  });
});

describe('buttonChromeFrom', () => {
  it('applies the large size preset only when size.show is on', () => {
    expect(buttonChromeFrom({ size: { show: true, type: 'large' } })).toMatchObject({ paddingY: 21, paddingX: 63 });
    expect(buttonChromeFrom({ size: { show: false, type: 'large' } })).toMatchObject({ paddingY: 13, paddingX: 30 });
  });

  it('reads per-corner radius with 40 as the missing-corner default, border and shadow', () => {
    expect(buttonChromeFrom({ cornerRadius: { show: true, topLeft: 8 }, border: { show: true, width: 2, color: '#ff0000', type: 'dashed' }, dropShadow: { show: true } }))
      .toEqual({ paddingY: 13, paddingX: 30, radius: [8, 40, 40, 40], border: { width: 2, colour: '#ff0000', style: 'dashed' }, shadow: 'small', fontSize: 16, fontWeight: 700 });
  });

  it('ignores a radius block whose show is off', () => {
    expect(buttonChromeFrom({ cornerRadius: { show: false, topLeft: 0 } }).radius).toEqual([40, 40, 40, 40]);
  });
});

describe('imageChromeFrom', () => {
  it('defaults every corner to 0 and reads border and shadow', () => {
    expect(imageChromeFrom({ cornerRadius: { show: true, topLeft: '12', bottomRight: '12' } }).radius).toEqual([12, 0, 12, 0]);
    expect(imageChromeFrom({ border: { show: true } }).border).toEqual({ width: 1, colour: '#000000', style: 'solid' });
    expect(imageChromeFrom(undefined)).toEqual({ radius: [0, 0, 0, 0], border: null, shadow: null });
  });
});
