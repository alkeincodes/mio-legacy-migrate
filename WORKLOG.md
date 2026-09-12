# Worklog

## 2026-09-12: M1 plan executed, 26 of 26 tasks

All tasks in `docs/superpowers/plans/2026-09-12-legacy-hub-migration-m1.md` are
coded and committed. Suite: 341 tests, typecheck clean.

Verified for real:
- `extract --check-access` against the production replica through the SSH
  tunnel. The tunnel works. The replica refused the login for the user in
  `.env`, so the read-replica credentials still need sorting out.
- `map` against the live catalog 0.23.6 on a synthetic bundle built from the
  test fixtures: zero `dropped`, no catalog validation warnings.
- `apply --dry-run` on that plan: contracts gate, catalog digest check and the
  16-operation render all pass. Nothing mutated.

Not yet run (need `.env` values): the real bundle capture, map of the real
bundle, `apply --dry-run` on it, `apply --check-access`, any real apply, and
`verify`. Also outstanding: posting the section mapping table to Mihai for
review (Task 10 step 7), and creating the two authorization test members.

Deviations from the plan worth knowing:
- The plan's orchestrator only carried the hub and asset stages. The other ten
  are in `src/apply/stages.ts`, written against mio-backend's real routes.
- Segments are not created in M1: V3 needs a typed condition tree and no
  legacy mapping exists. Dependent access rules are skipped and their pages
  stay unpublished. See `docs/contracts.md`.
- Navigation url items must be root-relative on V3; off-site links are
  dropped with a run warning in `runs/<runId>/apply-warnings.json`.
- Favicon conversions force png; every other searchie conversion keeps the
  original extension.
- The plan carries `legacyHubDomain`, so nothing hardcodes the pilot origin.

## 2026-09-12, later: real extract, map and dry-run

The 1045 was dotenv cutting an unquoted `#` out of the password. `loadEnv`
now warns on that shape. With the password quoted:

- `extract --check-access` passes; legacy hub id is 38827.
- `extract alliance.mantalks.com --skip-s3` captured 31 pages, 1085 sections,
  67 playlists (708 items), 517 files, 1475 media rows, 1801 asset variants,
  64 discussion categories, 4 achievements, 9 segments. Manifest unpinned:
  run `extract --s3-only <bundle>` once the AWS values land, then map again.
- `map` against catalog 0.23.6: 0 dropped, 13 approximated (7 legacy
  `input` elements, 3 onboarding steps, 2 embed-codes, 1 fonts note), no
  catalog validation warnings. Branding maps colours, dark mode, logo and
  favicon. 15 access rules, all `in_segment`.
- `apply --dry-run`: 2075 operations, 26 page publishes, 5 holds (pages
  gated by segments V3 cannot express yet), 1374 asset copies, 427 videos
  pending import, 9 segments and 15 rules skipped.

Found and fixed on the real data: mysql2 parses JSON columns into objects, so
every mapper `JSON.parse` had been failing quietly (now `jsonStrings` on the
connection plus tolerant parsers); legacy menu links live in `settings.url`
as a TipTap document; section background images are plain URL strings; the
theme does carry fonts (reported, not mapped). `apply --dry-run` needs no
`.env`; a real apply logs in as the verify user when no API key is set.

Still not run: `extract --s3-only`, `apply --check-access`, any real apply,
`verify`. No apply has touched the target.

## 2026-09-12, AWS values in: pin, map, check-access

- `extract --s3-only` pinned all 1801 variants, 0 HeadObject misses; every
  object versioned with a CRC64NVME checksum. 188 GB total, 187 GB of it video
  (pending import in M1).
- `map` on the pinned bundle: same 13 approximated, 0 dropped.
- `apply --check-access`: the login as the verify user works (JWT, 900 s).
  The probe copy failed with NoSuchBucket: `profiles/mantalks-prod.json`
  names `mio-media-production` and `https://miocdn.membership.io`, both
  guesses the plan flagged as unconfirmed. The real production media bucket
  and CDN base come from the backend's `MIO_S3_BUCKET` / `MIO_CDN_BASE_URL`
  env, not the repo; the demo team has no files yet to read a CDN host from.
  check-access now says which bucket is missing before trying the copy.
- Stopped there per the lead's order; `apply --dry-run` on the pinned plan
  was not rerun (it needs no `.env` and does not depend on the bucket).

