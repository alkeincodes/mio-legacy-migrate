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

## 2026-09-12 (late): tile links and playlist thumbnails

Legacy grid/scroll tiles are image-only anchors (`showTitle: false`, the
whole tile is the link; CustomGridBlock.vue). V3 has no clickable image tile
(content-card navigates only via a data-source scope), so the mapper had
emitted a full-width lg button labelled "Open" under every tile. Now: the
picture, the title only when legacy shows one (titles are TipTap documents,
read through parseDoc), and a compact secondary link button only when the
tile goes somewhere, labelled with the legacy label, else the tile title,
else the target page's title (new `pageTitleById`) or the url host; a `#`
tile is just the picture. Fidelity `tile.link` records the button per tile
(23 of them link straight to cdn.membership.io files and are labelled with
the host; a friendlier label is the user's call). Playlist covers: V3
`cover_url` is read-only and derived from the playlist's files, so covers
appear when the assets land; legacy playlists may also own a
`featured-images` thumbnail, which the extract never requested (media owners
were Hub, File, Section, Page). Playlist owners added to `fetchMedia`; a
re-extract through the box tunnel is pending. 529 tests.

Plans 892840274b74 (15:38Z) and 28de970ab0b1 (15:49Z) applied, exit 0.
Live: Begin Training shows three playlist tiles with titles and links,
the Attachment tile with a "Training: Attachment" link, two picture-only
tiles. Radar artifact of all recorded limitations:
https://claude.ai/code/artifact/c8596a7b-c09a-4839-a8e1-829e5744db52

## 2026-09-12 (later): tiles are pictures, no invented button

User's rule restated: legacy shows no button on a tile, so V3 shows none.
The link a legacy tile carries has no home in V3 (no clickable image tile),
so it is recorded as lost, with its target, under fidelity `tile.link`
(75 tiles on ManTalks). Only `carousel-cta` cards keep a button because
legacy draws one there. Plan hub-38827-c616706e9326 applied 15:54Z, exit 0,
6 pages rewritten. 529 tests.

## 2026-09-13: white edge on images

Every migrated image showed a pale sliver on its right edge. V3's Thumbnail
paints an opaque `bg-background` fill under the picture (MIO-288); with
`objectFit: contain` the image keeps its own ratio and can be a sub-pixel
narrower than its box, so a device pixel of white shows. Legacy paints
nothing under an <img>, and V3 has the setting for that: `backdrop: false`
(MIO-3086), which the translator had set only for transparent PNGs. Now set
for every legacy image. Plan hub-38827-b764036a1e45 applied 16:00Z, 10 pages
rewritten; the wrapper is `bg-transparent` on the live hub.

## 2026-09-13: legacy-gap project skill

Captured the loop used for every gap today as a project skill,
`.claude/skills/legacy-gap/` (SKILL.md, references/renderer-map.md with the
file:line facts for both renderers, references/apply-runbook.md with the one
resume command and its traps), plus a checked-in probe,
`scripts/probe/hub-probe.mjs measure|shot|images`. Written test-first: a
fresh agent without the skill planned a plain `apply` with no `--resume`
(which would create a second hub) and would have re-investigated the
recorded ink limitation; with the skill it quoted the resume command, checked
the radar first and named the right files.

## 2026-09-13: migrate command, second hub, three fixes

`migrate <address> --profile <name> --hub-slug <slug>` runs extract (pinned),
map, apply and verify in one go and resumes from the ledger on a rerun
(src/cli/migrate.ts). Profiles are the per-hub template (team id + six
login fields), the shared V3 target lives in .env, `profile init` writes the
template. Legacy default hosts `hub-<hash>.membership.io` resolve by decoding
the hashid (src/extract/hubHost.ts).

First hub through it: legacy 12607 "Web Developments" as V3 hub `test2`
(01a09847-23ef-74d3-a94f-9112155526f3, run run-2026-09-13T00-59-51-796Z-
ca4c3373, plan hub-12607-dfd2be02a140). Three things it exposed, all fixed:
1. verify built the hub origin from the plan's derived slug, not the slug the
   hub was created with; it now asks the API for the hub's slug.
2. apply created hubs with `is_private: true`, which on V3 means TEAM-ONLY:
   the slug lookup 404s for everyone else, so even the login page was
   unreachable (mio-backend app/hubs/models.py:24-25, service.py:1314-1360).
   Hubs are now created reachable with registration closed, and is_private
   false is re-stated every run. The ManTalks hub had been flipped by hand
   earlier, which is why it never showed. README section "Hub privacy",
   radar row 25.
3. The /content section-count mismatch (also open on ManTalks) is V3
   rendering its own content page; verify now notes it for sign-off instead
   of failing. test2 verify: accepted, authz skipped (no test members).
545 tests.

## 2026-09-13 (later): verify member on apply; login colour recorded

apply gained a `verifyMember` stage right after branding: the profile's
v3VerifyLoginEmail is looked up on the team (`/api/teams/{team}/contacts?
filter[email]`), created there if absent, and added to the hub through
`POST /api/admin/teams/{team}/hubs/{hub}/members` (409 = already a member).
The contact must already exist globally with a password; an admin cannot set
one. migrate's resume also had to carry the slug the hub was created with
(read from the API), or the hub record hashes as a second plan and the
resume is refused. test2 rerun: member added, verify accepted.

The maroon login panel on test2 is legacy's `colors.secondary` (#A31C1C, its
text colour) painted by V3's auth screen as the form-column surface. The
colours are carried faithfully; V3's login layout assigns the token a
different role. Recorded (README, radar row 26); a login-type page with a
brand-panel slot would be the way to author it, not done.

## 2026-09-13 (test2 review): six fixes from the first non-ManTalks hub

