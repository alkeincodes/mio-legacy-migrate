# mio-legacy-migrate

Rebuilds one legacy Searchie hub on Hub V3 at content and design parity, without
pushing media bytes through the operator's machine, and writes a ledger of
legacy-to-V3 IDs from the first run.

## Setup

    nvm use
    npm install
    cp .env.example .env && chmod 600 .env
    npx playwright install chromium

Fill `.env` from the credentials the team holds. Nothing in it is ever committed,
pasted into a ticket, or posted to Slack. **Single-quote any value containing
`#`, `$` or a space** (`LEGACY_DB_PASSWORD='p#ss w$rd'`): dotenv cuts an
unquoted value at the first `#`, and the replica then reports a wrong password.
`loadEnv` warns when it sees that shape.

`V3_API_KEY_MANTALKS_PROD` is optional. Without it, apply and verify log in as
`V3_VERIFY_LOGIN_EMAIL` through the backend's login route and use the access
token, so no static key has to be minted for a one-off run.

## A profile per hub

`.env` holds what every hub shares: the legacy replica and box, the AWS pairs,
and the V3 target (`V3_API_BASE`, `V3_ASSETS_BUCKET`, `V3_ASSETS_REGION`,
`V3_CDN_BASE`, `V3_CDN_BASE_CONFIRMED`, `V3_HUB_BASE`). A profile holds what
differs per hub: the V3 team the hub is created in and that hub's logins, an
audience member of the legacy hub and a member of the V3 hub (verify logs
into both sites with them), plus optionally a platform user for the API when
no `V3_API_KEY_<PROFILE>` is set. `mio teams list` (logged in as that team's
account) prints the team id.

    npx tsx src/cli/index.ts profile init <customer>-prod --team-id <team uuid> \
      --legacy-login member@customer.com:pw --verify-login member@customer.com:pw \
      --platform-login owner@customer.com:pw

Every login flag is optional; a field not given is written blank so the
migrator can fill it in by hand before `verify`. The profile name is what
`--profile` takes and what names the ledger directory, so pick it once.
`profiles/*.json` is gitignored: profiles hold credentials.

## One command: migrate

After `profile init` and filling the profile, one command runs the whole
thing: extract with the S3 identities pinned, map, apply and verify.

    npx tsx src/cli/index.ts migrate <legacy address> --profile <name> --hub-slug <slug>

`<legacy address>` is the hub's URL or host as the migrator sees it: a custom
domain (`alliance.mantalks.com`) or the default `hub-<hash>.membership.io`.
Add `--dry-run` to stop after the apply dry run. A rerun of the same command
resumes the run the ledger holds for that profile and legacy hub (the plan
changes are accepted and changed page trees rewritten), so a second hub can
never be created by accident; the ledger is committed to git around each run.
Verify runs only when both hub logins in the profile are filled; the V3
member cannot exist before the first apply creates the hub, so a first run
always skips it and says so.

Two flags every migrator must understand:

- `--hub-slug <slug>` names the V3 hub's URL, `<hubBase>/<slug>`. It is a free
  choice, not tied to anything legacy. Slugs are global across every V3 team
  and a taken slug is silently auto-suffixed (asking for `alliance` twice
  yields `alliance-xxxx`), so read the hub URL the run prints. The slug is
  fixed at creation; a resume cannot change it. Required on the first run.
- `--publish-held` concerns pages legacy gated by a segment the migration
  could not rebuild on V3 (attribute segments such as "No Profile Details"
  are not extracted). Without the flag those pages are created as held drafts
  so nothing leaks, and the report lists them. With it they are published
  ungated, visible to every hub member, and the report marks them
  `published-ungated` so the team can re-gate them by hand. We used it on
  ManTalks because its home page was in that set.

`--assets` copies media into the V3 bucket and needs `V3_AWS_*` in `.env`;
without it images stay legacy-linked and media pending, which is the state
until those keys exist.

## The four stages

    npx tsx src/cli/index.ts extract alliance.mantalks.com
    npx tsx src/cli/index.ts map --bundle bundles/<file>

Without AWS values yet, capture first and pin the S3 identities later:

    npx tsx src/cli/index.ts extract alliance.mantalks.com --skip-s3
    npx tsx src/cli/index.ts extract --s3-only bundles/<file>

A plan mapped from an unpinned bundle can be dry-run but not applied.
    npx tsx src/cli/index.ts apply --profile mantalks-prod --plan plans/<file> --dry-run
    npx tsx src/cli/index.ts apply --profile mantalks-prod --plan plans/<file>
    npx tsx src/cli/index.ts verify --run <runId> --profile mantalks-prod --plan plans/<file>

