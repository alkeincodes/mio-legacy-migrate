/**
 * Legacy section and element styling translated into the catalog's settings
 * vocabulary (the mio skill's generated settings tables are the reference).
 * Anything the catalog cannot express is left out and reported by the caller.
 */
import type { CatalogNode } from './catalog.js';
import { parseJsonObject } from '../extract/json.js';

export type Surface = Record<string, unknown>;

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** Legacy `styles.padding` {top,bottom,show} in px to the surface padding scale. */
export function surfacePaddingFor(styles: Record<string, unknown> | undefined): string {
  const padding = (styles?.['padding'] ?? {}) as Record<string, unknown>;
  if (padding['show'] === false) return 'none';
  const top = Number(padding['top'] ?? NaN);
  const bottom = Number(padding['bottom'] ?? NaN);
  const px = Math.max(Number.isFinite(top) ? top : 0, Number.isFinite(bottom) ? bottom : 0);
  if (px >= 140) return 'xl';
  if (px >= 90) return 'section';
  if (px >= 40) return 'md';
  return 'sm';
}

/** Legacy `background` to `surface.background`; null when it is the page default. */
export function surfaceBackgroundFor(background: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!background) return null;
  const type = background['type'];
  const colour = typeof background['color'] === 'string' && HEX6.test(background['color']) ? background['color'] : null;
  const image = background['image'];
  const imageUrl = typeof image === 'string' ? image : (image as Record<string, unknown> | undefined)?.['url'];
  switch (type) {
    case 'image':
      return typeof imageUrl === 'string' ? { type: 'image', url: imageUrl, blur: background['blur'] === true } : null;
    case 'custom-color':
    case 'color':
      return colour ? { type: 'custom-color', value: colour } : null;
    case 'secondary-color':
      return { type: 'color', token: 'secondary' };
    case 'primary-color':
      return { type: 'color', token: 'primary' };
    case 'thumbnail':
      return null;
    default:
      return null;
  }
}

/** A section's full surface: background, padding and per-device visibility. */
export function sectionSurfaceFor(settings: Record<string, unknown>, hidden: boolean): Surface {
  const styles = settings['styles'] as Record<string, unknown> | undefined;
  const surface: Surface = { padding: surfacePaddingFor(styles) };
  const background = surfaceBackgroundFor(settings['background'] as Record<string, unknown> | undefined);
  if (background) surface['background'] = background;
  const visibility = styles?.['visibility'];
  if (hidden) surface['visibility'] = { desktop: false, mobile: false };
  else if (visibility === 'desktop') surface['visibility'] = { desktop: true, mobile: false };
  else if (visibility === 'mobile') surface['visibility'] = { desktop: false, mobile: true };
  return surface;
}

/** Legacy column `size` (a percentage, or a string like "1/2") to the stack width enum. */
export function stackWidthFor(size: unknown): string {
  if (typeof size === 'string' && ['full', '1/2', '1/3', '1/4', '2/3', '3/4', 'fit'].includes(size)) return size;
  const pct = Number(size);
  if (!Number.isFinite(pct) || pct >= 90) return 'full';
  if (pct >= 70) return '3/4';
  if (pct >= 60) return '2/3';
  if (pct >= 45) return '1/2';
  if (pct >= 30) return '1/3';
  return '1/4';
}

/** A column's own decoration (padding, border, radius, background) as a stack surface, or null. */
export function columnSurfaceFor(settings: Record<string, unknown>): Surface | null {
  const styles = settings['styles'] as Record<string, unknown> | undefined;
  const surface: Surface = {};
  const background = surfaceBackgroundFor(settings['background'] as Record<string, unknown> | undefined);
  if (background) surface['background'] = background;
  const padding = styles?.['padding'] as Record<string, unknown> | undefined;
  if (padding && padding['show'] !== false && Object.keys(padding).some((k) => k !== 'show')) surface['padding'] = 'card';
  const radius = styles?.['cornerRadius'] as Record<string, unknown> | undefined;
  if (radius?.['show'] === true) surface['borderRadius'] = 'md';
  const shadow = styles?.['dropShadow'] as Record<string, unknown> | undefined;
  if (shadow?.['show'] === true) surface['shadow'] = shadow['size'] === 'large' ? 'lg' : 'md';
  return Object.keys(surface).length > 0 ? surface : null;
}

/** The inner layout row every section carries, per the catalog's row recipe. */
export function layoutRowSettings(columnCount: number): Record<string, unknown> {
  return columnCount === 2
    ? { align: 'stretch', gap: 6, mobileGap: 3, responsive: true, wrap: true }
    : { align: 'stretch', gap: 6, mobileGap: 3, responsive: true, wrap: true };
}

