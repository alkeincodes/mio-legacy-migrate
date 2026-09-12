import type { Border, ButtonChrome, Corners, HubStyleProfile, ImageChrome, Shadow } from './types.js';

type Obj = Record<string, unknown>;

/** A legacy px value: a number, a numeric string, or nothing. */
export function px(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseInt(value, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function obj(value: unknown): Obj | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : undefined;
}

/** appearance.js:54-65 reads four corners, each with its own default. */
function cornersFrom(styles: Obj | undefined, fallback: number): Corners | null {
  const radius = obj(styles?.['cornerRadius']);
  if (radius?.['show'] !== true) return null;
  return [px(radius['topLeft'], fallback), px(radius['topRight'], fallback), px(radius['bottomRight'], fallback), px(radius['bottomLeft'], fallback)];
}

/** appearance.js:66-70. */
function borderFrom(styles: Obj | undefined): Border | null {
  const border = obj(styles?.['border']);
  if (border?.['show'] !== true) return null;
  return {
    width: px(border['width'], 1),
    colour: typeof border['color'] === 'string' ? border['color'] : '#000000',
    style: typeof border['type'] === 'string' ? border['type'] : 'solid',
  };
}

/** appearance.js:86, class drop-shadow-{size}. */
function shadowFrom(styles: Obj | undefined): Shadow | null {
  const shadow = obj(styles?.['dropShadow']);
  if (shadow?.['show'] !== true) return null;
  const size = shadow['size'];
  return size === 'medium' || size === 'large' ? size : 'small';
}

/**
 * The chrome one `styles` block resolves to on top of the .btn base
 * (_buttons.scss:1-15: 13px 30px, 16px bold, radius 40). Used for both
 * theme.settings.appearance.buttons and an element's own styles.
 */
export function buttonChromeFrom(styles: Obj | undefined): ButtonChrome {
  const size = obj(styles?.['size']);
  const large = size?.['show'] === true && size['type'] === 'large';
  return {
    paddingY: large ? 21 : 13,
    paddingX: large ? 63 : 30,
    radius: cornersFrom(styles, 40) ?? [40, 40, 40, 40],
    border: borderFrom(styles),
    shadow: shadowFrom(styles),
    fontSize: 16,
    fontWeight: 700,
  };
}

/** Image corners default to 0 (no default-* props on the editor's Image appearance panel). */
export function imageChromeFrom(styles: Obj | undefined): ImageChrome {
  return { radius: cornersFrom(styles, 0) ?? [0, 0, 0, 0], border: borderFrom(styles), shadow: shadowFrom(styles) };
}

export const DEFAULT_HUB_PROFILE: HubStyleProfile = {
  headingFontSize: 32,
  bodyFontSize: 16,
  button: buttonChromeFrom(undefined),
  thumbnail: imageChromeFrom(undefined),
  colours: {},
};

/** Read once per map from hub_theme.settings (App.vue:159-164 for the sizes). */
export function hubStyleProfile(themeSettings: Obj): HubStyleProfile {
  const fonts = obj(themeSettings['fonts']);
  const appearance = obj(themeSettings['appearance']);
  const colours = obj(themeSettings['colors']) ?? {};
  const profile: HubStyleProfile = {
    headingFontSize: px(fonts?.['headingFontSize'], 32),
    bodyFontSize: px(fonts?.['bodyFontSize'], 16),
    button: buttonChromeFrom(obj(appearance?.['buttons'])),
    thumbnail: imageChromeFrom(obj(appearance?.['thumbnails'])),
    colours: {},
  };
  if (typeof colours['primary'] === 'string') profile.colours.primary = colours['primary'];
  if (typeof colours['secondary'] === 'string') profile.colours.secondary = colours['secondary'];
  return profile;
}
