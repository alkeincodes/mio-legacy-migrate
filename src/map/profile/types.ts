/**
 * What the legacy hub renderer paints, in px and CSS terms, with no reference to
 * V3. The translate layer reads these and nothing else. Sources are searchie
 * resources/modules/hub/js/Components/Section/Row/* and utils/appearance.js.
 */

/** top-left, top-right, bottom-right, bottom-left, in px. */
export type Corners = [number, number, number, number];

export interface Border { width: number; colour: string; style: string }
export type Shadow = 'small' | 'medium' | 'large';

/** The resolved chrome of one button: base .btn plus the theme or element overrides. */
export interface ButtonChrome {
  paddingY: number;
  paddingX: number;
  radius: Corners;
  border: Border | null;
  shadow: Shadow | null;
  fontSize: number;
  fontWeight: number;
}

export interface ImageChrome {
  radius: Corners;
  border: Border | null;
  shadow: Shadow | null;
}

export interface HubStyleProfile {
  headingFontSize: number;
  bodyFontSize: number;
  button: ButtonChrome;
  thumbnail: ImageChrome;
  colours: { primary?: string; secondary?: string };
}

export interface Box { top: number; right: number; bottom: number; left: number }

/** A section's text colour when its background is an image, custom colour or gradient. */
export type Ink = 'light' | 'dark' | { hex: string } | null;

export interface SectionProfile {
  padding: Box;
  ink: Ink;
  /** The legacy gutter between columns, from the SCSS. */
  gutter: 20;
  /** Opacity of the tint legacy paints over an image background (its :before layer). */
  imageOverlayOpacity: number;
}

export type Justify = 'start' | 'center' | 'end';

export interface ColumnProfile {
  widthPct: number;
  justify: Justify;
  padding: Box | null;
  radius: Corners | null;
  shadow: Shadow | null;
  /** As on the section; the column background mirrors the section's variant classes. */
  imageOverlayOpacity: number;
}

export type Align = 'left' | 'center' | 'right';

interface ElementProfileBase {
  align: Align;
  /** Inline margin-top the legacy wrapper carries, px. */
  marginTop: number;
  /** The bottom margin the element's own tag carries, px, for margin collapse. */
  bottomMargin: number;
}

export interface HeadlineProfile extends ElementProfileBase { kind: 'headline'; level: 2 | 3 | 4; fontSize: number }
export interface TextProfile extends ElementProfileBase { kind: 'text' }
export interface ImageProfile extends ElementProfileBase {
  kind: 'image';
  /** width.type custom: the max-width in px. Otherwise null. */
  maxWidth: number | null;
  /** width.type full. */
  fill: boolean;
  chrome: ImageChrome;
  transparent: boolean;
}
export interface ButtonProfile extends ElementProfileBase {
  kind: 'button';
  chrome: ButtonChrome;
  fullWidth: boolean;
  colours: { background: string; text: string } | null;
}
/** video, icon, divider, embed, input: placed, never styled by this layer. */
export interface OtherProfile extends ElementProfileBase { kind: 'other' }

export type ElementProfile = HeadlineProfile | TextProfile | ImageProfile | ButtonProfile | OtherProfile;
