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
pasted into a ticket, or posted to Slack.

## The four stages

    npx tsx src/cli/index.ts extract alliance.mantalks.com
    npx tsx src/cli/index.ts map --bundle bundles/<file>
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

## What M1 does not do

- Video does not appear in the media library or in course playlists. It plays on
  pages through legacy CDN URLs where the playback check passes, and those assets
  sit in ledger state `legacy-linked`. `inventory --profile <name>` lists every
  asset still depending on legacy serving; legacy serving cannot be switched off
  while that list is non-empty.
- `apply --assets-only` and `apply --mode upsert` both exit with a message naming
  the milestone they belong to.
- Live calls are not migrated. No legacy table backs them.

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
