import { describe, expect, it } from 'vitest';
import {
  buttonSettingsFor, dominantButtonColour, imageSettingsFor, sectionSurfaceFor, stackWidthFor, surfacePaddingFor,
} from '../../src/map/style.js';

describe('style translation', () => {
  it('maps legacy padding pixels onto the surface padding scale', () => {
    expect(surfacePaddingFor({ padding: { top: '150', bottom: '150', show: true } })).toBe('xl');
    expect(surfacePaddingFor({ padding: { top: '100', bottom: '100', show: true } })).toBe('section');
    expect(surfacePaddingFor({ padding: { top: 0, bottom: 0, show: true } })).toBe('sm');
    expect(surfacePaddingFor({ padding: { top: 0, bottom: 0, show: false } })).toBe('none');
  });

  it('maps the legacy background kinds onto surface.background', () => {
    expect(sectionSurfaceFor({ background: { type: 'custom-color', color: '#242424' } }, false)['background']).toEqual({ type: 'custom-color', value: '#242424' });
    expect(sectionSurfaceFor({ background: { type: 'secondary-color' } }, false)['background']).toEqual({ type: 'color', token: 'secondary' });
    expect(sectionSurfaceFor({ background: { type: 'image', image: { url: 'https://x/y.png' }, color: '#878C6A' } }, false)['background']).toEqual({ type: 'image', url: 'https://x/y.png', blur: false });
    expect(sectionSurfaceFor({ background: { type: 'default' } }, false)).not.toHaveProperty('background');
  });

  it('carries desktop-only or mobile-only visibility', () => {
    expect(sectionSurfaceFor({ styles: { visibility: 'desktop' } }, false)['visibility']).toEqual({ desktop: true, mobile: false });
  });

  it('turns percentages into the stack width enum', () => {
    expect(stackWidthFor(100)).toBe('full');
    expect(stackWidthFor(50)).toBe('1/2');
    expect(stackWidthFor(33.333333)).toBe('1/3');
    expect(stackWidthFor(25)).toBe('1/4');
    expect(stackWidthFor('2/3')).toBe('2/3');
  });

  it('shows images whole at their legacy width instead of the 16:9 crop default', () => {
    expect(imageSettingsFor({ align: 'center', styles: { width: { type: 'custom', value: 250 }, cornerRadius: { show: true } } }, 'x')).toEqual({
      alt: 'x', aspectRatio: 'auto', objectFit: 'contain', alignX: 'center', maxWidth: 352, radius: 'm',
    });
  });

  it('keeps a trailing icon only when the sprite has it', () => {
    const s = buttonSettingsFor({ button: { icon: { show: true, alignment: 'right', illustration: { icon: 'chat' } } } }, { type: 'url', value: 'https://x' }, false);
    expect(s).toMatchObject({ size: 'lg', iconRight: 'chat', variant: 'primary' });
    expect(buttonSettingsFor({ button: { icon: { show: true, alignment: 'right', illustration: { icon: 'target' } } } }, { type: 'url', value: 'https://x' }, false)).not.toHaveProperty('iconRight');
  });

  it('finds the button colour most of the hub uses, or nothing when buttons disagree', () => {
    const btn = (bg: string) => ({ type: 'button', settings: JSON.stringify({ styles: { theme: { colors: { background: bg, text: '#FFFFFF' } } } }) });
    expect(dominantButtonColour([btn('#5770D1'), btn('#5770D1'), btn('#5770D1'), btn('#000000')])).toEqual({ background: '#5770D1', text: '#FFFFFF' });
    expect(dominantButtonColour([btn('#5770D1'), btn('#000000')])).toBeNull();
  });
});

describe('theme-colour backgrounds', () => {
  it('carry the legacy theme hex instead of a V3 token, which means the page ink in custom mode', () => {
    expect(sectionSurfaceFor({ background: { type: 'secondary-color' } }, false, { secondary: '#333333' })['background']).toEqual({ type: 'custom-color', value: '#333333' });
  });
});