## 2026-09-12, V3 bucket confirmed

- `profiles/mantalks-prod.json` bucket is `mio-backend-assets-production`
  (confirmed by the backend team); `cdnBaseConfirmed: false` until someone
  checks `https://miocdn.membership.io` against a real V3 media URL.
- A separate V3 AWS principal (`V3_AWS_ACCESS_KEY_ID` / `V3_AWS_SECRET_ACCESS_KEY`)
  serves every call on the V3 bucket, CopyObject included, so it also needs
  `s3:GetObject` on the legacy bucket. Empty pair: legacy pair with a warning.
- `apply --check-access` with the legacy pair only: login OK, both buckets
  exist, cdnBase printed, probe copy refused by IAM (the legacy user
  `searchie_production` has no `s3:PutObject` on the V3 bucket). Nothing was
  written; the member check did not run. Needs the V3 pair in `.env`.
- `apply --dry-run` on the pinned plan: unchanged, 2075 operations.

## 2026-09-12, --skip-assets, --assets-only, --hub-slug, --publish-held

- New ledger asset state `pending-copy` with recorded references (page nodes,
  playlist items). `apply --skip-assets` registers and copies nothing; public
  page images and videos that pass the prefilter go `legacy-linked`.
  `apply --assets-only --resume <run>` copies what was left and reruns the
  playlist and page-tree stages to rewrite references by content hash.
- Hub slug comes from the plan (custom subdomain, else domain label), with
  `--hub-slug`; the backend auto-suffixes a globally taken slug with a 200,
  so the hub stage stops if the assigned slug differs. Team has zero hubs.
- `--publish-held` publishes segment-gated pages and lists them as
  published-ungated with the legacy segment names, in the ledger, the run
  dir and the verify report.
- Real data: legacy image elements store their picture as
  `settings.thumbnail.url`, an App\\Hub media row in the `thumbnails` or
  `background-images` collection. Extract now carries every Hub-owned media
  outside the branding collections. Manifest grew to 3079 variants (3065
  pinned, 14 misses: unreferenced `optimized_image*` conversions).
- Dry run with `--skip-assets --publish-held --hub-slug alliance`: 3339
  operations, 62 legacy-links (55 images, 7 videos; every page image), 2582
  pending-copy, 421 pending-import, 26 publish, 5 publish-ungated, URL
  https://hub.member.dev/alliance. Plan warnings back to 13, 0 dropped.
- Latest pinned plan: plans/hub-38827-25f604b168ef.json. Still no real apply.

## 2026-09-12, first real apply on mantalks-prod

Run `run-2026-09-11T19-49-29-036Z-b3f055c6`, `apply --skip-assets
--publish-held --hub-slug alliance`. Hub 01a09204-a0ac-76e2-9658-cc9bc9e1b42f
at https://hub.member.dev/alliance (slug assigned as requested).

Three stops on the way, each fixed and resumed under `--accept-plan-change`
(which refuses unless every done entry hashes identically under the new
plan): page slug `onboarding` reserved (the backend reserves 23 slugs; now
mirrored exactly in the mapper), then `discussions`, then the `content` page
must be V3 type `content` at slug `content`. Final ledger: hub 1, folders 19,
playlists 67, pages 31 (26 published, 5 published-ungated), spaces 64,
achievements 4, assets 62 legacy-linked / 2582 pending-copy / 421
pending-import, 0 intent. 1196 run warnings (1163 asset-pending playlist
items, 28 approximated, 5 access-unmapped).

Verify: pages 31/31, playlists 67/67, folders 19/19 on target; every page's
published tree digest matches the ledger except `/content`, whose published
tree reads as empty (V3 renders the content page itself). Not accepted:
- the 4 browser playback checks failed, and the V3 side of the contact sheet
  shows the login wall. The verify user v3demo is a team admin, not a hub
  member; hub member login is the contact identity. A member login for the
  verify user (or a test member) is needed before the contact sheet and
  playback checks mean anything.
- authorization checks skipped: the two test members do not exist.
Artifacts (local, gitignored): runs/<runId>/report.md, contact-sheet.html
(124 shots, legacy side logged in correctly), playback.json,
published-ungated.json, apply-warnings.json.

