# Renderer map: where each fact lives

Established 2026-09-12 by reading both renderers. Line numbers drift; the file names hold.

## Legacy, `/Users/alkein/Developments/mio-projects/searchie`

| Concern | File | Fact |
| --- | --- | --- |
| Section root, padding, background, text theme | `resources/modules/hub/js/Components/Section/Row.vue:85-127` | base padding 50px 0 from `sass/sections/_columns.scss:1-6`; inline px per side when `styles.padding.show`; `textTheme` light/dark/custom paints an inline `color` only over image, custom-color or gradient backgrounds |
| Inline style builder (padding, width, radius, border, shadow, theme colours) | `resources/modules/hub/js/utils/appearance.js:14-90` | `size.type` normal 13px 30px, large 21px 63px; corners per side; border; drop-shadow class |
| Column width and vertical alignment | `Components/Section/Row/Column.vue:58-101`, `sass/sections/_columns.scss:17-75, 375-394` | `styles.align` top/center/bottom is `justify-content`; `size` 100/50/33/25 have CSS, 67 does not; 20px gutter |
| Element wrapper: margin-top, horizontal align | `Components/Section/Row/Item.vue:56-79` | `margins.top` default 30 inline; `settings.align` left/center/right is text-align; first element of a column gets 0 (`Editor/Pages/Sidebar/Elements/Create.vue:216`) |
| Headline sizes | `Items/Headline.vue:20-32`, `sass/_typography.scss:14-46` | large h2 = heading size (32), medium h3 = 0.75x, small h4 = 18px; always bold; bottom margin 20 (h4 10) |
| Paragraph | `Items/Paragraph.vue`, `sass/_typography.scss:67-77` | body size 16, line-height 1.5, bottom margin 20 |
| Image | `Items/Image.vue:66-88` | `width.type` custom = width 100% max-width Npx; radius and border from the element when `appearance.overwrite`, else `theme.settings.appearance.thumbnails`; no backdrop |
| Button | `Items/Button.vue:118-178`, `sass/_buttons.scss:1-15, 61-75` | base 13px 30px, 16px bold, radius 40, `var(--primary-color)`; chrome from the element when `appearance.overwrite`, else `theme.settings.appearance.buttons`; `styles.theme.colors` always element-local; icon 18px, 10px gap |
| Tiles (grid, scroll, content-grid blocks) | `Components/Section/Grid/CustomGridBlock.vue:3-47, 325-372` | whole tile is the anchor; image background; `showTitle`; no button; `grid-playlist` links to the playlist, `grid-page` to the page, `grid-url` to `link.url` |
| Which sections list files instead of tiles | `Components/Section/Compact.vue:131-142`, `Carousel.vue`, `Search.vue` | compact/playlist/recently-watched/carousel/search list a playlist's files |
| Image background overlay | `sass/_common.scss:262-277` | `.variant-image:before` at opacity 0: no tint |
| Hub theme keys | `hub_theme.settings` (see `app/Models/HubTheme.php`) | `fonts.headingFontSize/bodyFontSize`, `appearance.buttons.*`, `appearance.thumbnails.*`, `colors.*`, `sections.header.*` |
| Playlist thumbnail | `app/Models/Playlist.php:280-292`, `app/Services/ThumbnailService.php` | own `featured-images` media, else first file's thumbnail |
| Editor panels (what an author can set) | `resources/2.0/js/modules/Hubs/Editor/Pages/Sidebar/**` | Elements/Appearance/Button.vue:40-61 is the button panel |

## V3, `/Users/alkein/Developments/mio-projects/mio-hub`

| Concern | File | Fact |
| --- | --- | --- |
| Every setting, its enum and CSS | `src/lib/page-tree/settings-registry.ts` | authoritative; the mio skill's tables are stale |
| Surface: padding, radius, margin, ink, scrim, backdrop, visibility | `src/components/primitives/node-surface.tsx` (`resolvePadding` ~1325, `scrim` 110-121), `src/lib/page-tree/surface-class-maps.ts` | `surface.padding`, `borderRadius`, `margin` accept freeform CSS strings; `ink` is auto/light/dark only; `scrim: false` removes the image tint |
| Container (maxWidth, its own padding default 4) | `src/components/primitives/containers/container.tsx:46` | always write `padding: 0` on section roots; `maxWidth: 'content'` = 1240px |
| Row | `containers/row.tsx:129-211` | `gap` 4px units, `align` default center, `responsive`, `wrap`, `split` |
| Stack | `containers/stack.tsx:160-310` | `gap` enum, `align` is align-items (horizontal), `justify` is vertical, `width` grow ratios |
| Headline | `leaves/headline.tsx:107-150` | level 2 = 32px, 3 = 24px, 4 = 20px; weight default 400; no colour setting |
| Text | `leaves/text.tsx:189-199, 340` | plain text only; `marginBottom` default 2 (8px); sizes body/small/body-big |
| Image | `leaves/image.tsx:83-167`, `ui/thumbnail.tsx:84-88` | `maxWidth` 352 or 128 only; `radius` control/control-l/m; `backdrop`; `objectFit: contain` = natural mode |
| Button | `leaves/button.tsx`, `ui/button.tsx:94-107`, `src/app/globals.css:299-302, 1101` | `variant` and `size` only; lg = 46px, 14px sides, hardcoded radius; no branding radius key |
| Content card, data sources, collection scope | `containers/content-card.tsx:78-90`, `src/lib/page-tree/renderer.tsx:196-247`, `src/lib/page-tree/data-binding/use-data-source.ts:96-112, 398-432, 923-1030` | a card navigates only via `actionFromScope`; a non-repeating `playlist` source gives title, cover, action; `page` sources resolve nothing on the client yet |
| Catalog starters and variants | `/Users/alkein/Developments/mio-projects/mio-page-catalog/catalog.json` | `compact` is the "Scroll" section; its starter is headline + `horizontal-scroll` of `content-card`; `defaults` blocks are NOT applied by the renderer |
| Playlist cover | `mio-backend app/content/schemas.py:204-211`, `app/content/service.py:297` | `cover_url` read-only, derived from the playlist's files |
