# Style fidelity: section, column and element profiling

Date: 2026-09-12. Extends the M1 mapper (`docs/superpowers/specs/2026-09-12-legacy-hub-migration-design.md`). Codex review pending.

## 1. Goal

A migrated page should look the same as the legacy page at desktop width: the same padding, the same vertical placement of a column's content, the same text alignment, the same heading sizes, the same gaps between elements, and buttons and images as close as V3 can draw them. Where V3 has no way to express a legacy value, the mapper picks the nearest V3 value and records the difference, so the team reads one list of "this is off by N px, here is why" instead of eyeballing pages.

Nothing changes in mio-hub, the catalog, the backend or searchie. Only this repo.

The ManTalks home hero (legacy section 3398809 on page 280338) is the acceptance case. Today it renders 64px padding instead of 150px, centred text instead of left-aligned, a 42px heading instead of 32px, and 16px gaps instead of 20/20/30.

## 2. Facts this design rests on

Established by reading both renderers line by line (searchie `resources/modules/hub/js/Components/Section/Row/*`, `resources/modules/hub/js/utils/appearance.js`, `resources/modules/hub/sass/`; mio-hub `src/components/primitives/*`, `src/lib/page-tree/settings-registry.ts`, `src/app/globals.css`). File references are in this spec so a later reader can re-verify.

Legacy:

- Section padding: SCSS base `50px 0` (30px top/bottom under 768px), overridden by inline `padding-{top,right,bottom,left}` when `styles.padding.show` is true (`Row.vue:103-113`, `appearance.js:34-53`). Content container is `max-width: 1300px` with `0 20px` padding, columns carry `0 10px`, so content is 1240px wide and the gutter between columns is 20px (`sections/_columns.scss:8-19`).
- Column `styles.align` is vertical: `top | center | bottom` becomes `justify-content` on a `flex-direction: column` box (`Column.vue:65-67`, `sections/_columns.scss:375-394`). Default `top`.
- Element `settings.align` is horizontal `text-align` on the element wrapper, default `left`; buttons are `inline-block`, so their placement is that `text-align` (`Item.vue:70`, `sections/_columns.scss:88-125`).
- Element `margins.top` is an inline `margin-top` in px, default 30; the editor writes 0 for the first element of a column (`Item.vue:56-60`, `Elements/Create.vue:216`). Bottom margins come from the tag: h2/h3/p 20px, h4 10px, image and button 0 (`_typography.scss`). Neighbouring margins collapse, so the visible gap is the larger of the two.
- Headline `size` large/medium/small renders h2/h3/h4 at `--heading-font-size` × 1 / × 0.75 / fixed 18px, always bold via `<b>` (`Headline.vue:20-32`, `_typography.scss:14-46`). Default heading size 32px.
- Paragraph is `--body-font-size` (default 16px) at line-height 1.5.
- Button base is `padding: 13px 30px`, 16px bold, `border-radius: 40px` (`_buttons.scss:1-15`). Radius, border, size preset and drop shadow come from the element's own `styles.*` when `settings.appearance.overwrite` is true, else from `theme.settings.appearance.buttons` (`Button.vue:146-178`). `styles.theme.colors` is always element-local. Size preset `normal` is `13px 30px`, `large` is `21px 63px`. Icon 18px with a 10px gap.
- Image `styles.width {type: custom, value: N}` is `width: 100%; max-width: Npx` on the img; `full` is `width: 100%`; `default` is natural size capped at 100% (`appearance.js:17-20`). Radius and border follow the same overwrite-vs-theme rule against `theme.settings.appearance.thumbnails`.
- Section `textTheme` light/dark/custom paints `#fff`/`#000`/`textThemeColor` on the section, but only when the background is image, custom-color or gradient (`Row.vue:97,125-127`).
- Hub theme `fonts.headingFontSize` and `fonts.bodyFontSize` set `--heading-font-size` and `--body-font-size` (`App.vue:159-164`).

V3:

