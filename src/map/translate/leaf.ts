import type { ButtonChrome, ButtonProfile, Corners, HeadlineProfile, ImageProfile, TextProfile } from '../profile/types.js';
import { BUTTON_ICONS } from '../style.js';
import { FIDELITY_THRESHOLD_PX, type FidelityEntry } from './fidelity.js';
import { cornersShorthand, paddingShorthand } from './surface.js';

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

  if (p.transparent) settings['backdrop'] = false;
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
 * else. The chrome (radius, padding, shadow) comes from the shell below; what
 * the shell cannot give is the weight and a border, reported hub-wide.
 */
export function buttonSettings(p: ButtonProfile, legacySettings: Obj, action: { type: string; value: string }, newTab: boolean): Translated {
  const settings: Obj = { action, variant: 'primary', size: 'lg', newTab };
  const icon = (legacySettings['button'] as Obj | undefined)?.['icon'] as Obj | undefined;
  const glyph = (icon?.['illustration'] as Obj | undefined)?.['icon'];
  if (icon?.['show'] === true && typeof glyph === 'string' && BUTTON_ICONS[glyph]) {
    settings[icon['alignment'] === 'left' ? 'icon' : 'iconRight'] = BUTTON_ICONS[glyph];
  }
  if (p.fullWidth) settings['fullWidthMobile'] = true;
  const fidelity: FidelityEntry[] = [{ property: 'button.weight', legacy: `${p.chrome.fontWeight}`, v3: '400', hubWide: true }];
  if (p.chrome.border) {
    const b = p.chrome.border;
    fidelity.push({ property: 'button.border', legacy: `${b.width}px ${b.style} ${b.colour}`, v3: 'none', hubWide: true });
  }
  if (p.colours) fidelity.push({ property: 'button.colours', legacy: `${p.colours.background} on ${p.colours.text}`, v3: 'hub primary' });
  return { settings, fidelity };
}

/** ui/button.tsx lg: 46px tall, 14px sides; legacy .btn line-height is 16px × 1.5. */
const V3_LG_HEIGHT = 46;
const V3_LG_PADDING_X = 14;
const LEGACY_BTN_LINE = 24;
const SHADOW: Record<string, string> = { small: 'sm', medium: 'md', large: 'lg' };

/**
 * The legacy button chrome as a shrink-wrapped stack around the V3 button: a
 * box of the button's fill colour with the legacy corners, padded out to the
 * legacy size, clipping the fill's hover growth, carrying the legacy shadow.
 * The V3 button's own rounded fill sits inside it in the same colour, so the
 * visible shape is legacy's. `fillHex` must be what the V3 primary fill renders.
 */
export function buttonShell(p: ButtonProfile, fillHex: string): Obj {
  const c = p.chrome;
  const dy = Math.max(0, Math.round((c.paddingY * 2 + LEGACY_BTN_LINE - V3_LG_HEIGHT) / 2));
  const dx = Math.max(0, c.paddingX - V3_LG_PADDING_X);
  const surface: Obj = {
    background: { type: 'custom-color', value: fillHex },
    borderRadius: cornersShorthand(c.radius),
    padding: paddingShorthand({ top: dy, right: dx, bottom: dy, left: dx }),
    clip: true,
  };
  if (c.shadow) surface['shadow'] = SHADOW[c.shadow];
  return { width: p.fullWidth ? 'full' : 'fit', gap: 0, surface };
}
