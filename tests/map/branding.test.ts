import { describe, expect, it } from 'vitest';
import { mapBranding } from '../../src/map/branding.js';
import type { LegacyHubTheme, LegacyMedia } from '../../src/extract/queries.js';

const S3 = 'https://legacy-bucket.s3.amazonaws.com';
const CDN = 'https://cdn.legacy.example.com';

function theme(settings: Record<string, unknown>): LegacyHubTheme {
  return { id: 1, theme_id: 1, hub_id: 7, settings: JSON.stringify(settings) };
}

const logo: LegacyMedia = {
  id: 555, model_type: 'App\\Hub', model_id: 7, uuid: null,
  collection_name: 'custom-logo', name: 'logo', file_name: 'logo.png',
  mime_type: 'image/png', disk: 's3', conversions_disk: null, size: 10,
  generated_conversions: null, custom_properties: null, responsive_images: null,
  order_column: 1,
};

describe('mapBranding', () => {
  it('maps legacy colours onto the V3 branding keys', () => {
    const { branding } = mapBranding(
      theme({ colors: { primary: '#F7B01E', secondary: '#101820', background: '#FFFFFF' } }),
      [],
      CDN,
      S3,
    );
    expect(branding['primary']).toBe('#F7B01E');
    expect(branding['secondary']).toBe('#101820');
    expect(branding['background']).toBe('#FFFFFF');
  });

  it('drops a colour that is not 6-digit hex and warns, because V3 substitutes silently', () => {
    const { branding, warnings } = mapBranding(theme({ colors: { primary: '#fff' } }), [], CDN, S3);
    expect(branding).not.toHaveProperty('primary');
    expect(warnings[0]?.type).toBe('approximated');
    expect(warnings[0]?.reason).toContain('#fff');
  });

  it('carries dark mode through as the boolean the hub types it as', () => {
    const { branding } = mapBranding(theme({ darkMode: true }), [], CDN, S3);
    expect(branding['dark_mode']).toBe(true);
  });

  it('resolves the logo media collection to an absolute https CDN URL', () => {
    const { branding } = mapBranding(theme({}), [logo], CDN, S3);
    expect(branding['logo_url']).toBe('https://cdn.legacy.example.com/555/logo.png');
  });

  it('maps each legacy media collection to its V3 branding key', () => {
    const { branding } = mapBranding(
      theme({}),
      [
        logo,
        { ...logo, id: 556, collection_name: 'custom-login-logo', file_name: 'login.png' },
        { ...logo, id: 557, collection_name: 'social-image', file_name: 'social.png' },
        { ...logo, id: 558, collection_name: 'favicons', file_name: 'fav.png' },
      ],
      CDN,
      S3,
    );
    expect(branding['auth_logo_url']).toBe('https://cdn.legacy.example.com/556/login.png');
    expect(branding['social_image_url']).toBe('https://cdn.legacy.example.com/557/social.png');
    expect(branding['favicon_url']).toBe('https://cdn.legacy.example.com/558/fav.png');
  });

  it('maps the legacy font names onto font_heading and font_body, which the hub loads from Google Fonts by family name', () => {
    const { branding, warnings } = mapBranding(theme({ fonts: { body: 'Mulish', heading: 'Mulish' } }), [], CDN, S3);
    expect(branding['font_heading']).toBe('Mulish');
    expect(branding['font_body']).toBe('Mulish');
    expect(warnings).toEqual([]);
    expect(Object.keys(mapBranding(theme({}), [], CDN, S3).branding).some((k) => k.startsWith('font'))).toBe(false);
  });

  it('returns an empty branding map and a warning when the hub has no theme row', () => {
    const { branding, warnings } = mapBranding(null, [], CDN, S3);
    expect(branding).toEqual({});
    expect(warnings[0]?.reason).toContain('no hub_theme row');
  });

  it('refuses a non-https asset URL rather than sending a write that 422s', () => {
    const { branding, warnings } = mapBranding(theme({}), [logo], 'http://cdn.legacy.example.com', S3);
    expect(branding).not.toHaveProperty('logo_url');
    expect(warnings.some((w) => w.reason.includes('https'))).toBe(true);
  });
});

describe('theme mode and primary', () => {
  it('forces the custom theme mode so the legacy page colours apply, and copies the background to the header', () => {
    const { branding, hubSettings } = mapBranding(theme({ colors: { background: '#333333', text: '#FAFAFA', primary: '#F7F2E8' }, darkMode: true }), [], CDN, S3);
    expect(hubSettings).toEqual({ background: { type: 'custom' } });
    expect(branding['header_color']).toBe('#333333');
    expect(branding['header_accent']).toBe('#FAFAFA');
  });

  it('paints the header with the legacy header section colour and accent when the theme sets them', () => {
    const { branding } = mapBranding(theme({
      colors: { background: '#333333', text: '#FAFAFA' },
      sections: { header: { color: '#878C6A', background: { type: 'custom-color' }, accentColor: '#F7F2E8', menuLayout: 'tabs' } },
    }), [], CDN, S3);
    expect(branding['header_color']).toBe('#878C6A');
    expect(branding['header_accent']).toBe('#F7F2E8');
    expect(branding['background']).toBe('#333333');
    // A header that is not custom-coloured keeps the page background.
    const plain = mapBranding(theme({ colors: { background: '#333333', text: '#FAFAFA' }, sections: { header: { color: '#878C6A', background: { type: 'theme' } } } }), [], CDN, S3).branding;
    expect(plain['header_color']).toBe('#333333');
    const bad = mapBranding(theme({ colors: { background: '#333333' }, sections: { header: { color: 'olive', background: { type: 'custom-color' } } } }), [], CDN, S3);
    expect(bad.branding['header_color']).toBe('#333333');
    expect(bad.warnings.some((w) => w.reason.includes('"olive"'))).toBe(true);
  });

  it('uses the dominant legacy button colour as the V3 primary, and says so', () => {
    const { branding, warnings } = mapBranding(theme({ colors: { primary: '#F7F2E8' } }), [], CDN, S3, { dominantButton: { background: '#5770D1', text: '#F7F2E8' } });
    expect(branding['primary']).toBe('#5770D1');
    expect(warnings.some((w) => w.reason.includes('#5770D1'))).toBe(true);
  });

  it('carries the legacy heading and body font sizes when the theme sets them', () => {
    const { branding } = mapBranding(theme({ fonts: { headingFontSize: 40, bodyFontSize: '18' } }), [], CDN, S3);
    expect(branding['heading_font_size']).toBe(40);
    expect(branding['body_font_size']).toBe(18);
    expect(mapBranding(theme({}), [], CDN, S3).branding).not.toHaveProperty('heading_font_size');
  });
});
