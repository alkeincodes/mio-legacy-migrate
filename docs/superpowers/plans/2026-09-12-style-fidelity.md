# Style fidelity implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a migrated legacy page render with the legacy page's padding, vertical placement, text alignment, heading sizes and element gaps, and record every value V3 cannot draw as a `fidelity` warning with the legacy and V3 values side by side.

**Architecture:** Two pure layers between the legacy JSON and the catalog nodes. `src/map/profile/` reads legacy `settings` and the hub theme and produces px-and-CSS facts about what the legacy renderer paints. `src/map/translate/` turns a profile into V3 node settings, snapping to V3's enums and emitting a `FidelityEntry` whenever it had to. `sections.ts` and `elements.ts` call profile then translate; `style.ts` keeps only what is not styling.

**Tech Stack:** TypeScript 5 strict, `noUncheckedIndexedAccess`, Node 24.15.0 via nvm, vitest.

**Spec:** `docs/superpowers/specs/2026-09-12-style-fidelity-design.md`. Read it first; every rule below argues from it.

## Global constraints

- `nvm use` before any `npm`, `vitest` or `tsx` command. Every run line below assumes it.
- Run everything from `/Users/alkein/Developments/mio-projects/mio-legacy-migrate`.
- No `any`. `noUncheckedIndexedAccess` is on, so `arr[0]` is `T | undefined`.
- Conventional commit messages. **No `Co-Authored-By` trailer of any kind.**
- No change to mio-hub, the catalog, mio-backend or searchie.
- Do not run `apply` for real. `map` and `apply --dry-run` only. The real resume is the user's call (Task 11 stops before it).
- `PLAN_VERSION` stays 1. The spec says it bumps; it does not need to, because the only plan change is additive optional fields on `PlanWarning`, and bumping would stop `apply --resume` from reading the plan the live run was made from.
- Numbers below 4px of difference are not fidelity entries (spec 5.6). Image caps use 16px (spec 5.4).

## File structure

```
src/map/profile/
  types.ts        every profile interface; the seam both layers depend on
  hub.ts          hubStyleProfile(themeSettings), buttonChromeFrom, imageChromeFrom, DEFAULT_HUB_PROFILE
  section.ts      sectionProfile(settings, theme), columnProfile(settings, siblingCount), px()
  element.ts      elementProfile(section, hub)
  rhythm.ts       visibleGaps(profiles), commonGap(gaps)
src/map/translate/
  fidelity.ts     FidelityEntry, fidelityWarning, collapseFidelity, snapPx, stackGapSetting, thresholds
  surface.ts      paddingShorthand, inkFor, sectionSurface, columnSurface, LAYOUT_ROW_SETTINGS
  leaf.ts         headlineSettings, textSettings, imageSettings, buttonSettings
  stack.ts        columnStack: run wrappers, rhythm wrappers, the stack node
src/map/style.ts  keeps BUTTON_ICONS, surfaceBackgroundFor, stackWidthFor, dominantButtonColour, instantiateRecipe
src/map/sections.ts, elements.ts, pages.ts, plan.ts, branding.ts, src/cli/map.ts   wired through
tests/map/profile-*.test.ts, tests/map/translate-*.test.ts, tests/fixtures/sections/hero-row.json
```

---

### Task 1: Profile types and the hub profile

**Files:**
- Create: `src/map/profile/types.ts`
- Create: `src/map/profile/hub.ts`
- Test: `tests/map/profile-hub.test.ts`

**Interfaces:**
- Produces: every type in `types.ts` below; `hubStyleProfile(themeSettings: Record<string, unknown>): HubStyleProfile`; `buttonChromeFrom(styles: Record<string, unknown> | undefined): ButtonChrome`; `imageChromeFrom(styles: Record<string, unknown> | undefined): ImageChrome`; `DEFAULT_HUB_PROFILE: HubStyleProfile`.

- [x] **Step 1: Write the types**

`src/map/profile/types.ts`:

```ts
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
}

export type Justify = 'start' | 'center' | 'end';

export interface ColumnProfile {
  widthPct: number;
  justify: Justify;
  padding: Box | null;
  radius: Corners | null;
  shadow: Shadow | null;
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
```

- [x] **Step 2: Write the failing hub profile test**

`tests/map/profile-hub.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_HUB_PROFILE, buttonChromeFrom, hubStyleProfile, imageChromeFrom } from '../../src/map/profile/hub.js';

describe('hubStyleProfile', () => {
  it('reads the ManTalks theme: square shadowed buttons, 30px thumbnails, default font sizes', () => {
    const profile = hubStyleProfile({
      fonts: { body: 'Mulish', heading: 'Mulish' },
      colors: { primary: '#F7F2E8', secondary: '#333333' },
      appearance: {
        buttons: { dropShadow: { show: true, size: 'large' }, cornerRadius: { show: true, topLeft: '0', topRight: '0', bottomLeft: '0', bottomRight: '0' } },
        thumbnails: { cornerRadius: { show: true, topLeft: '30', topRight: '30', bottomLeft: '30', bottomRight: '30' } },
      },
    });
    expect(profile.headingFontSize).toBe(32);
    expect(profile.bodyFontSize).toBe(16);
    expect(profile.button).toEqual({ paddingY: 13, paddingX: 30, radius: [0, 0, 0, 0], border: null, shadow: 'large', fontSize: 16, fontWeight: 700 });
    expect(profile.thumbnail).toEqual({ radius: [30, 30, 30, 30], border: null, shadow: null });
    expect(profile.colours).toEqual({ primary: '#F7F2E8', secondary: '#333333' });
  });

  it('carries the legacy font sizes when the theme sets them', () => {
    const profile = hubStyleProfile({ fonts: { headingFontSize: 40, bodyFontSize: '18' } });
    expect(profile.headingFontSize).toBe(40);
    expect(profile.bodyFontSize).toBe(18);
  });

  it('defaults to the SCSS base: 40px pill, 13px 30px, no shadow', () => {
    expect(hubStyleProfile({}).button).toEqual(DEFAULT_HUB_PROFILE.button);
    expect(DEFAULT_HUB_PROFILE.button).toEqual({ paddingY: 13, paddingX: 30, radius: [40, 40, 40, 40], border: null, shadow: null, fontSize: 16, fontWeight: 700 });
    expect(DEFAULT_HUB_PROFILE.thumbnail).toEqual({ radius: [0, 0, 0, 0], border: null, shadow: null });
  });
});

describe('buttonChromeFrom', () => {
  it('applies the large size preset only when size.show is on', () => {
    expect(buttonChromeFrom({ size: { show: true, type: 'large' } })).toMatchObject({ paddingY: 21, paddingX: 63 });
    expect(buttonChromeFrom({ size: { show: false, type: 'large' } })).toMatchObject({ paddingY: 13, paddingX: 30 });
  });

  it('reads per-corner radius with 40 as the missing-corner default, border and shadow', () => {
    expect(buttonChromeFrom({ cornerRadius: { show: true, topLeft: 8 }, border: { show: true, width: 2, color: '#ff0000', type: 'dashed' }, dropShadow: { show: true } }))
      .toEqual({ paddingY: 13, paddingX: 30, radius: [8, 40, 40, 40], border: { width: 2, colour: '#ff0000', style: 'dashed' }, shadow: 'small', fontSize: 16, fontWeight: 700 });
  });

  it('ignores a radius block whose show is off', () => {
    expect(buttonChromeFrom({ cornerRadius: { show: false, topLeft: 0 } }).radius).toEqual([40, 40, 40, 40]);
  });
});

describe('imageChromeFrom', () => {
  it('defaults every corner to 0 and reads border and shadow', () => {
    expect(imageChromeFrom({ cornerRadius: { show: true, topLeft: '12', bottomRight: '12' } }).radius).toEqual([12, 0, 12, 0]);
    expect(imageChromeFrom({ border: { show: true } }).border).toEqual({ width: 1, colour: '#000000', style: 'solid' });
    expect(imageChromeFrom(undefined)).toEqual({ radius: [0, 0, 0, 0], border: null, shadow: null });
  });
});
```

- [x] **Step 3: Run it to see it fail**

Run: `nvm use && npx vitest run tests/map/profile-hub.test.ts`
Expected: FAIL, cannot find module `../../src/map/profile/hub.js`.

- [x] **Step 4: Implement `hub.ts`**

`src/map/profile/hub.ts`:

```ts
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
```

- [x] **Step 5: Run the test**

Run: `nvm use && npx vitest run tests/map/profile-hub.test.ts`
Expected: PASS, 7 tests.

- [x] **Step 6: Commit**

```bash
git add src/map/profile/types.ts src/map/profile/hub.ts tests/map/profile-hub.test.ts
git commit -m "feat(profile): style profile types and the hub theme profile"
```

---

### Task 2: Section and column profiles

**Files:**
- Create: `src/map/profile/section.ts`
- Test: `tests/map/profile-section.test.ts`

**Interfaces:**
- Consumes: `px` from `./hub.js`; `Box`, `Corners`, `ColumnProfile`, `Ink`, `SectionProfile`, `Shadow` from `./types.js`.
- Produces: `sectionProfile(settings: Record<string, unknown>, themeSecondary?: string): SectionProfile`; `columnProfile(settings: Record<string, unknown>, siblingCount: number): ColumnProfile`.

- [x] **Step 1: Write the failing test**

`tests/map/profile-section.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { columnProfile, sectionProfile } from '../../src/map/profile/section.js';

describe('sectionProfile', () => {
  it('reads explicit padding per side, with 50/0/50/0 for a missing side', () => {
    expect(sectionProfile({ styles: { padding: { show: true, top: '150', bottom: '150' } } }).padding).toEqual({ top: 150, right: 0, bottom: 150, left: 0 });
    expect(sectionProfile({ styles: { padding: { show: true, top: 0, right: '12' } } }).padding).toEqual({ top: 0, right: 12, bottom: 50, left: 0 });
  });

  it('uses the SCSS base when padding.show is off or absent', () => {
    expect(sectionProfile({ styles: { padding: { show: false, top: 150, bottom: 150 } } }).padding).toEqual({ top: 50, right: 0, bottom: 50, left: 0 });
    expect(sectionProfile({}).padding).toEqual({ top: 50, right: 0, bottom: 50, left: 0 });
  });

  it('carries ink only over an image, custom-color or gradient background', () => {
    expect(sectionProfile({ background: { type: 'image' }, textTheme: 'light' }).ink).toBe('light');
    expect(sectionProfile({ background: { type: 'custom-color' }, textTheme: 'dark' }).ink).toBe('dark');
    expect(sectionProfile({ background: { type: 'gradient' }, textTheme: 'custom', textThemeColor: '#F7F2E8' }).ink).toEqual({ hex: '#F7F2E8' });
    expect(sectionProfile({ background: { type: 'image' }, textTheme: 'custom' }, '#333333').ink).toEqual({ hex: '#333333' });
    expect(sectionProfile({ background: { type: 'default' }, textTheme: 'dark' }).ink).toBeNull();
    expect(sectionProfile({ background: { type: 'image' } }).ink).toBe('light');
  });
});

describe('columnProfile', () => {
  it('turns styles.align into a vertical justify, default top', () => {
    expect(columnProfile({ styles: { align: 'center' } }, 2).justify).toBe('center');
    expect(columnProfile({ styles: { align: 'bottom' } }, 2).justify).toBe('end');
    expect(columnProfile({ styles: { align: 'top' } }, 2).justify).toBe('start');
    expect(columnProfile({}, 2).justify).toBe('start');
  });

  it('reads the width percentage, or splits the row evenly', () => {
    expect(columnProfile({ size: 50 }, 2).widthPct).toBe(50);
    expect(columnProfile({ size: '33.333333' }, 3).widthPct).toBeCloseTo(33.33, 1);
    expect(columnProfile({}, 4).widthPct).toBe(25);
  });

  it('reads the column decoration only when each block is shown', () => {
    const p = columnProfile({ styles: { padding: { show: true, top: 20, bottom: 20 }, cornerRadius: { show: true, topLeft: 12, topRight: 12, bottomRight: 12, bottomLeft: 12 }, dropShadow: { show: true, size: 'large' } } }, 1);
    expect(p.padding).toEqual({ top: 20, right: 0, bottom: 20, left: 0 });
    expect(p.radius).toEqual([12, 12, 12, 12]);
    expect(p.shadow).toBe('large');
    expect(columnProfile({ styles: { padding: { show: false, top: 20 } } }, 1)).toMatchObject({ padding: null, radius: null, shadow: null });
  });
});
```

