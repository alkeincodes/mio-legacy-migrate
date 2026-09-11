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

  it('carries dark mode through as a flag', () => {
    const { branding } = mapBranding(theme({ darkMode: true }), [], CDN, S3);
    expect(branding['dark_mode']).toBe('true');
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

  it('emits no font keys, because legacy has no per-hub font setting', () => {
    const { branding } = mapBranding(theme({ colors: { primary: '#F7B01E' } }), [], CDN, S3);
    expect(Object.keys(branding).some((k) => k.startsWith('font'))).toBe(false);
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