- `surface.padding` accepts a token or any string; a non-token string goes verbatim into `style.padding` (`node-surface.tsx:1325-1341`). Same for `surface.borderRadius` and `surface.margin` (freeform, negative margin allowed, `node-surface.tsx:1348-1352`).
- `stack.align` is `align-items` (horizontal for a column), default `stretch`; `stack.justify` is `justify-content`, `start | center | end | between` (`stack.tsx:179-192`). `row.align` default `center`, `row.gap` enum `1 1.5 2 2.5 3 4 5 6 8 12 section` in 4px units.
- `stack.gap` enum `0 0.5 1 1.5 2 2.5 3 4 5 6 8 12` = 0/2/4/6/8/10/12/16/20/24/32/48px.
- `headline.level` 2 = `--hub-font-heading-size` (32px), 3 = 24px, 4 = 20px; `weight` default 400; `align` left/center/right. `size: 'large-title'` is 42px and documented as landing-page only.
- `text.marginBottom` defaults to 2 (8px) unless set; `size` body 16px.
- `button` has `variant`, `size` (sm 32px / md 40px / lg 46px tall, 8 / 12 / 14px horizontal padding, radius 9.6 / 12 / 14.4px, 16px normal weight for md and lg), `icon`, `iconRight`, `fullWidthMobile`, `newTab`, `action`. No radius, border, shadow, padding, weight, colour or alignment.
- `image.maxWidth` is `352 | 128` only; `alignX` `center | start`; `radius` `control` 12px / `control-l` 14.4px / `m` 24px; `backdrop: false` removes the opaque fill under the image; `objectFit: 'contain'` forces natural mode.
- `surface.ink` is `auto | light | dark`; no arbitrary colour.
- Branding has `heading_font_size` and `body_font_size` (`mio-hub/src/lib/hub-shape/branding.ts:137`).
- No background position, no per-node margin-top, no image `none` radius.

ManTalks numbers (bundle survey): 203 level-1 sections, 223 columns (46 with `align: center`, 1 `top`), 161 headlines (118 large, 43 medium), 164 paragraphs, 80 images (22 overwrite appearance, width values 250 to 1000), 79 buttons (0 overwrite, 58 with own colours). Hub theme: buttons radius 0 on all corners, drop shadow large, size not set; thumbnails radius 30.

## 3. Architecture

Two pure layers replace the ad-hoc functions in `src/map/style.ts`.

```
legacy section tree + theme.settings
        │
        ▼
src/map/profile/          "what the legacy renderer would paint", in px and CSS terms
  hub.ts                  HubStyleProfile from theme.settings
  section.ts              SectionProfile, ColumnProfile
  element.ts              ElementProfile (headline, text, image, button)
  rhythm.ts               visible gap between neighbouring elements
        │
        ▼
src/map/translate/        "the nearest thing V3 can draw", plus what was lost
  surface.ts              padding, radius, shadow, ink, background
  stack.ts                column stack settings, button wrapper stacks, rhythm wrappers
  leaf.ts                 headline, text, image, button settings
  fidelity.ts             FidelityEntry and the snapping helpers that emit them
        │
        ▼
sections.ts / elements.ts call profile then translate; style.ts keeps only
what is not style (BUTTON_ICONS, instantiateRecipe, dominantButtonColour).
```

A profile never mentions V3. A translator never reads legacy JSON. The seam is the profile types, which is what the tests pin.

## 4. Profiles

### 4.1 HubStyleProfile

Read once per map from `bundle.theme.settings`.

| Field | Source | Default |
| --- | --- | --- |
| `headingFontSize` | `fonts.headingFontSize` | 32 |
| `bodyFontSize` | `fonts.bodyFontSize` | 16 |
| `button` | `appearance.buttons` resolved to `ButtonChrome` | base chrome |
| `thumbnail` | `appearance.thumbnails` resolved to `ImageChrome` | radius 0, no border, no shadow |
| `colours` | existing `themeColours` | |

`ButtonChrome` is `{ paddingY, paddingX, radius: [tl, tr, br, bl], border: {width, colour, style} | null, shadow: 'small' | 'medium' | 'large' | null, fontSize: 16, fontWeight: 700 }`. Resolution: padding from `size.show && size.type` (`normal` 13/30, `large` 21/63, else 13/30); radius from `cornerRadius.show` (per-corner values, default 40 each) else 40; border from `border.show`; shadow from `dropShadow.show && dropShadow.size`.

`ImageChrome` is `{ radius: [tl, tr, br, bl], border, shadow }` with default corners 0.