Each stage reads the previous stage's file and writes its own, so any stage
reruns alone. Only `apply` mutates the target. Nothing ever mutates the source.

## The rule that matters most

**One operator per legacy hub and profile at a time.** The lock file enforces it,
and apply refuses to start unless the ledger directory is clean and up to date
with the remote, so two operators on different clones can see each other's runs.
Two operators pushing a ledger at the same moment can still race; the marker
protocol turns that into an adopt-or-resolve step rather than silent duplication.

## When a run stops

Nothing is rolled back. The ledger is consistent and names the legacy key it
failed on and the state it left. Fix the cause and continue:

    npx tsx src/cli/index.ts apply --profile mantalks-prod --plan plans/<file> --resume <runId>

If a create had an uncertain outcome, apply will not recreate on its own. It
prints a `ledger resolve` command; run it, look at the candidates, then either
`--adopt <id>` or `--confirm-absent`.

Unpublishing or deleting migrated records is a human decision made with the mio
CLI. The ledger fields you need are `v3Id` (the target id), `kind` (which entity
type), and `marker` (which run created it).

## Hub privacy: legacy `auth` is not V3 `is_private`

A legacy hub with `auth = 1` requires members to log in. V3's `is_private`
means something narrower: only members of the owning TEAM can reach the hub
at all, and the public slug lookup answers 404 to everyone else, so even the
login page is unreachable (mio-backend `app/hubs/models.py:24-25`,
`app/hubs/service.py:1314-1360`). The migration therefore creates every hub
with `is_private: false` and `settings.registration.enabled: false`: reachable,
log in required, nobody can self-register. `apply` re-states `is_private:
false` on every run, so a hub flipped to team-only by hand comes back. If a
customer wants a team-only hub, that is a V3 admin decision after migration.

## What M1 does not do

- Video does not appear in the media library or in course playlists. It plays on
  pages through legacy CDN URLs where the playback check passes, and those assets
  sit in ledger state `legacy-linked`. `inventory --profile <name>` lists every
  asset still depending on legacy serving; legacy serving cannot be switched off
  while that list is non-empty.
- `apply --assets-only` and `apply --mode upsert` both exit with a message naming
  the milestone they belong to.
- Live calls are not migrated. No legacy table backs them.
- Button chrome is not carried, because V3's button has no setting for it. The
  legacy theme's (or the element's) radius, padding, shadow, border and weight
  are read from the hub data, but the V3 button takes `variant` and `size` only,
  so every legacy button lands on `size: lg` (46px tall, 14px sides, the hub's
  control radius, weight 400) and the difference is reported as one `fidelity`
  warning per distinct chrome. The rule throughout: a legacy value goes onto the
  V3 setting that exists for it; when none exists, the gap is V3's and is
  recorded, not worked around.
- Image caps outside 128/352px snap to the nearest or fill the column; square
  images get V3's smallest radius (12px); an image border becomes a 1px hairline.
  Each is a `fidelity` warning with the legacy and V3 values.
- Section padding is exact at desktop width. Legacy drops its default 50px to
  30px under 768px; the migrated page keeps the desktop value on mobile.
- The V3 login screen paints its form column with the `secondary` colour,
  which legacy uses as its text colour, so a hub whose legacy text is maroon
  gets a maroon login panel. The hub pages read as legacy; only the auth
  screen differs. A login-type page with a `brand-panel` slot could carry a
  legacy-matching surface; the migration does not author one yet.
- Background position is dropped; V3 centres. Paragraph line-height is V3's 1.3
  against legacy's 1.5. A small legacy headline (h4, 18px) renders at 20px.

## Entity types with no revision token

Only pages (`draft_version`, sent as `If-Match`) and hubs (an opaque `ETag`) have
concurrency control. Playlists, folders, spaces, achievements, segments, access
rules and media files are last-write-wins on the target. When M3 upsert lands,
runs touching those types need an announced maintenance window during which
nobody edits the hub.

## Local artifacts are customer content

Raw legacy settings JSON can carry an email in a segment condition or a name in a
testimonial. `bundles/`, `plans/` and `runs/` stay local, are gitignored, and are
deleted by:

    npx tsx src/cli/index.ts clean --older-than 30d --confirm

The report and the contact sheet are the only artifacts meant to be shared, and
the report redacts email addresses.
