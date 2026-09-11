import type { LegacyHubTheme, LegacyMedia } from '../extract/queries.js';
import { cdnUrlFor, variantsOf } from '../extract/mediaPaths.js';
import type { PlanWarning } from './plan.js';

/** Legacy Spatie collection name to V3 branding key. */
const COLLECTION_TO_KEY: Record<string, string> = {
  'custom-logo': 'logo_url',
  'custom-login-logo': 'auth_logo_url',
  'social-image': 'social_image_url',
  favicons: 'favicon_url',
};

function warn(reason: string): PlanWarning {
  return { pageSlug: null, legacySectionId: null, type: 'approximated', reason };
}

export function mapBranding(
  theme: LegacyHubTheme | null,
  hubMedia: LegacyMedia[],
  cdnUrl: string,
  s3Url: string,
): { branding: Record<string, string>; warnings: PlanWarning[] } {
  const branding: Record<string, string> = {};
  const warnings: PlanWarning[] = [];

  if (!theme) {
    warnings.push(warn('the hub has no hub_theme row for its current_theme_id; branding is left at V3 defaults'));
  } else {
    let settings: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(theme.settings ?? '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        settings = parsed as Record<string, unknown>;
      }
    } catch {
      warnings.push(warn('hub_theme.settings is not valid JSON; branding is left at V3 defaults'));
    }

    const colours = (settings['colors'] ?? {}) as Record<string, unknown>;
    for (const [legacyKey, v3Key] of [
      ['primary', 'primary'],
      ['secondary', 'secondary'],
      ['background', 'background'],
      ['text', 'text'],
    ] as const) {
      const value = colours[legacyKey];
      if (value === undefined || value === null) continue;
      if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
        branding[v3Key] = value;
      } else {
        warnings.push(
          warn(
            `legacy theme colour ${legacyKey} is "${String(value)}", not a 6-digit hex; dropped because V3 substitutes its own default silently`,
          ),
        );
      }
    }
    if (settings['darkMode'] === true) branding['dark_mode'] = 'true';
  }

  for (const media of hubMedia) {
    const key = COLLECTION_TO_KEY[media.collection_name];
    if (!key || key in branding) continue;
    const original = variantsOf(media)[0];
    if (!original) continue;
    const url = cdnUrlFor(original.key, s3Url, cdnUrl);
    if (!url.startsWith('https://')) {
      warnings.push(warn(`branding ${key} resolved to "${url}", which is not https; dropped because the write would 422`));
      continue;
    }
    branding[key] = url;
  }

  return { branding, warnings };
}