- [x] **Step 2: Run it to see it fail**

Run: `nvm use && npx vitest run tests/map/profile-section.test.ts`
Expected: FAIL, module not found.

- [x] **Step 3: Implement `section.ts`**

`src/map/profile/section.ts`:

```ts
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
```

- [x] **Step 4: Run the test**

Run: `nvm use && npx vitest run tests/map/profile-section.test.ts`
Expected: PASS, 6 tests.

- [x] **Step 5: Commit**

```bash
git add src/map/profile/section.ts tests/map/profile-section.test.ts
git commit -m "feat(profile): section padding and ink, column justify and decoration"
```

---

### Task 3: Element profiles and rhythm

**Files:**
- Create: `src/map/profile/element.ts`
- Create: `src/map/profile/rhythm.ts`
- Test: `tests/map/profile-element.test.ts`

**Interfaces:**
- Consumes: `LegacySection` from `../../extract/queries.js`; `parseJsonObject` from `../../extract/json.js`; `buttonChromeFrom`, `imageChromeFrom`, `px` from `./hub.js`; types.
- Produces: `elementProfile(section: LegacySection, hub: HubStyleProfile): ElementProfile`; `visibleGaps(profiles: ElementProfile[]): number[]`; `commonGap(gaps: number[]): number`.

- [x] **Step 1: Write the failing test**

`tests/map/profile-element.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { LegacySection } from '../../src/extract/queries.js';
import { elementProfile } from '../../src/map/profile/element.js';
import { DEFAULT_HUB_PROFILE, hubStyleProfile } from '../../src/map/profile/hub.js';
import { commonGap, visibleGaps } from '../../src/map/profile/rhythm.js';

function el(type: string, settings: Record<string, unknown>, label: string | null = null): LegacySection {
  return { id: 1, hub_id: 7, page_id: null, parent_id: 2, model_type: null, model_id: null, hidden: 0, type, title: null, label, settings: JSON.stringify(settings), permissions: null, meta: null, position: 0, segment_id: null };
}

describe('elementProfile', () => {
  it('headline: large is h2 at the heading size, medium h3 at 0.75, small h4 at 18', () => {
    expect(elementProfile(el('headline', { size: 'large' }), DEFAULT_HUB_PROFILE)).toEqual({ kind: 'headline', level: 2, fontSize: 32, align: 'left', marginTop: 30, bottomMargin: 20 });
    expect(elementProfile(el('headline', { size: 'medium' }), hubStyleProfile({ fonts: { headingFontSize: 40 } }))).toMatchObject({ level: 3, fontSize: 30 });
    expect(elementProfile(el('headline', { size: 'small' }), DEFAULT_HUB_PROFILE)).toMatchObject({ level: 4, fontSize: 18, bottomMargin: 10 });
    expect(elementProfile(el('headline', {}, 'Subheadline - Copy'), DEFAULT_HUB_PROFILE)).toMatchObject({ level: 3 });
  });

  it('reads align and margins.top, with left and 30 as the legacy defaults', () => {
    expect(elementProfile(el('text', { align: 'center', margins: { top: 0 } }), DEFAULT_HUB_PROFILE)).toEqual({ kind: 'text', align: 'center', marginTop: 0, bottomMargin: 20 });
    expect(elementProfile(el('text', {}), DEFAULT_HUB_PROFILE)).toMatchObject({ align: 'left', marginTop: 30 });
  });

  it('image: width types, transparent flag, chrome from the element when it overwrites, else the hub', () => {
    const hub = hubStyleProfile({ appearance: { thumbnails: { cornerRadius: { show: true, topLeft: 30, topRight: 30, bottomRight: 30, bottomLeft: 30 } } } });
    expect(elementProfile(el('image', { align: 'center', styles: { width: { type: 'custom', value: 250 } }, thumbnail: { is_thumbnail_transparent: true } }), hub))
      .toEqual({ kind: 'image', align: 'center', marginTop: 30, bottomMargin: 0, maxWidth: 250, fill: false, chrome: { radius: [30, 30, 30, 30], border: null, shadow: null }, transparent: true });
    expect(elementProfile(el('image', { styles: { width: { type: 'custom' } } }), hub)).toMatchObject({ maxWidth: 400 });
    expect(elementProfile(el('image', { styles: { width: { type: 'full' } } }), hub)).toMatchObject({ maxWidth: null, fill: true });
    expect(elementProfile(el('image', { appearance: { overwrite: true }, styles: { cornerRadius: { show: true } } }), hub)).toMatchObject({ chrome: { radius: [0, 0, 0, 0] } });
  });

  it('button: chrome from the hub unless it overwrites, full width, own colours', () => {
    const hub = hubStyleProfile({ appearance: { buttons: { cornerRadius: { show: true, topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }, dropShadow: { show: true, size: 'large' } } } });
    expect(elementProfile(el('button', { styles: { theme: { show: true, colors: { background: '#5770D1', text: '#F7F2E8' } } } }), hub))
      .toEqual({ kind: 'button', align: 'left', marginTop: 30, bottomMargin: 0, chrome: hub.button, fullWidth: false, colours: { background: '#5770D1', text: '#F7F2E8' } });
    expect(elementProfile(el('button', { appearance: { overwrite: true }, styles: { size: { show: true, type: 'large' } } }), hub)).toMatchObject({ chrome: { paddingX: 63, radius: [40, 40, 40, 40], shadow: null } });
    expect(elementProfile(el('button', { styles: { width: { type: 'full' } } }), hub)).toMatchObject({ fullWidth: true });
    expect(elementProfile(el('button', { fullSize: true }), hub)).toMatchObject({ fullWidth: true });
    expect(elementProfile(el('button', { styles: { theme: { show: false, colors: { background: '#5770D1', text: '#F7F2E8' } } } }), hub)).toMatchObject({ colours: null });
  });

  it('everything else is placed but not styled', () => {
    expect(elementProfile(el('video', { margins: { top: 50 } }), DEFAULT_HUB_PROFILE)).toEqual({ kind: 'other', align: 'left', marginTop: 50, bottomMargin: 0 });
  });
});

describe('rhythm', () => {
  it('reproduces the hero: gaps 0, 20, 20, 30 after margin collapse', () => {
    const hub = DEFAULT_HUB_PROFILE;
    const profiles = [
      elementProfile(el('headline', { size: 'large', margins: { top: 0 } }), hub),
      elementProfile(el('text', { margins: { top: 0 } }), hub),
      elementProfile(el('button', { margins: { top: 0 } }), hub),
      elementProfile(el('button', { margins: { top: 30 } }), hub),
    ];
    expect(visibleGaps(profiles)).toEqual([0, 20, 20, 30]);
    expect(commonGap(visibleGaps(profiles))).toBe(20);
  });

  it('the first element keeps its own margin-top; a lone element has no common gap', () => {
    const one = [elementProfile(el('text', { margins: { top: 30 } }), DEFAULT_HUB_PROFILE)];
    expect(visibleGaps(one)).toEqual([30]);
    expect(commonGap(visibleGaps(one))).toBe(0);
    expect(visibleGaps([])).toEqual([]);
  });

  it('breaks a tie towards the smaller gap', () => {
    expect(commonGap([0, 20, 30])).toBe(20);
  });
});
```

- [x] **Step 2: Run it to see it fail**

Run: `nvm use && npx vitest run tests/map/profile-element.test.ts`
Expected: FAIL, module not found.

- [x] **Step 3: Implement `element.ts` and `rhythm.ts`**

`src/map/profile/element.ts`:

```ts
import type { LegacySection } from '../../extract/queries.js';
import { parseJsonObject } from '../../extract/json.js';
import { buttonChromeFrom, imageChromeFrom, px } from './hub.js';
import type { Align, ElementProfile, HubStyleProfile } from './types.js';

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : undefined;
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/**
 * Item.vue:56-79: every element wrapper carries inline margin-top (default 30)
 * and an align-{left|center|right} class (default left). Bottom margins come
 * from the tag (_typography.scss): h2/h3/p 20, h4 10, image and button 0.
 */
export function elementProfile(section: LegacySection, hub: HubStyleProfile): ElementProfile {
  const settings = parseJsonObject(section.settings);
  const styles = obj(settings['styles']);
  const rawAlign = settings['align'];
  const align: Align = rawAlign === 'center' || rawAlign === 'right' ? rawAlign : 'left';
  const marginTop = px(obj(settings['margins'])?.['top'], 30);
  const overwrite = obj(settings['appearance'])?.['overwrite'] === true;

  switch (section.type) {
    case 'headline': {
      // Create.vue:239-245 writes large for Headline and medium for Subheadline; the
      // label is the only trace when size is missing.
      const size = settings['size'] ?? (/^subheadline/i.test(section.label ?? '') ? 'medium' : 'large');
      const level = size === 'medium' ? 3 : size === 'small' ? 4 : 2;
      const fontSize = level === 2 ? hub.headingFontSize : level === 3 ? hub.headingFontSize * 0.75 : 18;
      return { kind: 'headline', level, fontSize, align, marginTop, bottomMargin: level === 4 ? 10 : 20 };
    }
    case 'text':
      return { kind: 'text', align, marginTop, bottomMargin: 20 };
    case 'image': {
      const width = obj(styles?.['width']);
      const type = width?.['type'];
      return {
        kind: 'image',
        align,
        marginTop,
        bottomMargin: 0,
        maxWidth: type === 'custom' ? px(width?.['value'], 400) : null,
        fill: type === 'full',
        chrome: overwrite ? imageChromeFrom(styles) : hub.thumbnail,
        transparent: obj(settings['thumbnail'])?.['is_thumbnail_transparent'] === true,
      };
    }
    case 'button': {
      const theme = obj(styles?.['theme']);
      const colours = obj(theme?.['colors']);
      const background = colours?.['background'];
      const text = colours?.['text'];
      const own = theme?.['show'] === true && typeof background === 'string' && HEX6.test(background) && typeof text === 'string' && HEX6.test(text)
        ? { background, text }
        : null;
      return {
        kind: 'button',
        align,
        marginTop,
        bottomMargin: 0,
        chrome: overwrite ? buttonChromeFrom(styles) : hub.button,
        fullWidth: obj(styles?.['width'])?.['type'] === 'full' || (settings['fullSize'] === true && !styles?.['width']),
        colours: own,
      };
    }
    default:
      return { kind: 'other', align, marginTop, bottomMargin: 0 };
  }
}
```

`src/map/profile/rhythm.ts`:

