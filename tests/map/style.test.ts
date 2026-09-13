import { describe, expect, it } from 'vitest';
import { dominantButtonColour, stackWidthFor, surfaceBackgroundFor } from '../../src/map/style.js';

describe('shared style vocabulary', () => {
  it('maps the legacy background kinds onto surface.background', () => {
    expect(surfaceBackgroundFor({ type: 'custom-color', color: '#242424' })).toEqual({ type: 'custom-color', value: '#242424' });
    expect(surfaceBackgroundFor({ type: 'secondary-color' })).toEqual({ type: 'color', token: 'secondary' });
    expect(surfaceBackgroundFor({ type: 'secondary-color' }, { secondary: '#333333' })).toEqual({ type: 'custom-color', value: '#333333' });
    expect(surfaceBackgroundFor({ type: 'image', image: { url: 'https://x/y.png' }, color: '#878C6A' })).toEqual({ type: 'image', url: 'https://x/y.png', blur: false });
    expect(surfaceBackgroundFor({ type: 'default' })).toBeNull();
  });

  it('turns percentages into the stack width enum', () => {
    expect(stackWidthFor(100)).toBe('full');
    expect(stackWidthFor(50)).toBe('1/2');
    expect(stackWidthFor(33.333333)).toBe('1/3');
    expect(stackWidthFor(25)).toBe('1/4');
    expect(stackWidthFor('2/3')).toBe('2/3');
  });

  it('finds the button colour most of the hub uses, or nothing when buttons disagree', () => {
    const btn = (bg: string) => ({ type: 'button', settings: JSON.stringify({ styles: { theme: { colors: { background: bg, text: '#FFFFFF' } } } }) });
    expect(dominantButtonColour([btn('#5770D1'), btn('#5770D1'), btn('#5770D1'), btn('#000000')])).toEqual({ background: '#5770D1', text: '#FFFFFF' });
    expect(dominantButtonColour([btn('#5770D1'), btn('#000000')])).toBeNull();
  });

  it('a primary-colour band is the primary token when V3 primary is the legacy primary, else the hex', () => {
    expect(surfaceBackgroundFor({ type: 'primary-color' }, { primary: '#5F7FEC', brandingPrimary: '#5f7fec' })).toEqual({ type: 'color', token: 'primary' });
    expect(surfaceBackgroundFor({ type: 'primary-color' }, { primary: '#F7F2E8', brandingPrimary: '#5770D1' })).toEqual({ type: 'custom-color', value: '#F7F2E8' });
  });
});