### 4.2 SectionProfile (level 1)

| Field | Rule |
| --- | --- |
| `padding` | `{top, right, bottom, left}` px. `styles.padding.show` true: each side from `styles.padding.<side>` (parseInt, missing side is the default 50/0/50/0). Otherwise 50/0/50/0. |
| `ink` | `'light' | 'dark' | { hex }` or null. Only when `background.type` is `image`, `custom-color` or `gradient`: `textTheme` light → `'light'`, dark → `'dark'`, custom → `{ hex: textThemeColor ?? theme colours.secondary }`. Else null. |
| `gutter` | 20 (constant, from the SCSS) |
| `background`, `visibility`, `blur` | as today |

### 4.3 ColumnProfile (level 2)

| Field | Rule |
| --- | --- |
| `widthPct` | `settings.size` number, default `100 / siblingCount` |
| `justify` | `styles.align`: `center` → `'center'`, `bottom` → `'end'`, else `'start'` |
| `padding` | `{top,right,bottom,left}` px when `styles.padding.show`, else null. Raw values, not the +10 gutter offset (that offset exists to preserve legacy's own gutter and V3's row gap already provides one). |
| `radius` | four corners px when `styles.cornerRadius.show`, else null |
| `shadow` | `dropShadow.size` when shown, else null |
| `background` | as today |

### 4.4 ElementProfile (level 3)

Common: `align: 'left' | 'center' | 'right'` from `settings.align` (default left); `marginTop` px from `margins.top` (default 30); `bottomMargin` px by kind (headline large/medium 20, small 10, text 20, image 0, button 0, divider 0).

| Kind | Fields |
| --- | --- |
| headline | `level` 2/3/4 from size large/medium/small (default large); `fontSize` = headingFontSize × 1 / × 0.75 / 18 |
| text | nothing beyond common |
| image | `maxWidth` px or null (`width.type` custom → value ?? 400; full → null with `fill: true`; default → null); `chrome: ImageChrome` (element `styles.*` when `appearance.overwrite`, else hub thumbnail chrome); `transparent` from `thumbnail.is_thumbnail_transparent` |
| button | `chrome: ButtonChrome` (element when `appearance.overwrite`, else hub); `fullWidth` from `styles.width.type === 'full'` or `fullSize`; colours from `styles.theme` as today |

### 4.5 Rhythm

For a column's visible elements `e0..en`, `gapBefore(e0) = e0.marginTop` (usually 0) and `gapBefore(ei) = max(e(i-1).bottomMargin, ei.marginTop)` for i ≥ 1. Hidden elements are skipped before computing. This is what the browser shows after margin collapse.

## 5. Translation

### 5.1 Section surface

- `surface.padding`: `'${top}px ${right}px ${bottom}px ${left}px'`, collapsed to CSS shorthand when sides repeat (`'150px 0'`). Always emitted, including the 50/0 default, because the V3 `section` token is 40/24 and the goal is desktop fidelity. Fidelity entry: none (exact on desktop; the legacy 30px mobile drop is documented in section 8, not per section).
- `surface.ink`: `'light'` / `'dark'` direct; `{hex}` → relative luminance ≥ 0.5 → `'light'` else `'dark'`, with a fidelity entry `ink: #F7F2E8 → light`.
- Inner row: `{ gap: 5, mobileGap: 6, align: 'stretch', wrap: true, responsive: true }`. Gap 5 is 20px, exact. Fidelity entry for mobileGap (24 vs 20) is not raised; below the threshold in 5.6.
- Container stays `{ maxWidth: 'content', padding: 0 }`. V3's content cap is 1240px with a 40px gutter; legacy content is 1240px inside 1300. Same content width, exact.

### 5.2 Column stack

- `width` via the existing `stackWidthFor`.
- `justify`: `'center'` or `'end'` when the profile says so; omitted for `start`.
- `align` omitted (stretch), so headline and text keep full width and their own `text-align` works.
- `gap`: the rhythm gap that occurs most often among `gapBefore(e1..en)`, snapped to the nearest stack enum value. A column with one element gets `gap: 0`.
- Surface: `padding` as freeform px shorthand, `borderRadius` as freeform `'${tl}px ${tr}px ${br}px ${bl}px'` shorthand, `shadow` small/medium/large → sm/md/lg, background as today.