```ts
import type { ElementProfile } from './types.js';

/**
 * The gap a member sees above each element: the first element's own margin-top,
 * then max(previous bottom margin, this margin-top), which is what the browser
 * shows after the two margins collapse (Item.vue:56-60, _typography.scss).
 */
export function visibleGaps(profiles: ElementProfile[]): number[] {
  return profiles.map((p, i) => {
    const prev = profiles[i - 1];
    return prev ? Math.max(prev.bottomMargin, p.marginTop) : p.marginTop;
  });
}

/** The gap that occurs most often between neighbours (index 1 onward); ties go to the smaller. */
export function commonGap(gaps: number[]): number {
  const counts = new Map<number, number>();
  for (const gap of gaps.slice(1)) counts.set(gap, (counts.get(gap) ?? 0) + 1);
  let best: { gap: number; n: number } | null = null;
  for (const [gap, n] of counts) {
    if (!best || n > best.n || (n === best.n && gap < best.gap)) best = { gap, n };
  }
  return best?.gap ?? 0;
}
```

- [x] **Step 4: Run the test**

Run: `nvm use && npx vitest run tests/map/profile-element.test.ts`
Expected: PASS, 8 tests.

- [x] **Step 5: Commit**

```bash
git add src/map/profile/element.ts src/map/profile/rhythm.ts tests/map/profile-element.test.ts
git commit -m "feat(profile): element profiles and the visible-gap rhythm"
```

---

### Task 4: Fidelity entries and the plan warning

**Files:**
- Modify: `src/map/plan.ts:8-13`
- Create: `src/map/translate/fidelity.ts`
- Test: `tests/map/translate-fidelity.test.ts`

**Interfaces:**
- Produces: `PlanWarning.type` gains `'fidelity'`; optional `property`, `legacy`, `v3`, `count` on `PlanWarning`. `FidelityEntry { property: string; legacy: string; v3: string; hubWide?: boolean }`; `fidelityWarning(entry, pageSlug: string | null, legacySectionId: number | null): PlanWarning`; `collapseFidelity(warnings: PlanWarning[]): PlanWarning[]`; `snapPx(value: number, allowed: readonly number[]): number`; `STACK_GAP_PX: readonly number[]`; `stackGapSetting(px: number): number`; `FIDELITY_THRESHOLD_PX = 4`.

- [x] **Step 1: Extend `PlanWarning`**

In `src/map/plan.ts` replace lines 8-13 with:

```ts
export interface PlanWarning {
  pageSlug: string | null;
  legacySectionId: number | null;
  type: 'approximated' | 'dropped' | 'access-unmapped' | 'asset-pending' | 'excluded' | 'fidelity';
  reason: string;
  /** fidelity only: the styling property, e.g. 'button.chrome', 'section.ink', 'image.maxWidth'. */
  property?: string;
  /** fidelity only: what legacy paints. */
  legacy?: string;
  /** fidelity only: what V3 will paint. */
  v3?: string;
  /** fidelity only: how many nodes share this entry after collapse. */
  count?: number;
}
```

Then check nothing switches exhaustively on the type:

Run: `grep -rn "'approximated'" src/apply src/verify src/cli | grep -v "type: 'approximated'"`
Expected: no `switch`/`case` lines. If a `case` list exists, add `'fidelity'` next to `'approximated'` there.

- [x] **Step 2: Write the failing test**

`tests/map/translate-fidelity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { STACK_GAP_PX, collapseFidelity, fidelityWarning, snapPx, stackGapSetting } from '../../src/map/translate/fidelity.js';

describe('fidelityWarning', () => {
  it('builds a plan warning with the structured fields and a readable reason', () => {
    expect(fidelityWarning({ property: 'image.maxWidth', legacy: '250px', v3: '352px' }, 'home', 42)).toEqual({
      pageSlug: 'home', legacySectionId: 42, type: 'fidelity', reason: 'image.maxWidth: 250px -> 352px', property: 'image.maxWidth', legacy: '250px', v3: '352px', count: 1,
    });
  });

  it('a hub-wide entry carries no page or section', () => {
    expect(fidelityWarning({ property: 'button.chrome', legacy: 'a', v3: 'b', hubWide: true }, 'home', 42)).toMatchObject({ pageSlug: null, legacySectionId: null, count: 1 });
  });
});

describe('collapseFidelity', () => {
  it('merges identical hub-wide entries into one with a count, leaves everything else alone', () => {
    const a = fidelityWarning({ property: 'button.chrome', legacy: 'a', v3: 'b', hubWide: true }, 'home', 1);
    const b = fidelityWarning({ property: 'button.chrome', legacy: 'a', v3: 'b', hubWide: true }, 'about', 2);
    const c = fidelityWarning({ property: 'image.maxWidth', legacy: '250px', v3: '352px' }, 'home', 3);
    const other = { pageSlug: 'home', legacySectionId: 4, type: 'approximated' as const, reason: 'x' };
    expect(collapseFidelity([a, other, b, c])).toEqual([{ ...a, count: 2 }, other, c]);
  });
});

describe('snapping', () => {
  it('snaps to the nearest allowed value, lower on a tie', () => {
    expect(snapPx(30, STACK_GAP_PX)).toBe(32);
    expect(snapPx(20, STACK_GAP_PX)).toBe(20);
    expect(snapPx(18, STACK_GAP_PX)).toBe(16);
    expect(snapPx(100, STACK_GAP_PX)).toBe(48);
  });

  it('turns a snapped px into the stack gap setting (4px units)', () => {
    expect(stackGapSetting(20)).toBe(5);
    expect(stackGapSetting(32)).toBe(8);
    expect(stackGapSetting(2)).toBe(0.5);
    expect(stackGapSetting(0)).toBe(0);
  });
});
```

- [x] **Step 3: Run it to see it fail**

Run: `nvm use && npx vitest run tests/map/translate-fidelity.test.ts`
Expected: FAIL, module not found.

- [x] **Step 4: Implement `fidelity.ts`**

`src/map/translate/fidelity.ts`:

```ts
import type { PlanWarning } from '../plan.js';

/** A legacy value V3 cannot draw exactly, with what it will draw instead. */
export interface FidelityEntry {
  property: string;
  legacy: string;
  v3: string;
  /** True for entries that describe the whole hub (button chrome); they carry no page or section. */
  hubWide?: boolean;
}

/** Differences of this many px or fewer are not worth an entry (spec 5.6). */
export const FIDELITY_THRESHOLD_PX = 4;

export function fidelityWarning(entry: FidelityEntry, pageSlug: string | null, legacySectionId: number | null): PlanWarning {
  return {
    pageSlug: entry.hubWide ? null : pageSlug,
    legacySectionId: entry.hubWide ? null : legacySectionId,
    type: 'fidelity',
    reason: `${entry.property}: ${entry.legacy} -> ${entry.v3}`,
    property: entry.property,
    legacy: entry.legacy,
    v3: entry.v3,
    count: 1,
  };
}

/** Hub-wide fidelity warnings with the same reason become one entry whose count is their number. */
export function collapseFidelity(warnings: PlanWarning[]): PlanWarning[] {
  const out: PlanWarning[] = [];
  const hubWide = new Map<string, PlanWarning>();
  for (const w of warnings) {
    if (w.type !== 'fidelity' || w.pageSlug !== null || w.legacySectionId !== null) { out.push(w); continue; }
    const existing = hubWide.get(w.reason);
    if (existing) existing.count = (existing.count ?? 1) + (w.count ?? 1);
    else { const copy = { ...w, count: w.count ?? 1 }; hubWide.set(w.reason, copy); out.push(copy); }
  }
  return out;
}

/** stack.tsx:160-178: gap enum 0 .. 12 in 4px units. */
export const STACK_GAP_PX: readonly number[] = [0, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 48];

export function snapPx(value: number, allowed: readonly number[]): number {
  let best = allowed[0] ?? 0;
  for (const candidate of allowed) {
    const d = Math.abs(candidate - value);
    const bestD = Math.abs(best - value);
    if (d < bestD || (d === bestD && candidate < best)) best = candidate;
  }
  return best;
}

/** A snapped px value to the setting V3 wants (px / 4). */
export function stackGapSetting(snapped: number): number {
  return snapped / 4;
}
```

- [x] **Step 5: Run the test and the typecheck**

Run: `nvm use && npx vitest run tests/map/translate-fidelity.test.ts && npm run typecheck`
Expected: PASS, 6 tests; typecheck clean.

- [x] **Step 6: Commit**

```bash
git add src/map/plan.ts src/map/translate/fidelity.ts tests/map/translate-fidelity.test.ts
git commit -m "feat(translate): fidelity entries as a plan warning type"
```

---

### Task 5: Surface translation

**Files:**
- Create: `src/map/translate/surface.ts`
- Test: `tests/map/translate-surface.test.ts`

**Interfaces:**
- Consumes: `surfaceBackgroundFor`, `ThemeColours`, `Surface` from `../style.js` (unchanged); `SectionProfile`, `ColumnProfile`, `Box`, `Corners`, `Ink` from `../profile/types.js`; `FidelityEntry` from `./fidelity.js`.
- Produces: `paddingShorthand(box: Box): string`; `cornersShorthand(c: Corners): string`; `luminance(hex: string): number`; `inkFor(ink: Ink): { value: 'light' | 'dark' | null; fidelity: FidelityEntry | null }`; `sectionSurface(profile, settings, hidden, theme): { surface: Surface; fidelity: FidelityEntry[] }`; `columnSurface(profile, settings, theme): Surface | null`; `LAYOUT_ROW_SETTINGS`.

- [x] **Step 1: Write the failing test**

`tests/map/translate-surface.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { columnProfile, sectionProfile } from '../../src/map/profile/section.js';
import { LAYOUT_ROW_SETTINGS, columnSurface, cornersShorthand, inkFor, luminance, paddingShorthand, sectionSurface } from '../../src/map/translate/surface.js';

describe('shorthands', () => {
  it('collapses a box the way CSS does', () => {
    expect(paddingShorthand({ top: 150, right: 0, bottom: 150, left: 0 })).toBe('150px 0');
    expect(paddingShorthand({ top: 50, right: 0, bottom: 50, left: 0 })).toBe('50px 0');
    expect(paddingShorthand({ top: 20, right: 20, bottom: 20, left: 20 })).toBe('20px');
    expect(paddingShorthand({ top: 10, right: 20, bottom: 30, left: 20 })).toBe('10px 20px 30px');
    expect(paddingShorthand({ top: 1, right: 2, bottom: 3, left: 4 })).toBe('1px 2px 3px 4px');
    expect(cornersShorthand([12, 12, 12, 12])).toBe('12px');
    expect(cornersShorthand([0, 12, 0, 12])).toBe('0 12px');
  });
});

describe('ink', () => {
  it('passes the poles through and picks a pole for a custom hex by luminance', () => {
    expect(inkFor('light')).toEqual({ value: 'light', fidelity: null });
    expect(inkFor('dark')).toEqual({ value: 'dark', fidelity: null });
    expect(inkFor(null)).toEqual({ value: null, fidelity: null });
    expect(luminance('#F7F2E8')).toBeGreaterThan(0.5);
    expect(luminance('#333333')).toBeLessThan(0.5);
    expect(inkFor({ hex: '#F7F2E8' })).toEqual({ value: 'light', fidelity: { property: 'section.ink', legacy: '#F7F2E8', v3: 'light' } });
    expect(inkFor({ hex: '#333333' }).value).toBe('dark');
  });
});

describe('sectionSurface', () => {
  const hero = { styles: { padding: { top: '150', show: true, bottom: '150' }, visibility: 'desktop' }, textTheme: 'custom', textThemeColor: '#F7F2E8', background: { type: 'image', image: { url: 'https://cdn/x.png' } } };

  it('carries exact padding, ink, background and visibility for the hero', () => {
    const { surface, fidelity } = sectionSurface(sectionProfile(hero), hero, false, {});
    expect(surface).toEqual({ padding: '150px 0', ink: 'light', background: { type: 'image', url: 'https://cdn/x.png', blur: false }, visibility: { desktop: true, mobile: false } });
    expect(fidelity).toEqual([{ property: 'section.ink', legacy: '#F7F2E8', v3: 'light' }]);
  });

  it('writes the legacy base padding and no ink for a plain section', () => {
    const { surface, fidelity } = sectionSurface(sectionProfile({}), {}, false, {});
    expect(surface).toEqual({ padding: '50px 0', background: { type: 'none' } });
    expect(fidelity).toEqual([]);
  });

  it('hides a hidden section on both devices', () => {
    expect(sectionSurface(sectionProfile({}), {}, true, {}).surface['visibility']).toEqual({ desktop: false, mobile: false });
  });
});

describe('columnSurface', () => {
  it('is null for an undecorated column and exact px for a decorated one', () => {
    expect(columnSurface(columnProfile({}, 2), {}, {})).toBeNull();
    const settings = { styles: { padding: { show: true, top: 20, bottom: 20, left: 10, right: 10 }, cornerRadius: { show: true, topLeft: 12, topRight: 12, bottomRight: 12, bottomLeft: 12 }, dropShadow: { show: true, size: 'large' } }, background: { type: 'custom-color', color: '#101820' } };
    expect(columnSurface(columnProfile(settings, 2), settings, {})).toEqual({ background: { type: 'custom-color', value: '#101820' }, padding: '20px 10px', borderRadius: '12px', shadow: 'lg' });
  });
});

describe('LAYOUT_ROW_SETTINGS', () => {
  it('is the legacy 20px gutter on a stretched, wrapping, responsive row', () => {
    expect(LAYOUT_ROW_SETTINGS).toEqual({ gap: 5, mobileGap: 6, align: 'stretch', wrap: true, responsive: true });
  });
});
```

