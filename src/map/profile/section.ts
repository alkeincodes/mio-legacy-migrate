import { px } from './hub.js';
import type { Box, ColumnProfile, Corners, Ink, Justify, SectionProfile, Shadow } from './types.js';

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : undefined;
}

const SECTION_BASE: Box = { top: 50, right: 0, bottom: 50, left: 0 };

/** appearance.js:34-53: inline px per side when padding.show, each side with its own default. */
function paddingFrom(styles: Obj | undefined, defaults: Box): Box | null {
  const padding = obj(styles?.['padding']);
  if (padding?.['show'] !== true) return null;
  return {
    top: px(padding['top'], defaults.top),
    right: px(padding['right'], defaults.right),
    bottom: px(padding['bottom'], defaults.bottom),
    left: px(padding['left'], defaults.left),
  };
}

function cornersFrom(styles: Obj | undefined): Corners | null {
  const radius = obj(styles?.['cornerRadius']);
  if (radius?.['show'] !== true) return null;
  return [px(radius['topLeft'], 0), px(radius['topRight'], 0), px(radius['bottomRight'], 0), px(radius['bottomLeft'], 0)];
}

function shadowFrom(styles: Obj | undefined): Shadow | null {
  const shadow = obj(styles?.['dropShadow']);
  if (shadow?.['show'] !== true) return null;
  return shadow['size'] === 'medium' || shadow['size'] === 'large' ? shadow['size'] : 'small';
}

/**
 * Row.vue:97,125-127: the text-variant class and the inline colour exist only over
 * an image, custom colour or gradient. textTheme defaults to light; custom falls
 * back to the theme secondary.
 */
function inkFrom(settings: Obj, themeSecondary: string | undefined): Ink {
  const type = obj(settings['background'])?.['type'];
  if (type !== 'image' && type !== 'custom-color' && type !== 'gradient' && type !== 'thumbnail') return null;
  const theme = settings['textTheme'];
  if (theme === 'dark') return 'dark';
  if (theme === 'custom') {
    const hex = typeof settings['textThemeColor'] === 'string' ? settings['textThemeColor'] : themeSecondary;
    return hex ? { hex } : 'dark';
  }
  return 'light';
}

/** Section (level 1): sections/_columns.scss base 50px 0, Row.vue:103-113 override. */
export function sectionProfile(settings: Obj, themeSecondary?: string): SectionProfile {
  return {
    padding: paddingFrom(obj(settings['styles']), SECTION_BASE) ?? { ...SECTION_BASE },
    ink: inkFrom(settings, themeSecondary),
    gutter: 20,
  };
}

/** Column (level 2): Column.vue:58-67 and :86-101. */
export function columnProfile(settings: Obj, siblingCount: number): ColumnProfile {
  const styles = obj(settings['styles']);
  const align = styles?.['align'];
  const justify: Justify = align === 'center' ? 'center' : align === 'bottom' ? 'end' : 'start';
  const size = Number(settings['size']);
  return {
    widthPct: Number.isFinite(size) && size > 0 ? size : 100 / Math.max(1, siblingCount),
    justify,
    padding: paddingFrom(styles, { top: 0, right: 0, bottom: 0, left: 0 }),
    radius: cornersFrom(styles),
    shadow: shadowFrom(styles),
  };
}
