import type { ButtonChrome, ButtonProfile, Corners, HeadlineProfile, ImageProfile, TextProfile } from '../profile/types.js';
import { BUTTON_ICONS } from '../style.js';
import { FIDELITY_THRESHOLD_PX, type FidelityEntry } from './fidelity.js';

type Obj = Record<string, unknown>;
interface Translated { settings: Obj; fidelity: FidelityEntry[] }

/** headline.tsx SIZE_BY_LEVEL: level 4 is text-xl, body × 1.25 = 20px; legacy h4 is a fixed 18px. */
const V3_LEVEL4_PX = 20;

/**
 * Levels 2 and 3 land on the legacy sizes exactly (V3 keeps the same 0.75 ratio).
 * Level 4 is the one the spec's limits table lists, so it always gets an entry
 * even though 2px is under the general threshold.
 */
export function headlineSettings(p: HeadlineProfile): Translated {
  const fidelity: FidelityEntry[] = [];
  if (p.level === 4) fidelity.push({ property: 'headline.size', legacy: `${p.fontSize}px`, v3: `${V3_LEVEL4_PX}px` });
  return { settings: { level: p.level, weight: 700, align: p.align }, fidelity };
}

/** text.tsx:340 defaults marginBottom to 2 (8px); the stack gap owns the rhythm instead. */
export function textSettings(p: TextProfile): Translated {
  return { settings: { align: p.align, marginBottom: 0 }, fidelity: [] };
}

function meanCorner(c: Corners): number {
  return (c[0] + c[1] + c[2] + c[3]) / 4;
}

/** thumbnail.tsx:84-88: control 12px, control-l 14.4px, m 24px. */
const IMAGE_RADII: ReadonlyArray<{ name: string; px: number }> = [{ name: 'control', px: 12 }, { name: 'control-l', px: 14.4 }, { name: 'm', px: 24 }];

/** image.tsx: maxWidth whitelist 352 | 128, alignX center | start, contain forces natural mode. */
export function imageSettings(p: ImageProfile, alt: string, columnContentWidth: number | null): Translated {
  const fidelity: FidelityEntry[] = [];
  const settings: Obj = { alt, aspectRatio: 'auto', objectFit: 'contain', alignX: p.align === 'center' ? 'center' : 'start' };

  if (p.maxWidth !== null) {
    const cap = p.maxWidth <= 128 ? 128 : p.maxWidth <= 352 ? 352 : null;
    if (cap !== null) {
      settings['maxWidth'] = cap;
      if (Math.abs(cap - p.maxWidth) > 16) fidelity.push({ property: 'image.maxWidth', legacy: `${p.maxWidth}px`, v3: `${cap}px` });
    } else if (columnContentWidth !== null && p.maxWidth < columnContentWidth - 16) {
      fidelity.push({ property: 'image.maxWidth', legacy: `${p.maxWidth}px`, v3: `column width ${columnContentWidth}px` });
    }
  }

  const legacyRadius = meanCorner(p.chrome.radius);
  let radius = IMAGE_RADII[0]!;
  for (const candidate of IMAGE_RADII) {
    if (Math.abs(candidate.px - legacyRadius) < Math.abs(radius.px - legacyRadius)) radius = candidate;
  }
  settings['radius'] = radius.name;
  if (legacyRadius === 0 || Math.abs(radius.px - legacyRadius) > FIDELITY_THRESHOLD_PX) {
    fidelity.push({ property: 'image.radius', legacy: `${legacyRadius}px`, v3: `${radius.name} (${radius.px}px)` });
  }

  // Legacy paints nothing under an <img>; V3's Thumbnail paints an opaque
  // bg-background fill (MIO-288) that shows as a pale edge wherever the
  // contained image is a sub-pixel narrower than its box. backdrop: false
  // (MIO-3086) is the setting for that, for every image, not only transparent ones.
  settings['backdrop'] = false;
  if (p.chrome.border) {
    settings['outline'] = true;
    const b = p.chrome.border;
    fidelity.push({ property: 'image.border', legacy: `${b.width}px ${b.style} ${b.colour}`, v3: '1px hairline' });
  }
  return { settings, fidelity };
}

export function describeButtonChrome(c: ButtonChrome): string {
  const radius = c.radius.every((r) => r === c.radius[0]) ? `${c.radius[0]}px` : c.radius.map((r) => `${r}px`).join(' ');
  const border = c.border ? `, border ${c.border.width}px ${c.border.style} ${c.border.colour}` : '';
  return `${radius} radius, ${c.paddingY}px ${c.paddingX}px${border}, ${c.shadow ? `shadow ${c.shadow}` : 'no shadow'}, weight ${c.fontWeight}`;
}

/** ui/button.tsx:94-107 for lg; radius is --control-radius-base 24px × 0.6. */
export const V3_LG_BUTTON = 'size lg: 14.4px radius, 14px x 46px, no shadow, weight 400';

/**
 * button.tsx has variant, size, icons, fullWidthMobile, newTab and action, nothing
 * else. Every chrome difference is one hub-wide entry per distinct chrome; the
 * caller collapses duplicates.
 */
export function buttonSettings(p: ButtonProfile, legacySettings: Obj, action: { type: string; value: string }, newTab: boolean): Translated {
  const settings: Obj = { action, variant: 'primary', size: 'lg', newTab };
  const icon = (legacySettings['button'] as Obj | undefined)?.['icon'] as Obj | undefined;
  const glyph = (icon?.['illustration'] as Obj | undefined)?.['icon'];
  if (icon?.['show'] === true && typeof glyph === 'string' && BUTTON_ICONS[glyph]) {
    settings[icon['alignment'] === 'left' ? 'icon' : 'iconRight'] = BUTTON_ICONS[glyph];
  }
  if (p.fullWidth) settings['fullWidthMobile'] = true;
  const fidelity: FidelityEntry[] = [{ property: 'button.chrome', legacy: describeButtonChrome(p.chrome), v3: V3_LG_BUTTON, hubWide: true }];
  if (p.colours) fidelity.push({ property: 'button.colours', legacy: `${p.colours.background} on ${p.colours.text}`, v3: 'hub primary' });
  return { settings, fidelity };
}