- [x] **Step 2: Run it to see it fail**

Run: `nvm use && npx vitest run tests/map/translate-surface.test.ts`
Expected: FAIL, module not found.

- [x] **Step 3: Implement `surface.ts`**

`src/map/translate/surface.ts`:

```ts
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

/** A section's surface: exact padding, ink, background and device visibility. */
export function sectionSurface(profile: SectionProfile, settings: Obj, hidden: boolean, theme: ThemeColours): { surface: Surface; fidelity: FidelityEntry[] } {
  const fidelity: FidelityEntry[] = [];
  const surface: Surface = { padding: paddingShorthand(profile.padding) };
  const ink = inkFor(profile.ink);
  if (ink.value) surface['ink'] = ink.value;
  if (ink.fidelity) fidelity.push(ink.fidelity);
  // A legacy section with no background shows the page colour; without an explicit
  // `none` the hero template paints its own default tint instead.
  surface['background'] = surfaceBackgroundFor(settings['background'] as Obj | undefined, theme) ?? { type: 'none' };
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
  const background = surfaceBackgroundFor(settings['background'] as Obj | undefined, theme);
  if (background) surface['background'] = background;
  if (profile.padding) surface['padding'] = paddingShorthand(profile.padding);
  if (profile.radius) surface['borderRadius'] = cornersShorthand(profile.radius);
  if (profile.shadow) surface['shadow'] = SHADOW[profile.shadow];
  return Object.keys(surface).length > 0 ? surface : null;
}
```

- [x] **Step 4: Run the test**

Run: `nvm use && npx vitest run tests/map/translate-surface.test.ts`
Expected: PASS, 8 tests.

- [x] **Step 5: Commit**

```bash
git add src/map/translate/surface.ts tests/map/translate-surface.test.ts
git commit -m "feat(translate): exact section and column surfaces, ink by luminance"
```

---

### Task 6: Leaf translation

**Files:**
- Create: `src/map/translate/leaf.ts`
- Test: `tests/map/translate-leaf.test.ts`

**Interfaces:**
- Consumes: `BUTTON_ICONS` from `../style.js`; profile types; `FidelityEntry`, `FIDELITY_THRESHOLD_PX` from `./fidelity.js`.
- Produces:
  - `headlineSettings(p: HeadlineProfile): { settings: Obj; fidelity: FidelityEntry[] }`
  - `textSettings(p: TextProfile): { settings: Obj; fidelity: FidelityEntry[] }`
  - `imageSettings(p: ImageProfile, alt: string, columnContentWidth: number | null): { settings: Obj; fidelity: FidelityEntry[] }`
  - `buttonSettings(p: ButtonProfile, legacySettings: Obj, action: { type: string; value: string }, newTab: boolean): { settings: Obj; fidelity: FidelityEntry[] }`
  - `describeButtonChrome(c: ButtonChrome): string`; `V3_LG_BUTTON = 'size lg: 14.4px radius, 14px x 46px, no shadow, weight 400'`

- [x] **Step 1: Write the failing test**

`tests/map/translate-leaf.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_HUB_PROFILE, hubStyleProfile } from '../../src/map/profile/hub.js';
import type { ButtonProfile, HeadlineProfile, ImageProfile, TextProfile } from '../../src/map/profile/types.js';
import { V3_LG_BUTTON, buttonSettings, describeButtonChrome, headlineSettings, imageSettings, textSettings } from '../../src/map/translate/leaf.js';

const base = { align: 'left' as const, marginTop: 0, bottomMargin: 0 };

describe('headlineSettings', () => {
  it('maps level and weight, never the display size, and reports the h4 size gap', () => {
    const h2: HeadlineProfile = { ...base, kind: 'headline', level: 2, fontSize: 32, bottomMargin: 20, align: 'center' };
    expect(headlineSettings(h2)).toEqual({ settings: { level: 2, weight: 700, align: 'center' }, fidelity: [] });
    const h4: HeadlineProfile = { ...base, kind: 'headline', level: 4, fontSize: 18, bottomMargin: 10 };
    expect(headlineSettings(h4)).toEqual({ settings: { level: 4, weight: 700, align: 'left' }, fidelity: [{ property: 'headline.size', legacy: '18px', v3: '20px' }] });
  });
});

describe('textSettings', () => {
  it('sets align and removes the V3 default bottom margin', () => {
    const t: TextProfile = { ...base, kind: 'text', align: 'right', bottomMargin: 20 };
    expect(textSettings(t)).toEqual({ settings: { align: 'right', marginBottom: 0 }, fidelity: [] });
  });
});

describe('imageSettings', () => {
  const image = (over: Partial<ImageProfile>): ImageProfile => ({ ...base, kind: 'image', maxWidth: null, fill: false, chrome: DEFAULT_HUB_PROFILE.thumbnail, transparent: false, align: 'center', ...over });

  it('the hero wordmark: 250 snaps to 352 with an entry, transparent drops the backdrop, 30px corners are m', () => {
    const p = image({ maxWidth: 250, transparent: true, chrome: { radius: [30, 30, 30, 30], border: null, shadow: null } });
    expect(imageSettings(p, 'Wordmark', 600)).toEqual({
      settings: { alt: 'Wordmark', aspectRatio: 'auto', objectFit: 'contain', alignX: 'center', maxWidth: 352, radius: 'm', backdrop: false },
      fidelity: [{ property: 'image.maxWidth', legacy: '250px', v3: '352px' }, { property: 'image.radius', legacy: '30px', v3: 'm (24px)' }],
    });
  });

  it('a wide image in a narrower column keeps no cap and reports the column width it will fill', () => {
    expect(imageSettings(image({ maxWidth: 490 }), 'x', 600).fidelity).toEqual([{ property: 'image.maxWidth', legacy: '490px', v3: 'column width 600px' }]);
    expect(imageSettings(image({ maxWidth: 490 }), 'x', 600).settings).not.toHaveProperty('maxWidth');
    expect(imageSettings(image({ maxWidth: 1000 }), 'x', 600).fidelity).toEqual([]);
  });

  it('square legacy images cannot be drawn: control (12px) with an entry; 128 and near-352 caps are exact', () => {
    expect(imageSettings(image({ maxWidth: 120, align: 'left' }), 'x', null)).toEqual({
      settings: { alt: 'x', aspectRatio: 'auto', objectFit: 'contain', alignX: 'start', maxWidth: 128, radius: 'control' },
      fidelity: [{ property: 'image.radius', legacy: '0px', v3: 'control (12px)' }],
    });
    expect(imageSettings(image({ maxWidth: 350, chrome: { radius: [14, 14, 14, 14], border: null, shadow: null } }), 'x', null).fidelity).toEqual([]);
  });

  it('a border becomes the hairline outline with an entry', () => {
    const p = image({ chrome: { radius: [12, 12, 12, 12], border: { width: 3, colour: '#ff0000', style: 'solid' }, shadow: null } });
    expect(imageSettings(p, 'x', null)).toMatchObject({ settings: { outline: true }, fidelity: [{ property: 'image.border', legacy: '3px solid #ff0000', v3: '1px hairline' }] });
  });
});

describe('buttonSettings', () => {
  const hub = hubStyleProfile({ appearance: { buttons: { cornerRadius: { show: true, topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }, dropShadow: { show: true, size: 'large' } } } });
  const button = (over: Partial<ButtonProfile>): ButtonProfile => ({ ...base, kind: 'button', chrome: hub.button, fullWidth: false, colours: null, ...over });

  it('describes the ManTalks chrome and pairs it with what lg draws', () => {
    expect(describeButtonChrome(hub.button)).toBe('0px radius, 13px 30px, shadow large, weight 700');
    expect(V3_LG_BUTTON).toBe('size lg: 14.4px radius, 14px x 46px, no shadow, weight 400');
  });

  it('emits lg with the icon and a hub-wide chrome entry', () => {
    const legacy = { button: { icon: { show: true, alignment: 'right', illustration: { icon: 'chat' } } } };
    expect(buttonSettings(button({}), legacy, { type: 'page', value: '/discussions' }, false)).toEqual({
      settings: { action: { type: 'page', value: '/discussions' }, variant: 'primary', size: 'lg', newTab: false, iconRight: 'chat' },
      fidelity: [{ property: 'button.chrome', legacy: '0px radius, 13px 30px, shadow large, weight 700', v3: V3_LG_BUTTON, hubWide: true }],
    });
  });

  it('a left icon, full width, and colours that differ from the hub primary', () => {
    const legacy = { button: { icon: { show: true, alignment: 'left', illustration: { icon: 'play' } } } };
    const out = buttonSettings(button({ fullWidth: true, colours: { background: '#000000', text: '#ffffff' } }), legacy, { type: 'url', value: 'https://x' }, true);
    expect(out.settings).toEqual({ action: { type: 'url', value: 'https://x' }, variant: 'primary', size: 'lg', newTab: true, icon: 'play', fullWidthMobile: true });
    expect(out.fidelity).toContainEqual({ property: 'button.colours', legacy: '#000000 on #ffffff', v3: 'hub primary' });
  });

  it('a pill at the base chrome still differs from lg and says so', () => {
    expect(buttonSettings(button({ chrome: DEFAULT_HUB_PROFILE.button }), {}, { type: 'url', value: '' }, false).fidelity[0]?.legacy).toBe('40px radius, 13px 30px, no shadow, weight 700');
  });
});
```

- [x] **Step 2: Run it to see it fail**

Run: `nvm use && npx vitest run tests/map/translate-leaf.test.ts`
Expected: FAIL, module not found.