User review of hub.member.dev/test2 found four gaps; two more surfaced while
probing. All fixed, applied by `migrate` resume, verify accepted.
1. Header: a legacy playlist menu item was dropped ("no resolvable link").
   V3 navigation has page, url and discussions items only; a playlist item
   is now a url item with a `playlistRef` the apply resolves to
   `/<hubSlug>/playlists/<v3 id>`.
2. Featured band CTA: apply had rewritten a playlist button action to
   `page /content?playlist=<id>`; it is now V3's typed `playlist` action
   (mio-hub action.ts builds /<hub>/playlists/<id>). The button was also not
   white: legacy's `primary-color` band was emitted as a custom hex, so V3
   never stamped data-bg="primary" and the primary button did not invert.
   When V3's primary IS the legacy primary the band is the `primary` token.
3. Scroll sections bound to a playlist (settings.type "playlist", the
   default, model_type Playlist, no blocks: Scroll/Inner.vue renders
   playlist-head + the files) were emitted empty since the tile change on
   2026-09-12. They take the catalog compact-playlist recipe (the "Playlist
   (bound header)" variant); grid/content-grid/carousel the grid-playlist
   one. Tiles only when blocks exist. ManTalks has 36 such sections, all
   empty on the live Alliance hub until it is resumed.
4. A paragraph whose settings.value is a plain string (older rows) was
   dropped in favour of the display label; the string is the paragraph now.
5. The bound header rendered the playlist description, which held the
   `lgc:` adoption marker. Playlists now carry the marker in meta.lgcMarker
   and the legacy description in description; existing rows are repaired on
   resume (the scanner reads both places). Playlist PATCH needs data.id.
6. url navigation hrefs must carry the hub slug (route-resolver.ts:90); apply
   scopes every internal href with the hub's slug read from the API.
551 tests.


## 2026-09-14: the S3 pin is parallel and shows progress

`migrate alliance.mantalks.com --profile test3` sat on "ssh tunnel up" for
thirteen minutes and looked frozen. It was pinning the manifest: one S3
HEAD per media variant, 3,086 of them for ManTalks, one at a time, with no
output until the loop ended. Nobody had timed it before because the earlier
ManTalks extract ran `--skip-s3` and the pin ran separately.

- `buildManifest` and `pinManifest` now head with 16 in flight
  (`HeadOptions.concurrency`), and assemble entries in the original
  media/variant order so the bundle stays stable across runs.
- Both take `onProgress`; `src/cli/progress.ts` draws one line in place on a
  terminal (`pinning S3 manifest: 512/3086 (16%)`) and prints a line per 10%
  step when piped, so a log file stays readable.
- Timed on the 09-11 ManTalks bundle: 48 s for 3,065 objects, was ~13 min.

Tests: 558. The test3 run reached map (`plans/hub-38827-5258427c8e40.json`)
and stopped before apply; no ledger for test3 yet.

## 2026-09-14: auth and onboarding pages authored from the legacy login look

Legacy paints login, register and onboarding with one split layout: a brand
panel (logo, footer) beside the form. Its background is the page's
`settings.background`, else the theme's `pages.<type>.background`; the default
is a 5% wash of the text colour (`_common.scss:116-135`), dark hubs fill with
secondary under white, an image panel has white text; the side comes from
`hub.meta.<type>.sections`, the logo size from `pages.<type>.logoSize`.

V3 renders every auth screen and onboarding through `BrandedAuthShell` from
the hub's `login` page (register from `register`): the first root child tagged
`settings.slot: "brand-panel"` gives the panel `surface`, `side` and
`logoSize` (a px number). Those settings exist, so `src/map/auth.ts` authors
a `login` page at `/sign-in` and a `register` page at `/sign-up` (the route
names are reserved slugs; the backend finds these pages by type) whose panel
carries the legacy background, side and logo size. Fidelity for what the slot
cannot take: `auth.panel.ink` (only light/dark), `auth.panel.position`,
`auth.panel.logo` (cannot hide), `auth.register.copy`, and
`auth.onboarding.background` when onboarding had its own. Onboarding and
discussions stay excluded; links and menu items to login/register still go
to `/login` and `/register`. Verify skips the auth pages in its screenshot
pass and counts a slot region as a section.

Applied to test2 (2 pages, verify accepted), then found the panel never
reaches the screen: the backend's anonymous render filters the tree through
`filter_tree_for_anon_safety`, which requires every templated node to compile
to an anonSafe section type. `page-login` compiles to nothing, so the root is
replaced by an empty shell (`anon_tree_safety.py:170-200`). The catalog
starter and the slot spec both put `template: "page-login"` on the root, so
the documented shape can never be served; a V3 bug, radar row 28, reported
to BE rather than worked around (dropping the root template would slip past
the prune). `auth-brand-panel` on the panel node has the same problem, so the
panel is tagged by `settings.slot` alone, which is the shape the hub's own
fixtures and tests use.

Also: `scripts/probe/auth-probe.mjs <slug> <login|register>` measures the live
auth screen (h1 colour, panel colours, hub CSS vars) and saves a screenshot.
Tests: 569. Radar v6 (28 rows).

## 2026-09-14: public repository

Pushed to https://github.com/alkeincodes/mio-legacy-migrate (public). Before
the push: the legacy hashids salt moved from `src/extract/hubHost.ts` to
`.env` as `LEGACY_HASHIDS_SALT`, and the probe script lost its default member
login. Both literals were scrubbed from every commit with `git filter-repo
--replace-text`, so commit hashes before this point differ from any older
clone. A pre-rewrite bundle was kept outside the repo. A full-history scan for
key ids, JWTs, private keys and password assignments found nothing else. `.env`
was never committed; the three tracked ledgers hold ids and hashes, no
personal data.
