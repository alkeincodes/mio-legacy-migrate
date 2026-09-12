/**
 * The style vocabulary shared by the profile and translate layers: backgrounds,
 * stack widths, button glyphs, the hub's dominant button colour and recipe
 * instantiation. Section, column and element styling live in ./profile and
 * ./translate.
 */
import type { CatalogNode } from './catalog.js';
import { parseJsonObject } from '../extract/json.js';

export type Surface = Record<string, unknown>;

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** Legacy `background` to `surface.background`; null when it is the page default. */
export interface ThemeColours { primary?: string; secondary?: string }

export function surfaceBackgroundFor(background: Record<string, unknown> | undefined, theme: ThemeColours = {}): Record<string, unknown> | null {
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
    // Legacy paints its own theme colour; V3's `secondary` token is the page ink,
    // not that colour, so the hex is carried when the theme is known.
    case 'secondary-color':
      return theme.secondary && HEX6.test(theme.secondary) ? { type: 'custom-color', value: theme.secondary } : { type: 'color', token: 'secondary' };
    case 'primary-color':
      return theme.primary && HEX6.test(theme.primary) ? { type: 'custom-color', value: theme.primary } : { type: 'color', token: 'primary' };
    case 'thumbnail':
      return null;
    default:
      return null;
  }
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

/**
 * Legacy button glyphs to hub sprite ids (mio-hub public/icons/sprite.svg). The
 * first block is the same glyph; the second is the nearest the sprite has,
 * because the legacy set (target, trophy, rocket, handshake...) is larger.
 * Anything not listed is dropped.
 */
export const BUTTON_ICONS: Record<string, string> = {
  chat: 'chat', play: 'play', video: 'video', 'video-camera': 'video-camera', calendar: 'calendar', download: 'download',
  search: 'search', star: 'star', link: 'link', users: 'users', heart: 'heart', email: 'email',
  'arrow-right': 'arrow-right', 'circle-right': 'circle-arrow-right',
  caret: 'chevron-right', target: 'star-circle', book: 'content', 'user-2': 'users', friend: 'user-plus',
  rocket: 'arrow-right-up', trophy: 'star', note: 'write', 'check-mark': 'tick', boxing: 'activity',
  handshake: 'users-multiple', script: 'file-text', 'easter-1': 'star',
};

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