- [x] **Step 3: Implement `leaf.ts`**

`src/map/translate/leaf.ts`:

```ts
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
```

Note on `button.colours`: the existing `dominantButtonColour` sets the hub primary to the colour most buttons carry, so this entry fires for every coloured button, including the majority ones. Task 8 filters it: the column translator drops `button.colours` entries whose legacy background equals the dominant colour passed in through `MapContext.dominantButtonBackground`.

- [x] **Step 4: Run the test**

Run: `nvm use && npx vitest run tests/map/translate-leaf.test.ts`
Expected: PASS, 10 tests.

- [x] **Step 5: Commit**

```bash
git add src/map/translate/leaf.ts tests/map/translate-leaf.test.ts
git commit -m "feat(translate): headline, text, image and button leaves with fidelity entries"
```

---

### Task 7: The column stack: run wrappers and rhythm wrappers

**Files:**
- Create: `src/map/translate/stack.ts`
- Test: `tests/map/translate-stack.test.ts`

**Interfaces:**
- Consumes: `CatalogNode` from `../catalog.js`; `stackWidthFor`, `Surface` from `../style.js`; `ColumnProfile`, `ElementProfile` from `../profile/types.js`; `visibleGaps`, `commonGap` from `../profile/rhythm.js`; `STACK_GAP_PX`, `snapPx`, `stackGapSetting`, `FIDELITY_THRESHOLD_PX` from `./fidelity.js`.
- Produces:

```ts
export interface PlacedElement { node: CatalogNode; profile: ElementProfile; legacyId: number }
export interface ColumnStackArgs {
  id: string;
  profile: ColumnProfile;
  elements: PlacedElement[];
  surface: Surface | null;
  /** Mints a wrapper id for the element with this legacy id; n distinguishes wrappers on one element. */
  mintId(legacyId: number, n: number): string;
}
export function columnStack(args: ColumnStackArgs): CatalogNode
```

- [x] **Step 1: Write the failing test**

`tests/map/translate-stack.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CatalogNode } from '../../src/map/catalog.js';
import type { ColumnProfile, ElementProfile } from '../../src/map/profile/types.js';
import { columnStack, type PlacedElement } from '../../src/map/translate/stack.js';

const column: ColumnProfile = { widthPct: 50, justify: 'center', padding: null, radius: null, shadow: null };
const mintId = (legacyId: number, n: number): string => `w-${legacyId}-${n}`;

function placed(legacyId: number, profile: Partial<ElementProfile> & { kind: ElementProfile['kind'] }, node: Partial<CatalogNode> = {}): PlacedElement {
  const full = { align: 'left', marginTop: 30, bottomMargin: 0, ...profile } as ElementProfile;
  return { node: { id: `n-${legacyId}`, kind: profile.kind === 'other' ? 'video' : profile.kind, value: 'x', ...node }, profile: full, legacyId };
}

describe('columnStack', () => {
  it('the hero column: justify center, gap 20, the two buttons in one start-aligned run with a 32px gap', () => {
    const node = columnStack({
      id: 'col', profile: column, surface: null, mintId,
      elements: [
        placed(1, { kind: 'headline', level: 2, fontSize: 32, marginTop: 0, bottomMargin: 20 }),
        placed(2, { kind: 'text', marginTop: 0, bottomMargin: 20 }),
        placed(3, { kind: 'button', marginTop: 0, chrome: {} as never, fullWidth: false, colours: null }),
        placed(4, { kind: 'button', marginTop: 30, chrome: {} as never, fullWidth: false, colours: null }),
      ],
    });
    expect(node).toEqual({
      id: 'col', kind: 'stack', settings: { gap: 5, width: '1/2', justify: 'center' },
      children: [
        { id: 'n-1', kind: 'headline', value: 'x' },
        { id: 'n-2', kind: 'text', value: 'x' },
        { id: 'w-3-0', kind: 'stack', settings: { align: 'start', gap: 8 }, children: [{ id: 'n-3', kind: 'button', value: 'x' }, { id: 'n-4', kind: 'button', value: 'x' }] },
      ],
    });
  });

  it('a lone element: gap 0, no justify for top, the column surface carried', () => {
    const node = columnStack({ id: 'col', profile: { ...column, justify: 'start' }, surface: { padding: '20px' }, mintId, elements: [placed(1, { kind: 'text', marginTop: 0, bottomMargin: 20 })] });
    expect(node).toEqual({ id: 'col', kind: 'stack', settings: { gap: 0, width: '1/2', surface: { padding: '20px' } }, children: [{ id: 'n-1', kind: 'text', value: 'x' }] });
  });

  it('a centred button gets its own centred run; buttons with different alignment do not share a run', () => {
    const node = columnStack({
      id: 'col', profile: { ...column, justify: 'start' }, surface: null, mintId,
      elements: [
        placed(1, { kind: 'button', marginTop: 0, align: 'center', chrome: {} as never, fullWidth: false, colours: null }),
        placed(2, { kind: 'button', marginTop: 30, align: 'right', chrome: {} as never, fullWidth: false, colours: null }),
      ],
    });
    expect(node.children).toEqual([
      { id: 'w-1-0', kind: 'stack', settings: { align: 'center', gap: 0 }, children: [{ id: 'n-1', kind: 'button', value: 'x' }] },
      { id: 'w-2-0', kind: 'stack', settings: { align: 'end', gap: 0 }, children: [{ id: 'n-2', kind: 'button', value: 'x' }] },
    ]);
  });

  it('an element far off the common gap gets a rhythm wrapper with the exact offset, negative allowed', () => {
    const node = columnStack({
      id: 'col', profile: { ...column, justify: 'start' }, surface: null, mintId,
      elements: [
        placed(1, { kind: 'headline', level: 2, fontSize: 32, marginTop: 0, bottomMargin: 20 }),
        placed(2, { kind: 'text', marginTop: 30, bottomMargin: 20 }),
        placed(3, { kind: 'text', marginTop: 30, bottomMargin: 20 }),
        placed(4, { kind: 'text', marginTop: 55, bottomMargin: 20 }),
        placed(5, { kind: 'text', marginTop: 0, bottomMargin: 20 }),
      ],
    });
    // gaps 0, 30, 30, 55, 20; common 30 snaps to 32
    expect(node.settings).toEqual({ gap: 8, width: '1/2' });
    expect(node.children?.[3]).toEqual({ id: 'w-4-0', kind: 'stack', settings: { gap: 0, surface: { margin: '23px 0 0' } }, children: [{ id: 'n-4', kind: 'text', value: 'x' }] });
    expect(node.children?.[4]).toEqual({ id: 'w-5-0', kind: 'stack', settings: { gap: 0, surface: { margin: '-12px 0 0' } }, children: [{ id: 'n-5', kind: 'text', value: 'x' }] });
    expect(node.children?.[1]).toEqual({ id: 'n-2', kind: 'text', value: 'x' });
  });

  it('a first element with its own margin-top is offset by the whole margin', () => {
    const node = columnStack({ id: 'col', profile: { ...column, justify: 'start' }, surface: null, mintId, elements: [placed(1, { kind: 'text', marginTop: 30, bottomMargin: 20 }), placed(2, { kind: 'text', marginTop: 30, bottomMargin: 20 })] });
    expect(node.children?.[0]).toEqual({ id: 'w-1-0', kind: 'stack', settings: { gap: 0, surface: { margin: '30px 0 0' } }, children: [{ id: 'n-1', kind: 'text', value: 'x' }] });
  });

  it('a button run that also needs an offset carries the margin on the run wrapper', () => {
    const node = columnStack({
      id: 'col', profile: { ...column, justify: 'start' }, surface: null, mintId,
      elements: [
        placed(1, { kind: 'text', marginTop: 0, bottomMargin: 20 }),
        placed(2, { kind: 'text', marginTop: 30, bottomMargin: 20 }),
        placed(3, { kind: 'button', marginTop: 60, chrome: {} as never, fullWidth: false, colours: null }),
      ],
    });
    // gaps 0, 30, 60; common 30 -> 32; button delta 28
    expect(node.children?.[2]).toEqual({ id: 'w-3-0', kind: 'stack', settings: { align: 'start', gap: 0, surface: { margin: '28px 0 0' } }, children: [{ id: 'n-3', kind: 'button', value: 'x' }] });
  });
});
```

- [x] **Step 2: Run it to see it fail**

Run: `nvm use && npx vitest run tests/map/translate-stack.test.ts`
Expected: FAIL, module not found.

- [x] **Step 3: Implement `stack.ts`**

`src/map/translate/stack.ts`:

```ts
import type { CatalogNode } from '../catalog.js';
import { commonGap, visibleGaps } from '../profile/rhythm.js';
import type { Align, ColumnProfile, ElementProfile } from '../profile/types.js';
import { stackWidthFor, type Surface } from '../style.js';
import { FIDELITY_THRESHOLD_PX, STACK_GAP_PX, snapPx, stackGapSetting } from './fidelity.js';

export interface PlacedElement { node: CatalogNode; profile: ElementProfile; legacyId: number }

export interface ColumnStackArgs {
  id: string;
  profile: ColumnProfile;
  elements: PlacedElement[];
  surface: Surface | null;
  /** Mints a wrapper id for the element with this legacy id; n distinguishes wrappers on one element. */
  mintId(legacyId: number, n: number): string;
}

const STACK_ALIGN: Record<Align, string> = { left: 'start', center: 'center', right: 'end' };

/** A maximal run of consecutive buttons sharing one alignment, or a single element of any other kind. */
interface Unit { start: number; end: number; buttons: boolean }

function units(elements: PlacedElement[]): Unit[] {
  const out: Unit[] = [];
  let i = 0;
  while (i < elements.length) {
    const first = elements[i]!;
    if (first.profile.kind !== 'button') { out.push({ start: i, end: i, buttons: false }); i += 1; continue; }
    let j = i;
    while (j + 1 < elements.length && elements[j + 1]!.profile.kind === 'button' && elements[j + 1]!.profile.align === first.profile.align) j += 1;
    out.push({ start: i, end: j, buttons: true });
    i = j + 1;
  }
  return out;
}

/**
 * One legacy column as a V3 stack. The stack's gap is the column's most common
 * visible gap; buttons sit in a run wrapper so they shrink-wrap like legacy's
 * inline-block .btn; anything more than the threshold off the common gap gets a
 * wrapper carrying the exact offset as a freeform surface.margin.
 */
export function columnStack(args: ColumnStackArgs): CatalogNode {
  const { elements, profile } = args;
  const gaps = visibleGaps(elements.map((e) => e.profile));
  const stackGapPx = elements.length > 1 ? snapPx(commonGap(gaps), STACK_GAP_PX) : 0;

  const children: CatalogNode[] = [];
  for (const unit of units(elements)) {
    const first = elements[unit.start]!;
    const gapBefore = gaps[unit.start] ?? 0;
    // Before the first element there is no stack gap, so the whole margin is the offset.
    const delta = unit.start === 0 ? gapBefore : gapBefore - stackGapPx;
    const needsOffset = Math.abs(delta) > FIDELITY_THRESHOLD_PX;
    const nodes = elements.slice(unit.start, unit.end + 1).map((e) => e.node);

    if (!unit.buttons && !needsOffset) { children.push(first.node); continue; }

    const settings: Record<string, unknown> = {};
    if (unit.buttons) {
      settings['align'] = STACK_ALIGN[first.profile.align];
      const runGaps = gaps.slice(unit.start, unit.end + 1);
      settings['gap'] = runGaps.length > 1 ? stackGapSetting(snapPx(commonGap(runGaps), STACK_GAP_PX)) : 0;
    } else {
      settings['gap'] = 0;
    }
    if (needsOffset) settings['surface'] = { margin: `${delta}px 0 0` };
    children.push({ id: args.mintId(first.legacyId, 0), kind: 'stack', settings, children: nodes });
  }

  const settings: Record<string, unknown> = { gap: stackGapSetting(stackGapPx), width: stackWidthFor(profile.widthPct) };
  if (profile.justify !== 'start') settings['justify'] = profile.justify;
  if (args.surface) settings['surface'] = args.surface;
  return { id: args.id, kind: 'stack', settings, children };
}
```