export function headlineSettingsFor(settings: Record<string, unknown>, isSubheadline: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = { level: isSubheadline ? 3 : 2, weight: 700 };
  if (!isSubheadline && settings['size'] === 'large') out['size'] = 'large-title';
  if (settings['align'] === 'center' || settings['align'] === 'right' || settings['align'] === 'left') out['align'] = settings['align'];
  return out;
}

export function textSettingsFor(settings: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (settings['align'] === 'center' || settings['align'] === 'right' || settings['align'] === 'left') out['align'] = settings['align'];
  return out;
}

/** Legacy images are shown whole at a chosen width; the catalog default (16:9 cover) would crop them. */
export function imageSettingsFor(settings: Record<string, unknown>, alt: string): Record<string, unknown> {
  const styles = settings['styles'] as Record<string, unknown> | undefined;
  const out: Record<string, unknown> = { alt, aspectRatio: 'auto', objectFit: 'contain' };
  if (settings['align'] === 'center') out['alignX'] = 'center';
  else if (settings['align'] === 'left') out['alignX'] = 'start';
  const width = (styles?.['width'] as Record<string, unknown> | undefined)?.['value'];
  const px = Number(width);
  if (Number.isFinite(px) && px > 0 && px <= 140) out['maxWidth'] = 128;
  else if (Number.isFinite(px) && px > 0 && px <= 380) out['maxWidth'] = 352;
  const radius = styles?.['cornerRadius'] as Record<string, unknown> | undefined;
  if (radius?.['show'] === true) out['radius'] = 'm';
  if ((styles?.['border'] as Record<string, unknown> | undefined)?.['show'] === true) out['outline'] = true;
  return out;
}

/** Sprite ids verified present in the hub icon set (mio skill); anything else is dropped. */
const BUTTON_ICONS: Record<string, string> = {
  chat: 'chat', play: 'play', video: 'video', calendar: 'calendar', download: 'download',
  search: 'search', star: 'star', link: 'link', users: 'users', heart: 'heart', email: 'email',
  'circle-right': 'arrow-right', caret: 'chevron-right', 'arrow-right': 'arrow-right',
};

export function buttonSettingsFor(settings: Record<string, unknown>, action: { type: string; value: string }, newTab: boolean): Record<string, unknown> {
  const styles = settings['styles'] as Record<string, unknown> | undefined;
  const out: Record<string, unknown> = { action, variant: 'primary', size: 'lg', newTab };
  const icon = ((settings['button'] as Record<string, unknown> | undefined)?.['icon'] as Record<string, unknown> | undefined);
  const glyph = (icon?.['illustration'] as Record<string, unknown> | undefined)?.['icon'];
  if (icon?.['show'] === true && typeof glyph === 'string' && BUTTON_ICONS[glyph]) {
    out[icon['alignment'] === 'left' ? 'icon' : 'iconRight'] = BUTTON_ICONS[glyph];
  }
  if ((styles?.['width'] as Record<string, unknown> | undefined)?.['type'] === 'full') out['fullWidthMobile'] = true;
  return out;
}

/** The most common explicit button colour pair on the hub, which is what legacy members see as "the" button. */
export function dominantButtonColour(sections: Array<{ type: string; settings: unknown }>): { background: string; text: string } | null {
  const counts = new Map<string, { background: string; text: string; n: number }>();
  for (const section of sections) {
    if (section.type !== 'button') continue;
    const colours = ((parseJsonObject(section.settings)['styles'] as Record<string, unknown> | undefined)?.['theme'] as Record<string, unknown> | undefined)?.['colors'] as Record<string, unknown> | undefined;
    const background = colours?.['background'];
    const text = colours?.['text'];
    if (typeof background !== 'string' || !HEX6.test(background) || typeof text !== 'string' || !HEX6.test(text)) continue;
    const key = `${background}/${text}`;
    const entry = counts.get(key) ?? { background, text, n: 0 };
    entry.n += 1;
    counts.set(key, entry);
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  return best && best.n >= 3 ? { background: best.background, text: best.text } : null;
}

/** Deep-copies a vendored recipe, minting an id for every node with the caller's id function. */
export function instantiateRecipe(recipe: CatalogNode, mintId: (ordinal: number) => string): CatalogNode {
  let ordinal = 0;
  const walk = (node: CatalogNode): CatalogNode => {
    const copy: CatalogNode = { ...node, id: mintId(ordinal++) };
    if (node.settings) copy.settings = { ...node.settings };
    if (node.dataSource) copy.dataSource = { ...node.dataSource };
    if (node.children) copy.children = node.children.map(walk);
    return copy;
  };
  return walk(recipe);
}
