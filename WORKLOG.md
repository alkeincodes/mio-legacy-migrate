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