- [x] **Step 4: Run the test**

Run: `nvm use && npx vitest run tests/map/translate-stack.test.ts`
Expected: PASS, 6 tests. If the hero test's run gap differs, check `commonGap([20, 30])`: gaps inside the run are `[gaps[2], gaps[3]] = [20, 30]`, `commonGap` skips index 0 and returns 30, snapped 32, setting 8.

- [x] **Step 5: Commit**

```bash
git add src/map/translate/stack.ts tests/map/translate-stack.test.ts
git commit -m "feat(translate): column stack with button runs and rhythm wrappers"
```

---

### Task 8: Wire the mapper through the profile and translate layers

**Files:**
- Modify: `src/map/sections.ts` (imports, `MapContext`, `blockNode` column branch, `sectionContainer` call sites, `featuredSection`, `mapSection` columns branch)
- Modify: `src/map/elements.ts` (imports, `ElementContext`, headline, text, image, button cases)
- Modify: `src/map/pages.ts:115-116, 180-207`
- Modify: `src/map/style.ts` (delete moved functions)
- Modify: `tests/map/style.test.ts`, `tests/map/elements.test.ts:32`, `tests/map/sections.test.ts` (as listed)

**Interfaces:**
- `MapContext` gains `hubProfile?: HubStyleProfile` and `dominantButtonBackground?: string | null`; `mapElement(section, ordinal, extra?: { columnContentWidth?: number })`.
- `ElementContext` gains `hubProfile?: HubStyleProfile`, `columnContentWidth?: number | null`, `dominantButtonBackground?: string | null`.
- `mapElement` signature unchanged otherwise. `blockNode` gains a fourth parameter `siblingCount = 1`.

- [x] **Step 1: Update `elements.ts`**

Replace the import block's last line and add:

```ts
import { BUTTON_ICONS } from './style.js';   // only if still referenced; otherwise drop the style import
import { elementProfile } from './profile/element.js';
import { DEFAULT_HUB_PROFILE } from './profile/hub.js';
import type { HubStyleProfile } from './profile/types.js';
import { fidelityWarning } from './translate/fidelity.js';
import { buttonSettings, headlineSettings, imageSettings, textSettings } from './translate/leaf.js';
```

Remove `buttonSettingsFor, headlineSettingsFor, imageSettingsFor, textSettingsFor` from the `./style.js` import (delete the import line entirely if nothing else is used).

Add to `ElementContext`:

```ts
  /** The hub theme's style profile; defaults to the SCSS base. */
  hubProfile?: HubStyleProfile;
  /** Content width of the enclosing column at 1240px, for image cap fidelity. */
  columnContentWidth?: number | null;
  /** The button background the hub primary was set to, so majority buttons raise no colour entry. */
  dominantButtonBackground?: string | null;
```

At the top of `mapElement`, after `const settings = parseSettings(section.settings);`, add:

```ts
  const profile = elementProfile(section, ctx.hubProfile ?? DEFAULT_HUB_PROFILE);
  const report = (entries: ReturnType<typeof headlineSettings>['fidelity']): void => {
    for (const entry of entries) {
      if (entry.property === 'button.colours' && ctx.dominantButtonBackground && entry.legacy.startsWith(ctx.dominantButtonBackground)) continue;
      ctx.warn(fidelityWarning(entry, ctx.pageSlug, section.id));
    }
  };
```

Headline case: replace the `isSubheadline` line and the return with:

```ts
      const headlineText = doc ? docToText(doc) : isDisplayLabel(content) ? '' : content;
      if (!headlineText || profile.kind !== 'headline') return null;
      const headline = headlineSettings(profile);
      report(headline.fidelity);
      return { id, kind: 'headline', value: headlineText, settings: headline.settings };
```

Text case: replace `const out = textSettingsFor(settings);` with `if (profile.kind !== 'text') return null; const text = textSettings(profile); report(text.fidelity);` and the return with `return { id, kind: 'text', value: text, settings: text.settings };` (rename the local `text` string to `textValue` to avoid the clash).

Image case: replace `const out = imageSettingsFor(settings, section.title ?? '');` with:

```ts
      if (profile.kind !== 'image') return null;
      const image = imageSettings(profile, section.title ?? '', ctx.columnContentWidth ?? null);
      report(image.fidelity);
      const out = image.settings;
```

Button case: replace the final `return { id, kind: 'button', value: label, settings: buttonSettingsFor(settings, action, link?.['newTab'] === true) };` with:

```ts
      if (profile.kind !== 'button') return null;
      const button = buttonSettings(profile, settings, action, link?.['newTab'] === true);
      report(button.fidelity);
      return { id, kind: 'button', value: label, settings: button.settings };
```

- [x] **Step 2: Update `sections.ts`**

Imports: replace the `./style.js` import with

```ts
import { instantiateRecipe, stackWidthFor } from './style.js';
import { columnProfile, sectionProfile } from './profile/section.js';
import { elementProfile } from './profile/element.js';
import { DEFAULT_HUB_PROFILE } from './profile/hub.js';
import type { HubStyleProfile } from './profile/types.js';
import { fidelityWarning } from './translate/fidelity.js';
import { buttonSettings } from './translate/leaf.js';
import { columnStack, type PlacedElement } from './translate/stack.js';
import { LAYOUT_ROW_SETTINGS, columnSurface, sectionSurface } from './translate/surface.js';
```

`MapContext`: change `mapElement` to `mapElement(section: LegacySection, ordinal: number, extra?: { columnContentWidth?: number }): CatalogNode | null;` and add

```ts
  hubProfile?: HubStyleProfile;
  dominantButtonBackground?: string | null;
```

`blockNode` signature: `function blockNode(block: LegacySection, ordinal: number, ctx: MapContext, siblingCount = 1): CatalogNode`. Replace the `column` branch with:

```ts
  if (block.type === 'column') {
    const hub = ctx.hubProfile ?? DEFAULT_HUB_PROFILE;
    const profile = columnProfile(settings, siblingCount);
    // Content width of this column at V3's 1240px cap, less the 20px gutter.
    const columnContentWidth = Math.round((1240 * profile.widthPct) / 100) - 20;
    const elements: PlacedElement[] = [];
    ctx.childrenOf(block.id).forEach((child, i) => {
      const node = ctx.mapElement(child, i, { columnContentWidth });
      if (node) elements.push({ node, profile: elementProfile(child, hub), legacyId: child.id });
    });
    return columnStack({
      id,
      profile,
      elements,
      surface: columnSurface(profile, settings, ctx.themeColours ?? {}),
      mintId: (legacyId, n) => nodeId(ctx.legacyHubId, ctx.legacyPageId, legacyId, EXTRA_ORDINAL_BASE + n),
    });
  }
```

The card branch that calls `buttonSettingsFor(settings, action, link?.['newTab'] === true)` (the `-page`/`-url`/`carousel-cta` cards) builds a button profile by hand, because `elementProfile` returns `OtherProfile` for a card block type:

```ts
    const hub = ctx.hubProfile ?? DEFAULT_HUB_PROFILE;
    const cardButton = buttonSettings(
      { kind: 'button', align: 'left', marginTop: 0, bottomMargin: 0, chrome: hub.button, fullWidth: false, colours: null },
      settings, action, link?.['newTab'] === true,
    );
    // Card buttons are catalog chrome, not legacy buttons; their chrome entry would double-count.
```

and use `settings: cardButton.settings`. Do not report `cardButton.fidelity`.

`mapSection`: replace `const surface = sectionSurfaceFor(settings, section.hidden === 1, ctx.themeColours ?? {});` with

```ts
  const { surface, fidelity } = sectionSurface(sectionProfile(settings, ctx.themeColours?.secondary), settings, section.hidden === 1, ctx.themeColours ?? {});
  for (const entry of fidelity) ctx.warn(fidelityWarning(entry, ctx.pageSlug, section.id));
```

In the "columns of elements" branch, pass the sibling count and the new row settings:

```ts
  const columns = legacyChildren
    .map((child, i) =>
      lookupMapping(child.type, 'block') || child.type === 'column'
        ? blockNode(child, i, ctx, legacyChildren.length)
        : ctx.mapElement(child, i),
    )
    .filter((n): n is CatalogNode => n !== null);
  const layout: CatalogNode = { id: mint(0), kind: 'row', settings: { ...LAYOUT_ROW_SETTINGS }, children: columns };
```

`featuredSection`: the headline becomes `settings: { level: 2, weight: 700, align: 'left' }`; the description text `settings: { align: 'left', marginBottom: 0 }`; the button

```ts
    const hub = ctx.hubProfile ?? DEFAULT_HUB_PROFILE;
    const featuredButton = buttonSettings({ kind: 'button', align: 'left', marginTop: 0, bottomMargin: 0, chrome: hub.button, fullWidth: false, colours: null }, settings, action, false);
    for (const entry of featuredButton.fidelity) ctx.warn(fidelityWarning(entry, ctx.pageSlug, section.id));
    stack.push({ id: mint(3), kind: 'button', value: buttonLabel, settings: featuredButton.settings });
```

and the inner stack `settings: { align: 'start', gap: 5 }` (legacy featured stacks title, description and button 20px apart; 5 = 20px).

- [x] **Step 3: Update `pages.ts`**

After line 116 (`const themeColours = ...`) add:

```ts
  const hubProfile = hubStyleProfile(themeSettings);
  const dominantButtonBackground = dominantButtonColour(bundle.sections)?.background ?? null;
```

with imports `import { hubStyleProfile } from './profile/hub.js';` and `import { dominantButtonColour } from './style.js';`.

In the `ctx` literal add `hubProfile, dominantButtonBackground,` and change `mapElement` to

```ts
      mapElement: (section, ordinal, extra) =>
        mapElement(section, ordinal, {
          ...
          hubProfile,
          dominantButtonBackground,
          columnContentWidth: extra?.columnContentWidth ?? null,
        }),
```

- [x] **Step 4: Trim `style.ts`**

Delete `surfacePaddingFor`, `sectionSurfaceFor`, `columnSurfaceFor`, `layoutRowSettings`, `headlineSettingsFor`, `textSettingsFor`, `imageSettingsFor`, `buttonSettingsFor`. Keep `Surface`, `ThemeColours`, `HEX6`, `surfaceBackgroundFor`, `stackWidthFor`, `BUTTON_ICONS`, `dominantButtonColour`, `instantiateRecipe`. Update the file's header comment to say it holds the shared vocabulary the profile and translate layers use.

- [x] **Step 5: Typecheck and fix the tests that pinned the old output**

Run: `nvm use && npm run typecheck`
Expected: errors only in tests. Then:

`tests/map/style.test.ts`: delete the tests for `surfacePaddingFor`, `sectionSurfaceFor`, `imageSettingsFor`, `buttonSettingsFor` and the `theme-colour backgrounds` describe; move the background assertions onto `surfaceBackgroundFor` directly:

