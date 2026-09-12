# Apply runbook for the live ManTalks hub

The live hub is `01a09204-a0ac-76e2-9658-cc9bc9e1b42f`, https://hub.member.dev/alliance, created by run `run-2026-09-11T19-49-29-036Z-b3f055c6`. Every further apply resumes that run. A fresh run creates a second hub on production.

```bash
nvm use
npx vitest run && npm run typecheck
npm run cli -- map --bundle bundles/<newest hub-38827-*.json>          # prints the plan path and the fidelity summary
git add ledger && git commit -m "ledger: …"                             # only if the ledger is modified (a stopped run leaves it so)
npm run cli -- apply --profile mantalks-prod --plan plans/<new>.json \
  --resume run-2026-09-11T19-49-29-036Z-b3f055c6 --accept-plan-change --rewrite-pages \
  --skip-assets --publish-held --hub-slug alliance > /tmp/apply.log 2>&1; echo exit=$?
tail -1 /tmp/apply.log                                                  # must say "apply finished"
git add ledger && git commit -m "ledger: after <what>"
```

Facts that bite:

- The clean-ledger gate refuses to start when `ledger/` has uncommitted changes. Commit after every apply, stopped or not.
- V3 allows 60 page publishes an hour per client. Only pages whose tree changed are republished; a full rewrite is 27 pages, so at most two full applies an hour. A budget stop is clean: trees already written stay live (publish happens after the tree write), the log names the earliest resume time.
- A shell wrapper (`sleep …; npm run cli -- apply …`) reports its own exit code. Read the apply log's last line.
- The dry-run renderer lists plan operations without consulting the ledger; its `page.create` lines are expected on a resume.
- `--skip-assets` stays until `V3_AWS_*` keys exist; images are legacy-linked, playlists empty, so playlist covers and file cards stay blank until then.

Verify on the live hub (login as the test member, then measure). A `waitForURL` timeout at the login step means the hub is refusing the login for now (it happens after many logins in a row); wait a few minutes and retry rather than editing the script.

```bash
node scripts/probe/hub-probe.mjs measure /home-page "Begin Training"        # rects and computed styles per leaf
node scripts/probe/hub-probe.mjs images  /home-page "Monthly Mission"       # every img with its wrapper chain
node scripts/probe/hub-probe.mjs shot    /home-page "Monthly Mission" out.png
```

Record: `WORKLOG.md` entry; a new limitation gets a row in the Legacy Migration Radar artifact
(https://claude.ai/code/artifact/c8596a7b-c09a-4839-a8e1-829e5744db52, update in place with the Artifact tool, never a second artifact); memory note in the user's memory directory.
