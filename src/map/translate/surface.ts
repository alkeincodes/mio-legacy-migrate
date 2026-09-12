import type { Box, ColumnProfile, Corners, Ink, SectionProfile } from '../profile/types.js';
import { surfaceBackgroundFor, type Surface, type ThemeColours } from '../style.js';
import type { FidelityEntry } from './fidelity.js';

type Obj = Record<string, unknown>;

function unit(n: number): string {
  return n === 0 ? '0' : `${n}px`;
}

/** Four sides to the shortest CSS shorthand that means the same thing. */
export function paddingShorthand(box: Box): string {
  const { top, right, bottom, left } = box;
  if (top === right && right === bottom && bottom === left) return unit(top);
  if (top === bottom && right === left) return `${unit(top)} ${unit(right)}`;
  if (right === left) return `${unit(top)} ${unit(right)} ${unit(bottom)}`;
  return `${unit(top)} ${unit(right)} ${unit(bottom)} ${unit(left)}`;
}

export function cornersShorthand([tl, tr, br, bl]: Corners): string {
  return paddingShorthand({ top: tl, right: tr, bottom: br, left: bl });
}

/** WCAG relative luminance of a 6-digit hex. */
export function luminance(hex: string): number {
  const channel = (i: number): number => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** V3 surface.ink has two poles; a custom legacy colour takes the nearer one. */
export function inkFor(ink: Ink): { value: 'light' | 'dark' | null; fidelity: FidelityEntry | null } {
  if (ink === null) return { value: null, fidelity: null };
  if (ink === 'light' || ink === 'dark') return { value: ink, fidelity: null };
  const value = luminance(ink.hex) >= 0.5 ? 'light' : 'dark';
  return { value, fidelity: { property: 'section.ink', legacy: ink.hex, v3: value } };
}

/** The inner row every columns section carries: legacy's 20px gutter, stretched columns. */
export const LAYOUT_ROW_SETTINGS: Readonly<Obj> = Object.freeze({ gap: 5, mobileGap: 6, align: 'stretch', wrap: true, responsive: true });

/**
 * V3 composes a secondary-tint scrim over every image background unless the
 * background carries a literal `scrim: false` (node-surface.tsx:110-121).
 * Legacy paints its overlay at the profile's opacity, 0 in the stylesheet.
 */
function withScrim(background: Record<string, unknown> | null, overlayOpacity: number): Record<string, unknown> | null {
  if (!background || background['type'] !== 'image') return background;
  return { ...background, scrim: overlayOpacity > 0 };
}

/** A section's surface: exact padding, ink, background and device visibility. */
export function sectionSurface(profile: SectionProfile, settings: Obj, hidden: boolean, theme: ThemeColours): { surface: Surface; fidelity: FidelityEntry[] } {
  const fidelity: FidelityEntry[] = [];
  const surface: Surface = { padding: paddingShorthand(profile.padding) };
  const ink = inkFor(profile.ink);
  if (ink.value) surface['ink'] = ink.value;
  if (ink.fidelity) fidelity.push(ink.fidelity);
  // A legacy section with no background shows the page colour; without an explicit
  // `none` the hero template paints its own default tint instead.
  surface['background'] = withScrim(surfaceBackgroundFor(settings['background'] as Obj | undefined, theme), profile.imageOverlayOpacity) ?? { type: 'none' };
  const visibility = (settings['styles'] as Obj | undefined)?.['visibility'];
  if (hidden) surface['visibility'] = { desktop: false, mobile: false };
  else if (visibility === 'desktop') surface['visibility'] = { desktop: true, mobile: false };
  else if (visibility === 'mobile') surface['visibility'] = { desktop: false, mobile: true };
  return { surface, fidelity };
}

const SHADOW: Record<string, string> = { small: 'sm', medium: 'md', large: 'lg' };

/** A column's own decoration as a stack surface, or null when it has none. */
export function columnSurface(profile: ColumnProfile, settings: Obj, theme: ThemeColours): Surface | null {
  const surface: Surface = {};
  const background = withScrim(surfaceBackgroundFor(settings['background'] as Obj | undefined, theme), profile.imageOverlayOpacity);
  if (background) surface['background'] = background;
  if (profile.padding) surface['padding'] = paddingShorthand(profile.padding);
  if (profile.radius) surface['borderRadius'] = cornersShorthand(profile.radius);
  if (profile.shadow) surface['shadow'] = SHADOW[profile.shadow];
  return Object.keys(surface).length > 0 ? surface : null;
}