```ts
import { describe, expect, it } from 'vitest';
import { dominantButtonColour, stackWidthFor, surfaceBackgroundFor } from '../../src/map/style.js';

describe('shared style vocabulary', () => {
  it('maps the legacy background kinds onto surface.background', () => {
    expect(surfaceBackgroundFor({ type: 'custom-color', color: '#242424' })).toEqual({ type: 'custom-color', value: '#242424' });
    expect(surfaceBackgroundFor({ type: 'secondary-color' })).toEqual({ type: 'color', token: 'secondary' });
    expect(surfaceBackgroundFor({ type: 'secondary-color' }, { secondary: '#333333' })).toEqual({ type: 'custom-color', value: '#333333' });
    expect(surfaceBackgroundFor({ type: 'image', image: { url: 'https://x/y.png' }, color: '#878C6A' })).toEqual({ type: 'image', url: 'https://x/y.png', blur: false });
    expect(surfaceBackgroundFor({ type: 'default' })).toBeNull();
  });

  it('turns percentages into the stack width enum', () => {
    expect(stackWidthFor(100)).toBe('full');
    expect(stackWidthFor(50)).toBe('1/2');
    expect(stackWidthFor(33.333333)).toBe('1/3');
    expect(stackWidthFor(25)).toBe('1/4');
    expect(stackWidthFor('2/3')).toBe('2/3');
  });

  it('finds the button colour most of the hub uses, or nothing when buttons disagree', () => {
    const btn = (bg: string) => ({ type: 'button', settings: JSON.stringify({ styles: { theme: { colors: { background: bg, text: '#FFFFFF' } } } }) });
    expect(dominantButtonColour([btn('#5770D1'), btn('#5770D1'), btn('#5770D1'), btn('#000000')])).toEqual({ background: '#5770D1', text: '#FFFFFF' });
    expect(dominantButtonColour([btn('#5770D1'), btn('#000000')])).toBeNull();
  });
});
```

`tests/map/elements.test.ts:32`: the headline settings become `{ level: 2, weight: 700, align: 'center' }`. Any assertion on `size: 'large-title'`, image `maxWidth`, or button `size` elsewhere in that file changes to the new shape; run the file and read each failure against the leaf tests in Task 6.

`tests/map/sections.test.ts`: the `row` fixture column has `settings: {"size":"1/2"}`; `columnProfile` reads `Number('1/2')` as NaN and falls back to `100 / siblingCount` = 100 → `width: 'full'`. Change the fixture's column settings to `{"size":50}` so it still maps to `1/2`. Any assertion that reads `surface.padding` expecting a token now expects `'50px 0'`.

Run: `nvm use && npx vitest run`
Expected: everything green. Read every failure; do not delete an assertion without replacing it with the new expected value.

- [x] **Step 6: Commit**

```bash
git add -A src/map tests/map tests/fixtures
git commit -m "feat(map): route sections and elements through the profile and translate layers"
```

---

### Task 9: The hero golden test

**Files:**
- Create: `tests/fixtures/sections/hero-row.json`
- Test: `tests/map/hero.test.ts`

**Interfaces:** consumes `mapSection`, `mapElement`, `MapContext`, `nodeId`, `hubStyleProfile`.

- [x] **Step 1: Write the fixture**

The ManTalks section 3398809 tree, settings verbatim, copy replaced. `tests/fixtures/sections/hero-row.json`:

```json
{
  "section": {
    "id": 3398809, "hub_id": 38827, "page_id": 280338, "parent_id": null,
    "model_type": null, "model_id": null, "hidden": null, "type": "row",
    "title": null, "label": null,
    "settings": "{\"styles\":{\"padding\":{\"top\":\"150\",\"show\":true,\"bottom\":\"150\"},\"visibility\":\"desktop\"},\"columns\":{\"count\":1},\"animation\":{\"settings\":{\"type\":\"slide-up\",\"delay\":0,\"easing\":\"linear\",\"enabled\":true,\"duration\":\"0\"}},\"textTheme\":\"custom\",\"thumbnail\":{\"designId\":null,\"is_thumbnail_transparent\":false},\"background\":{\"type\":\"image\",\"color\":\"#878C6A\",\"image\":{\"url\":\"https://cdn.example.com/hero-bg.png\"},\"designId\":null,\"position\":\"center\"},\"textThemeColor\":\"#F7F2E8\"}",
    "permissions": null, "meta": null, "position": 1, "segment_id": null
  },
  "children": [
    {
      "id": 3398810, "hub_id": 38827, "page_id": null, "parent_id": 3398809,
      "model_type": null, "model_id": null, "hidden": null, "type": "column",
      "title": null, "label": null,
      "settings": "{\"size\":50,\"thumbnail\":{\"designId\":null,\"is_thumbnail_transparent\":false}}",
      "permissions": null, "meta": null, "position": 1, "segment_id": null
    },
    {
      "id": 3398811, "hub_id": 38827, "page_id": null, "parent_id": 3398809,
      "model_type": null, "model_id": null, "hidden": null, "type": "column",
      "title": null, "label": null,
      "settings": "{\"size\":50,\"styles\":{\"align\":\"center\"},\"thumbnail\":{\"designId\":null,\"is_thumbnail_transparent\":false}}",
      "permissions": null, "meta": null, "position": 2, "segment_id": null
    }
  ],
  "grandchildren": [
    {
      "id": 3516756, "hub_id": 38827, "page_id": null, "parent_id": 3398810,
      "model_type": null, "model_id": null, "hidden": null, "type": "image",
      "title": "Wordmark", "label": "Image",
      "settings": "{\"align\":\"center\",\"styles\":{\"width\":{\"type\":\"custom\",\"value\":250},\"cornerRadius\":{\"show\":true}},\"margins\":{\"top\":0},\"thumbnail\":{\"url\":\"https://cdn.example.com/wordmark.png\",\"is_thumbnail_transparent\":true},\"appearance\":{\"overwrite\":true}}",
      "permissions": null, "meta": null, "position": 1, "segment_id": null
    },
    {
      "id": 3398812, "hub_id": 38827, "page_id": null, "parent_id": 3398811,
      "model_type": null, "model_id": null, "hidden": null, "type": "headline",
      "title": "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Welcome, member\"}]}]}", "label": "Headline",
      "settings": "{\"size\":\"large\",\"margins\":{\"top\":0},\"thumbnail\":{\"designId\":null,\"is_thumbnail_transparent\":false}}",
      "permissions": null, "meta": null, "position": 1, "segment_id": null
    },
    {
      "id": 3398813, "hub_id": 38827, "page_id": null, "parent_id": 3398811,
      "model_type": null, "model_id": null, "hidden": null, "type": "text",
      "title": null, "label": "Paragraph",
      "settings": "{\"value\":\"{\\\"type\\\":\\\"doc\\\",\\\"content\\\":[{\\\"type\\\":\\\"paragraph\\\",\\\"content\\\":[{\\\"type\\\":\\\"text\\\",\\\"text\\\":\\\"A short welcome paragraph.\\\"}]}]}\",\"margins\":{\"top\":0},\"thumbnail\":{\"designId\":null,\"is_thumbnail_transparent\":false}}",
      "permissions": null, "meta": null, "position": 2, "segment_id": null
    },
    {
      "id": 3424620, "hub_id": 38827, "page_id": null, "parent_id": 3398811,
      "model_type": "App\\Page", "model_id": 284460, "hidden": null, "type": "button",
      "title": null, "label": "Button",
      "settings": "{\"link\":{\"label\":\"Join The Conversation\"},\"type\":\"page\",\"button\":{\"icon\":{\"show\":true,\"alignment\":\"right\",\"illustration\":{\"icon\":\"chat\",\"name\":\"Chat\"}}},\"styles\":{\"theme\":{\"show\":true,\"colors\":{\"text\":\"#F7F2E8\",\"background\":\"#5770D1\"}}},\"margins\":{\"top\":0},\"page_id\":null,\"thumbnail\":{\"is_thumbnail_transparent\":false}}",
      "permissions": null, "meta": null, "position": 3, "segment_id": null
    },
    {
      "id": 4048781, "hub_id": 38827, "page_id": null, "parent_id": 3398811,
      "model_type": "App\\Page", "model_id": 284461, "hidden": null, "type": "button",
      "title": null, "label": "Button",
      "settings": "{\"link\":{\"label\":\"5-Day Challenge\"},\"type\":\"page\",\"button\":{\"icon\":{\"show\":true,\"alignment\":\"right\",\"illustration\":{\"icon\":\"boxing\",\"name\":\"Boxing\"}}},\"margins\":{\"top\":30},\"page_id\":null,\"thumbnail\":{\"is_thumbnail_transparent\":false}}",
      "permissions": null, "meta": null, "position": 4, "segment_id": null
    }
  ]
}
```

- [x] **Step 2: Write the failing golden test**

`tests/map/hero.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { LegacySection } from '../../src/extract/queries.js';
import { mapElement } from '../../src/map/elements.js';
import { nodeId } from '../../src/map/nodeId.js';
import type { PlanWarning } from '../../src/map/plan.js';
import { hubStyleProfile } from '../../src/map/profile/hub.js';
import { mapSection, type MapContext } from '../../src/map/sections.js';

interface Fixture { section: LegacySection; children: LegacySection[]; grandchildren: LegacySection[] }
const fixture = JSON.parse(readFileSync(new URL('../fixtures/sections/hero-row.json', import.meta.url), 'utf8')) as Fixture;

const HUB = 38827;
const PAGE = 280338;
const EXTRA = 1000;

const hubProfile = hubStyleProfile({
  colors: { primary: '#F7F2E8', secondary: '#333333' },
  appearance: {
    buttons: { dropShadow: { show: true, size: 'large' }, cornerRadius: { show: true, topLeft: '0', topRight: '0', bottomLeft: '0', bottomRight: '0' } },
    thumbnails: { cornerRadius: { show: true, topLeft: '30', topRight: '30', bottomLeft: '30', bottomRight: '30' } },
  },
});

function ctx(warnings: PlanWarning[]): MapContext {
  const all = [...fixture.children, ...fixture.grandchildren];
  const base = {
    legacyHubId: HUB, legacyPageId: PAGE, pageSlug: 'home-page',
    warn: (w: PlanWarning) => warnings.push(w),
    pageSlugById: (id: number) => (id === 284460 ? 'discussions' : id === 284461 ? '5d-challenge' : null),
    mediaIdForSection: () => null,
    assetForUrl: (url: string) => (url === 'https://cdn.example.com/wordmark.png' ? { legacyMediaId: 4213361, variant: 'thumbnail' } : null),
    themeColours: { primary: '#F7F2E8', secondary: '#333333' },
    hubProfile,
    dominantButtonBackground: '#5770D1',
  };
  return {
    ...base,
    childrenOf: (id) => all.filter((s) => s.parent_id === id).sort((a, b) => a.position - b.position),
    mapElement: (section, ordinal, extra) => mapElement(section, ordinal, { ...base, columnContentWidth: extra?.columnContentWidth ?? null }),
  };
}

describe('the ManTalks home hero', () => {
  const warnings: PlanWarning[] = [];
  const node = mapSection(fixture.section, 1, ctx(warnings));
  const row = node.children?.[0];
  const [left, right] = row?.children ?? [];

  it('is a row container with exact 150px padding, light ink and the background image', () => {
    expect(node).toMatchObject({
      id: nodeId(HUB, PAGE, 3398809, 1), kind: 'container', template: 'row',
      settings: { maxWidth: 'content', padding: 0, surface: { padding: '150px 0', ink: 'light', background: { type: 'image', url: 'https://cdn.example.com/hero-bg.png', blur: false }, visibility: { desktop: true, mobile: false } } },
    });
    expect(row?.settings).toEqual({ gap: 5, mobileGap: 6, align: 'stretch', wrap: true, responsive: true });
  });

  it('left column: the wordmark, centred, capped at 352, transparent, radius m', () => {
    expect(left?.settings).toEqual({ gap: 0, width: '1/2' });
    expect(left?.children).toEqual([
      { id: nodeId(HUB, PAGE, 3516756, 0), kind: 'image', value: 'ledger://asset/4213361/thumbnail', settings: { alt: 'Wordmark', aspectRatio: 'auto', objectFit: 'contain', alignX: 'center', maxWidth: 352, radius: 'control', backdrop: false } },
    ]);
  });

  it('right column: vertically centred, 20px rhythm, left-aligned copy, buttons in a start run 32px apart', () => {
    expect(right?.settings).toEqual({ gap: 5, width: '1/2', justify: 'center' });
    expect(right?.children).toEqual([
      { id: nodeId(HUB, PAGE, 3398812, 0), kind: 'headline', value: 'Welcome, member', settings: { level: 2, weight: 700, align: 'left' } },
      { id: nodeId(HUB, PAGE, 3398813, 1), kind: 'text', value: 'A short welcome paragraph.', settings: { align: 'left', marginBottom: 0 } },
      {
        id: nodeId(HUB, PAGE, 3424620, EXTRA), kind: 'stack', settings: { align: 'start', gap: 8 },
        children: [
          { id: nodeId(HUB, PAGE, 3424620, 2), kind: 'button', value: 'Join The Conversation', settings: { action: { type: 'page', value: '/discussions' }, variant: 'primary', size: 'lg', newTab: false, iconRight: 'chat' } },
          { id: nodeId(HUB, PAGE, 4048781, 3), kind: 'button', value: '5-Day Challenge', settings: { action: { type: 'page', value: '/5d-challenge' }, variant: 'primary', size: 'lg', newTab: false, iconRight: 'activity' } },
        ],
      },
    ]);
  });

  it('reports exactly the values V3 cannot draw', () => {
    const fidelity = warnings.filter((w) => w.type === 'fidelity').map((w) => [w.property, w.legacy, w.v3]);
    expect(fidelity).toEqual([
      ['section.ink', '#F7F2E8', 'light'],
      ['image.maxWidth', '250px', '352px'],
      ['image.radius', '0px', 'control (12px)'],
      ['button.chrome', '0px radius, 13px 30px, shadow large, weight 700', 'size lg: 14.4px radius, 14px x 46px, no shadow, weight 400'],
      ['button.chrome', '0px radius, 13px 30px, shadow large, weight 700', 'size lg: 14.4px radius, 14px x 46px, no shadow, weight 400'],
    ]);
    expect(warnings.filter((w) => w.type !== 'fidelity').map((w) => w.reason)).toEqual([]);
  });
});
```