Next: a hub member identity for verify; `apply --assets-only --resume <run>`
once the V3 AWS pair is in .env; then re-verify.

## 2026-09-12, content fixes after the first verified render

The first contact sheet with a hub member login showed placeholder words
("Headline", "Paragraph", "Button") on every page. On the real hub the
`label` column is the element's display name; the text is TipTap JSON in
`title` (headline), `settings.value` (paragraph) and `settings.link.url`
(links), the button label is `settings.link.label`, and a button's or card's
page/playlist/file target is the row's `model_type`/`model_id`. `src/map/tiptap.ts`
converts documents; the V3 text node shows HTML literally, so paragraphs are
plain text and formatting loss is an approximated warning.

Also from the render: an image element that links a video File shows its
thumbnail conversion, not the video; file cards must reference the asset (a
legacy file id sent as a V3 content id 404s); links to reserved built-in
routes (discussions, login, ...) stay on the built-in route; the caption
check ignores disabled, src-less tracks.

Re-applying corrected trees needs `--accept-plan-change --rewrite-pages`
(page trees may differ; everything else must still hash the same). Each
rewrite republishes up to 31 pages against the 60/hour publish limit, so
consecutive rewrites wait for the window. The verify user must be a HUB
MEMBER (`V3_VERIFY_LOGIN_*`); the API keeps a platform user
(`V3_PLATFORM_LOGIN_*`).

Final verify of the run (2026-09-12 ~21:55 UTC): pages 31/31, playlists
67/67, folders 19/19; tree digests match on 30 of 31 pages; browser playback
3 of 3 OK; contact sheet 124 shots with the hub member logged in. Not
accepted for two reasons only: `/content` shows 0 sections on the target (V3
renders the content page itself, so the one migrated section is ignored) and
the authorization matrix is skipped until the two test members exist.

## 2026-09-12, styling parity pass