### 5.3 Element placement inside the stack

Elements are emitted in order. Two kinds of wrapper stacks exist and one node can need both, in which case a single wrapper carries both settings.

- Button run wrapper: a maximal run of consecutive buttons with the same `align` becomes one `stack { align: start|center|end, gap: <snapped run gap> }`. A lone button gets the same wrapper with `gap: 0`. Without it a button stretches to the column width under `align-items: stretch`.
- Rhythm wrapper: when `|gapBefore(ei) − stackGap| > 4`, the element (or the run wrapper it sits in) gets `surface.margin: '${gapBefore − stackGap}px 0 0'`. Negative values are legal. For a run, the run's `gapBefore` is the first button's.
- Images need no wrapper: `alignX` handles centre, and `start` is the default.

The first element is treated like any other: `gapBefore(e0)` is its own `marginTop` (0 in almost every column, since the editor writes 0 there), and past the threshold it gets a rhythm wrapper with `surface.margin: '${gapBefore}px 0 0'`. In legacy that margin sits inside the column's flex item, so it adds to the item's height and shifts a centred column the same way; the wrapper reproduces that.

### 5.4 Leaves

Headline: `{ level, weight: 700, align }`. `size` is never set. Fidelity entry when `level` 4 (20px vs legacy 18px).

Text: `{ align, marginBottom: 0 }`, plus the existing formatting flatten. Line-height 1.5 vs V3's 1.3 is documented, not per node.

Image: `{ alt, aspectRatio: 'auto', objectFit: 'contain', alignX, radius, backdrop, outline }`.
- `maxWidth`: profile maxWidth ≤ 128 → 128; ≤ 352 → 352; larger → omitted. Fidelity entry with the px delta when the emitted cap differs from the legacy one by more than 16px, or when omitted and the legacy cap is below the column's content width at 1240 (column width × widthPct − gutter).
- `radius`: mean of the four legacy corners → nearest of 12 / 14.4 / 24 → `control` / `control-l` / `m`. Fidelity entry when the legacy mean is 0 (V3 cannot draw a square image) or differs by more than 4px.
- `backdrop: false` when `transparent`.
- `outline: true` when the chrome has a border; fidelity entry carrying the legacy width/colour (V3 draws a 1px hairline).

Button: `{ action, variant: 'primary', size: 'lg', newTab, icon | iconRight, fullWidthMobile }` as today. One fidelity entry per distinct `ButtonChrome` seen on the hub (keyed by its JSON), listing padding 13/30 → 14 horizontal in a 46px box, radius, shadow, weight 700 → 400, and the button count. Per-button colours keep the existing `dominantButtonColour` path; a button whose colours differ from the dominant pair gets a fidelity entry.

### 5.5 Hub branding

`mapBranding` gains `heading_font_size` and `body_font_size` from the hub profile when the legacy theme sets them. ManTalks sets neither, so both stay at 32/16 and nothing changes on the wire for this hub.

### 5.6 Fidelity entries

```ts
interface FidelityEntry {
  pageSlug: string | null;
  legacySectionId: number | null;
  property: string;          // 'section.padding.mobile', 'button.chrome', 'image.maxWidth', 'image.radius', 'ink', 'headline.size', ...
  legacy: string;            // '0px radius, 13px 30px, shadow large, bold'
  v3: string;                // 'size lg: 14.4px radius, 14px x 46px, no shadow, weight 400'
  count?: number;            // for hub-wide entries
}
```

Entries ride in the plan as `PlanWarning` with `type: 'fidelity'` and `reason` = `${property}: ${legacy} -> ${v3}`; the structured fields are added to `PlanWarning` as optional `property`, `legacy`, `v3`, `count` so the report can group them. Threshold: a numeric difference of 4px or less is not an entry. `map` prints, after the existing warning summary, one line per property: `fidelity button.chrome: 0px radius, 13px 30px, shadow large, bold -> lg (14.4px, 14px x 46px, no shadow, 400): 79 buttons`.

## 6. What changes in the code