Note for the implementer: the image overwrites appearance with `cornerRadius.show: true` and no corner values, so its own radius is `[0,0,0,0]` → `control` with an entry; the hub's 30px thumbnail radius does not apply to it. `assetForUrl` resolves the wordmark to a manifest entry, the way the real bundle does, so the image value is the ledger reference and no `approximated` warning fires.

- [x] **Step 3: Run it**

Run: `nvm use && npx vitest run tests/map/hero.test.ts`
Expected: PASS after Task 8. Any failure here is a wiring bug in Task 8, not a reason to change the expectation; the expected tree is the spec's section 5 applied to the hero.

- [x] **Step 4: Commit**

```bash
git add tests/fixtures/sections/hero-row.json tests/map/hero.test.ts
git commit -m "test(map): the ManTalks home hero as a golden fixture"
```

---

### Task 10: Branding font sizes and the map summary

**Files:**
- Modify: `src/map/branding.ts:24-42`
- Modify: `src/cli/map.ts:33, 146-176`
- Test: `tests/map/branding.test.ts` (add a case), `tests/map/translate-fidelity.test.ts` (already covers collapse)

- [x] **Step 1: Failing branding test**

Append to `tests/map/branding.test.ts` (match its existing helper for calling `mapBranding`; the theme argument is a `LegacyHubTheme`):

```ts
  it('carries the legacy heading and body font sizes when the theme sets them', () => {
    const theme = { id: 1, theme_id: 1, hub_id: 7, settings: JSON.stringify({ fonts: { headingFontSize: 40, bodyFontSize: '18' } }) };
    const { branding } = mapBranding(theme, [], 'https://cdn', 'https://s3');
    expect(branding['heading_font_size']).toBe(40);
    expect(branding['body_font_size']).toBe(18);
    expect(mapBranding({ ...theme, settings: '{}' }, [], 'https://cdn', 'https://s3').branding).not.toHaveProperty('heading_font_size');
  });
```

Run: `nvm use && npx vitest run tests/map/branding.test.ts`
Expected: FAIL on the new case (type error on the number, or missing key).

- [x] **Step 2: Implement**

In `branding.ts` widen the return type `branding: Record<string, string | boolean | number>` (and the local), then after the font family lines:

```ts
    // V3 branding.heading_font_size / body_font_size drive the whole text ladder
    // (mio-hub src/lib/hub-shape/branding.ts:137); legacy stores the same px.
    const headingSize = px(fonts?.['headingFontSize'], NaN);
    const bodySize = px(fonts?.['bodyFontSize'], NaN);
    if (Number.isFinite(headingSize) && headingSize > 0) branding['heading_font_size'] = headingSize;
    if (Number.isFinite(bodySize) && bodySize > 0) branding['body_font_size'] = bodySize;
```

with `import { px } from './profile/hub.js';`. Run `npm run typecheck`; if the apply layer types branding as `Record<string, string | boolean>`, widen it there too (grep `string | boolean>` in `src/apply` and `src/map/plan.ts`).

- [x] **Step 3: The map summary**

In `src/cli/map.ts`, import `collapseFidelity` from `../map/translate/fidelity.js`. Where the plan literal sets `warnings,`, set `warnings: collapseFidelity(warnings),`. After the `plan written` log add:

```ts
  const fidelity = plan.warnings.filter((w) => w.type === 'fidelity');
  const byProperty = new Map<string, { property: string; legacy: string; v3: string; count: number }>();
  for (const w of fidelity) {
    const key = `${w.property}|${w.legacy}|${w.v3}`;
    const entry = byProperty.get(key) ?? { property: w.property ?? '', legacy: w.legacy ?? '', v3: w.v3 ?? '', count: 0 };
    entry.count += w.count ?? 1;
    byProperty.set(key, entry);
  }
  for (const entry of [...byProperty.values()].sort((a, b) => b.count - a.count || a.property.localeCompare(b.property))) {
    logger.info('fidelity', entry);
  }
```

- [x] **Step 4: Run everything**

Run: `nvm use && npx vitest run && npm run typecheck`
Expected: all green.

- [x] **Step 5: Commit**

```bash
git add src/map/branding.ts src/cli/map.ts tests/map/branding.test.ts
git commit -m "feat(map): legacy font sizes into branding; fidelity summary after map"
```

---

### Task 11: Real map, dry run, docs

**Files:**
- Modify: `WORKLOG.md`, `README.md` (the "What M1 does not do" section gains the fidelity limits)
- Creates: a new `plans/hub-38827-*.json`

- [x] **Step 1: Map the current bundle**

Run: `nvm use && npm run cli -- map bundles/hub-38827-2026-09-11T19-31-09.475Z.json`
Expected: exit 0, `plan written`, then one `fidelity` line per distinct entry. Record the counts. Expected shape for ManTalks: `button.chrome` 79 (single line, the 0px/13px 30px/shadow large chrome), `image.maxWidth` for the 250/350/370/490/540 widths, `image.radius` for the 22 overwriting images, `section.ink` for the 56 sections with a custom text colour.

- [x] **Step 2: Inspect the hero in the new plan**

```bash
node -e '
const p=JSON.parse(require("fs").readFileSync(process.argv[1]));
const home=p.pages.find(x=>x.slug==="home-page"); const hero=home.tree.children[0];
console.log(JSON.stringify(hero,null,1));' plans/<new plan>.json
```

Expected: `surface.padding: '150px 0'`, `ink: 'light'`, right stack `{ gap: 5, width: '1/2', justify: 'center' }`, headline `{ level: 2, weight: 700, align: 'left' }`, buttons inside a `{ align: 'start', gap: 8 }` stack. If the tree differs from `tests/map/hero.test.ts`, the pages.ts wiring (Task 8 step 3) is not forwarding the profile; fix there.

- [x] **Step 3: Dry run against the live run**

Run: `nvm use && npm run cli -- apply plans/<new plan>.json --dry-run --resume run-2026-09-11T19-49-29-036Z-b3f055c6 --accept-plan-change --rewrite-pages --skip-assets --publish-held --hub-slug alliance`
Expected: exit 0; the operation list shows page tree rewrites for the columns pages and no hub, playlist, folder, segment or tag creates. Any `create` of a page means the node ids moved; stop and compare `nodeId` inputs.

- [x] **Step 4: Docs**

`WORKLOG.md`: a dated entry with the fidelity counts from step 1, the plan filename, and the sentence "Not applied; the resume is the user's call."

`README.md`, under the M1 limits: a bullet per row of the spec's section 8 table (button chrome, image caps, square images, mobile padding, background position, line-height, h4 size).

- [x] **Step 5: Commit and stop**

```bash
git add WORKLOG.md README.md
git commit -m "docs: style fidelity run notes and known limits"
```

Stop here. Report to the user: the fidelity summary lines, the plan path, and the exact `apply --resume` command from step 3 without `--dry-run`, for them to run or approve. After they apply, the acceptance check is a 1440px screenshot of `https://hub.member.dev/alliance/home-page` as `alkein@membership.io` against the legacy shot: 150px top and bottom, copy left-aligned and vertically centred, 32px heading, gaps 20/20/32.

---

## Self-review

**Spec coverage.** 4.1 hub profile → Task 1. 4.2 section profile, 4.3 column profile → Task 2. 4.4 element profiles, 4.5 rhythm → Task 3. 5.6 fidelity entries → Task 4 (plus collapse in Task 10). 5.1 section surface, column surface, inner row → Task 5. 5.4 leaves → Task 6. 5.2 stack, 5.3 placement → Task 7. Section 6 wiring → Task 8. Section 7 golden and real run → Tasks 9 and 11. 5.5 branding → Task 10. Section 8 limits → README in Task 11.

**Deviations from the spec, on purpose.** `PLAN_VERSION` stays 1 (see Global constraints). The golden expected tree lives in the test file, not a `.expected.json`, because node ids are computed and a JSON file would hide which input produced them. `button.colours` entries for the majority colour are filtered in `elements.ts` rather than never produced, so the leaf translator stays ignorant of the hub.

**Placeholder scan.** Every test and implementation step carries its full code. The one open-ended instruction is Task 8 step 5 ("read each failure against the leaf tests"), which is a test-update pass over assertions whose new values are all stated in Tasks 5 to 7.

**Type consistency.** `FidelityEntry.hubWide` is read by `fidelityWarning` (Task 4) and set by `buttonSettings` (Task 6). `PlacedElement` and `columnStack` (Task 7) are what `blockNode` builds (Task 8). `mapElement`'s third argument `{ columnContentWidth }` is declared on `MapContext.mapElement` (Task 8 step 2), forwarded in `pages.ts` (step 3), and used in the hero test's `ctx` (Task 9). `px` lives in `profile/hub.ts` and is imported by `profile/section.ts`, `profile/element.ts` and `branding.ts`.