The user's bar: a member should not notice the move. The mapper now emits
each legacy section in the catalog's own recipe shape (`mio pages catalog
scaffold` output, vendored under `src/map/recipes/`): container + template +
surface (padding scale from legacy pixels, background as custom hex / image /
explicit none, per-device visibility) around a layout row of stacks whose
width comes from the legacy column percentage. Playlist grids and strips are
the data-bound catalog recipes with the legacy section title on top; page and
url cards carry their picture and a styled button; headlines get weight and
size, images show whole at their legacy width, buttons get size and a sprite
icon. `src/map/style.ts` holds every translation.

Theme: the legacy dark theme forces V3 `settings.background.type = custom`
with `branding.background/text/header_color/header_accent`; the colour most
legacy buttons share (#5770D1) is the V3 primary, reported as approximated.

Known gaps after this pass: segment-gated rows all render under
`--publish-held` (the home hero shows twice, one per legacy member segment);
playlist strips are empty until `apply --assets-only` attaches items; text
formatting inside paragraphs (bold, links, lists) is flattened because the V3
text node shows tags literally; personalisation tokens render literally.

## 2026-09-12 (later): segment gating and button icons

The user asked why the home hero renders twice and why the "5-Day Challenge"
button lost its icon. Cause of the first: the legacy home page carries four
hero rows, a desktop and a mobile one for each of the "Post 30 Days" and "First
30 Days" audience segments, and V3 segments were never created, so
`--publish-held` published every row open. Cause of the second: the legacy
glyph `target` is not in the hub sprite and the icon map dropped it.

Fix. `src/map/segments.ts` flattens a legacy segment's and/or tree to the V3
OR-of-AND form and maps `date_registered less_than|more_than N` to
`hub_time_since_joining lte_days|gte_days N` and `tags equals|not_equals` to
`has_tag has|has_not` by slug. A new `tags` stage creates or adopts the team
tags a segment names. The access rules stage now creates rules with
`target_type: node` (the renderer resolves a gate by hub, node, node id; the
old `section` target never matched) and the page tree stage stamps the rule id
on the section as `access_rule_id`. Attribute-based segments (the three
pathways and "No Profile Details") stay unmapped because attribute definitions
are not extracted; they gate only the archived home page. The icon map gains
the nearest sprite for every legacy glyph the hub uses (target to
star-circle, circle-right to circle-arrow-right, and so on).

Dry run of the new plan (`plans/hub-38827-60cc252c7a3c.json`): 3 tags, 5
segments, 12 rules, 30 pages published gated, 1 published ungated (Home -
Archived). Not applied yet; needs the lead's go for
`apply --resume run-2026-09-11T19-49-29-036Z-b3f055c6 --accept-plan-change
--rewrite-pages --skip-assets --publish-held --hub-slug alliance --profile
mantalks-prod`. Note for verify: the hub member alkein@membership.io joined
under 30 days ago, so after the apply they see the "First 30 Days" hero
(Start Here), not the "Post 30 Days" one the user called correct.

## 2026-09-12 (later still): exclusions, built-in homepage, header colour

Lead's GO for the resumed apply came with two additions, and the user flagged
the header colour. Legacy login, register, onboarding and discussions pages
are now excluded by default (`map --exclude-pages`, warning type `excluded`);
links to them resolve to V3's built-in routes, their menu items drop (the
COMMUNITY item stays as V3's typed discussions item), and a new `removals`
stage deletes the four copies the first run created, marking their ledger
entries `removed` with the reason. The legacy homepage becomes the hub's
homepage through the typed descriptor written with the navigation PATCH; the
page stays at `home-page` because the descriptor needs a page and `home` is
reserved. Header: the legacy theme's `sections.header` is a custom colour
(#878C6A, accent #F7F2E8) and the mapper had used the page background; fixed,
with `dark_mode` now a boolean and Mulish mapped to `font_heading`/`font_body`.

Plan `plans/hub-38827-ebc05c331c95.json`: 27 pages, 4 excluded, 3 tags, 5
segments, 12 rules, 26 published gated, 1 published ungated (home-archived).

Applied for real on 2026-09-12 (lead's GO): resumed run
run-2026-09-11T19-49-29-036Z-b3f055c6 with the plan above, exit 0. Ledger:
tags 3, segments 5, rules 12, pages 26 published gated + 1 published ungated
(home-archived) + 4 removed (onboarding, login, register, discussions), hub
homepage descriptor set to home-page, header now #878C6A / #F7F2E8, Mulish.
Verify: pages 27/27, playlists 67/67, folders 19/19, playback 2/2, authz
skipped (no test members), one failure: /content shows 0 sections on the
target (the exemption decision is still with the user). Contact sheet skipped
(assets pending 2969). The hub member alkein@membership.io joined under 30
days ago and so sees the First 30 Days hero; a member older than 30 days or
tagged mantalks-team sees the other one.

## 2026-09-12 (evening): style fidelity

The home hero on hub.member.dev/alliance rendered 64px padding instead of
150px, centred copy instead of left-aligned, a 42px heading instead of 32px
and 16px gaps instead of 20/20/30. Root causes, read out of both renderers:
legacy column `styles.align` is vertical (justify-content), the mapper had
treated it as horizontal; section padding was snapped to a token although V3's
`surface.padding` accepts any CSS string; headline `large` was mapped to
`large-title`; text nodes carried V3's hidden 8px margin.

Built two pure layers under `src/map/profile/` (what the legacy renderer paints,
in px) and `src/map/translate/` (the nearest V3 settings plus a `fidelity`
warning for every value V3 cannot draw). Spec and plan under
docs/superpowers/. 524 tests. Branch `style-fidelity`.

Real map of bundle hub-38827-2026-09-11T19-31-09.475Z: plan
plans/hub-38827-f0831784bfc4.json, 27 pages, 236 warnings of which 166 are
fidelity: button.chrome x81 (0px radius, 13px 30px, shadow large, bold ->
lg), image.radius x69 (30px -> m 24px) and x4 (0px -> control 12px),
section.ink x55 (#F7F2E8 -> light) and x14 (#333333 -> dark), image.maxWidth
x22 (370 to 540px in a 600px column, no cap), image.border x1. The home-page
hero in that plan is `padding: '150px 0'`, `ink: light`, right stack
`justify: center` at gap 5, headline level 2, buttons in a start-aligned run
at gap 8. `apply --dry-run --resume run-2026-09-11T19-49-29-036Z-b3f055c6
--accept-plan-change --rewrite-pages` exits 0 with 3334 operations (the
dry-run renderer lists plan operations without consulting the ledger, so its
`page.create` lines are expected on a resume). Applied for real on 2026-09-12 (user's go): the resume above without
--dry-run, exit 0, 27 page trees rewritten and republished, ledger committed.
Measured live at 1440px as alkein@membership.io: section padding 150px 0,
stack justify center at gap 20px, headline 32px bold left, gaps 20 / 21 / 32.
Buttons are 46px tall, 10px radius, weight 400 (the recorded limit).

Also fixed on the way: `.gitignore` ignored `docs/superpowers/plans/` through
an unanchored `plans/`, so the M1 plan doc had never been tracked.

## 2026-09-12 (night): button chrome shell

The user flagged that the migrated buttons still had rounded corners where
legacy draws 0px. V3 has no radius knob anywhere: the button carries both
`rounded-lg` (10px, winning) and `rounded-control-lg`; `--control-radius-base`
and `--hub-radius-m` are constants in globals.css that no hub data feeds, and
the backend has no radius key. Mocked a fix on the live page in the browser
first: wrap the button in a shrink-wrapped stack whose surface is the fill
colour with `borderRadius: '0'`, `padding: '2px 16px'`, `clip: true` and the
legacy shadow. The V3 button's rounded fill sits inside a same-coloured square
box, so the visible shape is legacy's 50px by (w+32) rectangle and hover stays
clean. Built as `buttonShell()` in translate/leaf.ts; `mapElement` and the
featured band now return the shell stack with the button as its child; the
shell colour is the hex the V3 primary renders (dominant legacy button colour,
else the theme primary, else V3's default). Fidelity for buttons shrinks to
`button.weight 700 -> 400` (81) plus `button.border` when legacy had one.
527 tests.

Plan plans/hub-38827-dacb2cffe88e.json applied (resume, exit 0). Live:
shells 171x50 and 219x50, radius 0, fill #5770D1, overflow hidden, shadow on,
32px apart. Screenshot matches the legacy hero apart from the weight.

## 2026-09-12 (later): button shell reverted

Decision from the user: the script migrates hub data onto the V3 settings that
exist for it; where V3 has no setting (button radius, padding, shadow,
border, weight) that is V3's limitation, recorded as fidelity, not worked
around. The shell also froze the fill colour into the page tree, which would
drift the day the hub primary changes. Reverted (653b979), README rule
restated, plan f0831784bfc4 re-applied (resume, exit 0). Live buttons are
V3's lg again; `button.chrome` fidelity entry back, count 81.

## 2026-09-12 (night): image scrim off, grid and scroll tiles

Two more hero-page gaps. (1) The hero background was darker than legacy:
V3 composes a secondary-tint scrim over every image background unless the
background carries a literal `scrim: false` (node-surface.tsx:110-121);
legacy `_common.scss:262-277` paints its `.variant-image:before` at opacity
0. The section and column profiles now carry `imageOverlayOpacity: 0` from
the stylesheet and the translator emits `scrim: false` on image backgrounds.
(2) "Begin Training" rendered as a bare headline. The mapper had treated
playlist blocks inside grid/scroll sections like legacy Compact.vue ("list
this playlist's files"), emitting cards with `repeat` over a playlist source,
which V3 resolves to the playlist's FILES (all empty until assets land), and
it silently dropped the page and url tiles beside them. Legacy Grid.vue and
Scroll.vue draw one tile per block (CustomGridBlock.vue); V3 already has that
shape: a content-card bound to a playlist WITHOUT repeat gets the collection
scope (title, cover, click-through; renderer.tsx DataBoundContainer,
MIO-2335). `mapSection` now maps every block of a grid/scroll/content-grid
section in legacy order into the catalog Scroll (compact) or Grid starter
shape; compact/playlist/recently-watched/carousel keep the file-listing
recipes. Fixture `scroll-tiles.json` is the real section. 528 tests.

Applied plan hub-38827-d0b4d3a69ade (resume, exit 0) at 15:29Z. Live:
Begin Training is a 446px Scroll section with six cards, playlist titles and
playlist hrefs present, covers placeholder until the asset copy. Two
operational lessons: the tool budgets 60 page publishes an hour and a full
apply republishes 27 pages, so at most two full applies per hour; and after
a budget-stopped run the ledger is modified and MUST be committed before the
next apply, or the clean-ledger gate refuses it (an earlier queued apply died
on that with a misleading green wrapper exit).