- New: `src/map/profile/{hub,section,element,rhythm}.ts`, `src/map/translate/{surface,stack,leaf,fidelity}.ts`.
- `src/map/style.ts` keeps `BUTTON_ICONS`, `dominantButtonColour`, `instantiateRecipe`, `surfaceBackgroundFor`, `stackWidthFor`. `surfacePaddingFor`, `sectionSurfaceFor`, `columnSurfaceFor`, `layoutRowSettings`, `headlineSettingsFor`, `textSettingsFor`, `imageSettingsFor`, `buttonSettingsFor` move into the translate layer or are deleted.
- `sections.ts`: `blockNode` for `column` and the "columns of elements" branch of `mapSection` use the profile and translate layers; `MapContext` gains `hubProfile: HubStyleProfile` and `siblingCount`.
- `elements.ts`: `mapElement` returns the node plus its `ElementProfile` so the column translator can run the rhythm; `featuredSection` uses the same leaf translators for its headline/text/button.
- `plan.ts`: `PlanWarning.type` gains `'fidelity'` and the optional structured fields. `planVersion` bumps.
- `cli/map.ts`: fidelity summary lines.
- `branding.ts`: font sizes.

The node id scheme (`nodeId(hub, page, section, ordinal)`) does not change. Wrapper stacks mint ids with `EXTRA_ORDINAL_BASE + n` per legacy element, the way `featuredSection` already does. A rerun of `map` on the same bundle yields the same ids, so `apply --resume --accept-plan-change --rewrite-pages` replaces page trees in place.

## 7. Testing

- Profile unit tests, one file per profile module, table-driven on legacy JSON fragments: padding show/hide and partial sides; column align top/center/bottom/undefined; headline sizes; button chrome overwrite vs theme, size presets, radius defaults; image width types; rhythm with the hero's real margins (0/0/0/30 and bottoms 20/20/0/0 → gaps 20/20/30).
- Translate unit tests: padding shorthand collapse; ink luminance both sides of 0.5; gap snapping to every enum value; run wrapper for one, two, mixed-alignment buttons; rhythm wrapper only past the 4px threshold, negative margin; image maxWidth ladder and each fidelity trigger; button chrome entry deduplicated per hub.
- Golden test: `tests/fixtures/sections/hero-row.json` is the ManTalks section 3398809 tree with copy replaced by placeholders and the same settings JSON; `tests/fixtures/sections/hero-row.expected.json` is the V3 node tree. The test also asserts the fidelity entries the hero produces (button chrome, image maxWidth 250 → 352, ink custom → light) and nothing else.
- Existing tests keep passing after the moves; `style.test.ts` shrinks to what stays in `style.ts`.
- Real run: `map` on the current ManTalks bundle, then `apply --dry-run`. On the user's go, `apply --resume run-2026-09-11T19-49-29-036Z-b3f055c6 --accept-plan-change --rewrite-pages`, then a Playwright screenshot of `https://hub.member.dev/alliance/home-page` at 1440px as the hub member, compared by eye against the legacy shot in this session. Acceptance is the four hero measurements: 150px top and bottom padding, left-aligned copy vertically centred in its column, 32px heading, gaps 20/20/30.

## 8. Known limits, decided now

| Limit | Why | What the mapper does |
| --- | --- | --- |
| Button radius, padding, shadow, border, weight | V3 button has only `variant` and `size` | `size: 'lg'`, one fidelity entry per chrome |
| Image cap outside 128/352 | whitelist | nearest or none, fidelity entry with the delta |
| Square images | image radius has no `none` | `control` (12px), fidelity entry |
| Mobile padding | legacy drops default padding to 30px under 768px; freeform px does not | desktop exact, mobile keeps the desktop value; documented here only |
| Background position | no V3 setting | dropped silently; V3 centres |
| Text line-height 1.5 vs 1.3 | token | documented, no entry |
| Headline small (h4 18px) | level 4 is 20px | level 4, fidelity entry |
| Column-67 | legacy has no CSS for it either (falls to `flex: 1 0 0`) | `2/3`, no entry |
| Personalisation tokens in copy | existing M1 limit | existing `approximated` warning |

## 9. Out of scope

Asset copy, the `featured` band's own layout beyond reusing the leaf translators, playlist and card sections (they take catalog recipes and have no legacy element styling), `line-break`, `embed-code`, `video`, `input`, mobile-specific fidelity, any change to V3 or searchie.
