import { describe, expect, it } from 'vitest';
import { DEFAULT_HUB_PROFILE, hubStyleProfile } from '../../src/map/profile/hub.js';
import type { ButtonProfile, HeadlineProfile, ImageProfile, TextProfile } from '../../src/map/profile/types.js';
import { V3_LG_BUTTON, buttonSettings, describeButtonChrome, headlineSettings, imageSettings, textSettings } from '../../src/map/translate/leaf.js';

const base = { align: 'left' as const, marginTop: 0, bottomMargin: 0 };

describe('headlineSettings', () => {
  it('maps level and weight, never the display size, and reports the h4 size gap', () => {
    const h2: HeadlineProfile = { ...base, kind: 'headline', level: 2, fontSize: 32, bottomMargin: 20, align: 'center' };
    expect(headlineSettings(h2)).toEqual({ settings: { level: 2, weight: 700, align: 'center' }, fidelity: [] });
    const h4: HeadlineProfile = { ...base, kind: 'headline', level: 4, fontSize: 18, bottomMargin: 10 };
    expect(headlineSettings(h4)).toEqual({ settings: { level: 4, weight: 700, align: 'left' }, fidelity: [{ property: 'headline.size', legacy: '18px', v3: '20px' }] });
  });
});

describe('textSettings', () => {
  it('sets align and removes the V3 default bottom margin', () => {
    const t: TextProfile = { ...base, kind: 'text', align: 'right', bottomMargin: 20 };
    expect(textSettings(t)).toEqual({ settings: { align: 'right', marginBottom: 0 }, fidelity: [] });
  });
});

describe('imageSettings', () => {
  const image = (over: Partial<ImageProfile>): ImageProfile => ({ ...base, kind: 'image', maxWidth: null, fill: false, chrome: DEFAULT_HUB_PROFILE.thumbnail, transparent: false, align: 'center', ...over });

  it('the hero wordmark: 250 snaps to 352 with an entry, no backdrop under any image, 30px corners are m', () => {
    const p = image({ maxWidth: 250, transparent: true, chrome: { radius: [30, 30, 30, 30], border: null, shadow: null } });
    expect(imageSettings(p, 'Wordmark', 600)).toEqual({
      settings: { alt: 'Wordmark', aspectRatio: 'auto', objectFit: 'contain', alignX: 'center', maxWidth: 352, radius: 'm', backdrop: false },
      fidelity: [{ property: 'image.maxWidth', legacy: '250px', v3: '352px' }, { property: 'image.radius', legacy: '30px', v3: 'm (24px)' }],
    });
  });

  it('a wide image in a narrower column keeps no cap and reports the column width it will fill', () => {
    const rounded = { radius: [12, 12, 12, 12] as [number, number, number, number], border: null, shadow: null };
    expect(imageSettings(image({ maxWidth: 490, chrome: rounded }), 'x', 600).fidelity).toEqual([{ property: 'image.maxWidth', legacy: '490px', v3: 'column width 600px' }]);
    expect(imageSettings(image({ maxWidth: 490, chrome: rounded }), 'x', 600).settings).not.toHaveProperty('maxWidth');
    expect(imageSettings(image({ maxWidth: 1000, chrome: rounded }), 'x', 600).fidelity).toEqual([]);
  });

  it('square legacy images cannot be drawn: control (12px) with an entry; 128 and near-352 caps are exact', () => {
    expect(imageSettings(image({ maxWidth: 120, align: 'left' }), 'x', null)).toEqual({
      settings: { alt: 'x', aspectRatio: 'auto', objectFit: 'contain', alignX: 'start', maxWidth: 128, radius: 'control', backdrop: false },
      fidelity: [{ property: 'image.radius', legacy: '0px', v3: 'control (12px)' }],
    });
    expect(imageSettings(image({ maxWidth: 350, chrome: { radius: [14, 14, 14, 14], border: null, shadow: null } }), 'x', null).fidelity).toEqual([]);
  });

  it('a border becomes the hairline outline with an entry', () => {
    const p = image({ chrome: { radius: [12, 12, 12, 12], border: { width: 3, colour: '#ff0000', style: 'solid' }, shadow: null } });
    expect(imageSettings(p, 'x', null)).toMatchObject({ settings: { outline: true }, fidelity: [{ property: 'image.border', legacy: '3px solid #ff0000', v3: '1px hairline' }] });
  });
});

describe('buttonSettings', () => {
  const hub = hubStyleProfile({ appearance: { buttons: { cornerRadius: { show: true, topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }, dropShadow: { show: true, size: 'large' } } } });
  const button = (over: Partial<ButtonProfile>): ButtonProfile => ({ ...base, kind: 'button', chrome: hub.button, fullWidth: false, colours: null, ...over });

  it('describes the ManTalks chrome and pairs it with what lg draws', () => {
    expect(describeButtonChrome(hub.button)).toBe('0px radius, 13px 30px, shadow large, weight 700');
    expect(V3_LG_BUTTON).toBe('size lg: 14.4px radius, 14px x 46px, no shadow, weight 400');
  });

  it('emits lg with the icon and a hub-wide chrome entry', () => {
    const legacy = { button: { icon: { show: true, alignment: 'right', illustration: { icon: 'chat' } } } };
    expect(buttonSettings(button({}), legacy, { type: 'page', value: '/discussions' }, false)).toEqual({
      settings: { action: { type: 'page', value: '/discussions' }, variant: 'primary', size: 'lg', newTab: false, iconRight: 'chat' },
      fidelity: [{ property: 'button.chrome', legacy: '0px radius, 13px 30px, shadow large, weight 700', v3: V3_LG_BUTTON, hubWide: true }],
    });
  });

  it('a left icon, full width, and colours that differ from the hub primary', () => {
    const legacy = { button: { icon: { show: true, alignment: 'left', illustration: { icon: 'play' } } } };
    const out = buttonSettings(button({ fullWidth: true, colours: { background: '#000000', text: '#ffffff' } }), legacy, { type: 'url', value: 'https://x' }, true);
    expect(out.settings).toEqual({ action: { type: 'url', value: 'https://x' }, variant: 'primary', size: 'lg', newTab: true, icon: 'play', fullWidthMobile: true });
    expect(out.fidelity).toContainEqual({ property: 'button.colours', legacy: '#000000 on #ffffff', v3: 'hub primary' });
  });

  it('a pill at the base chrome still differs from lg and says so', () => {
    expect(buttonSettings(button({ chrome: DEFAULT_HUB_PROFILE.button }), {}, { type: 'url', value: '' }, false).fidelity[0]?.legacy).toBe('40px radius, 13px 30px, no shadow, weight 700');
  });
});
