# Legacy hub migration to Hub V3: design

Date: 2026-09-12 (revision 6: facts corrected against code during plan writing)
Status: approved in conversation, under written review
Working name for the repo: `mio-legacy-migrate`
Pilot hub: ManTalks Alliance (`alliance.mantalks.com`) onto the V3 team `01a090ff-5ac3-7402-b686-66fd46af67bc` at `hub.member.dev`

## 1. Goal

A repeatable tool that takes one legacy Searchie hub and rebuilds it on Hub V3 at content and design parity, without pushing media bytes through the operator's machine, while writing a ledger of legacy-to-V3 IDs from the first run. Any team member can run it for any hub. ManTalks is the first hub.

"No re-upload" means media moves by S3 server-side copy into V3's bucket. It does not mean zero duplication: the object exists in both buckets for the life of the transition, which Atanas priced at about $13 a month for ManTalks.

Scope is "hub replicator plus ledger plus asset adoption" (option B in the session). Members, member profiles, payments and discussion content are out of scope. Segments are extracted and mapped but lowest priority to apply.

### 1.1 Milestones

- **M1, Wednesday demo (reduced parity).** Theme, all pages and navigation, images, PDFs and audio in the media library and playlists, community spaces, achievements if time allows. Video plays on pages through legacy CDN URLs where the playback check (section 7.3) passes; such assets are in ledger state `legacy-linked`, an M1-only acceptance state (7.4). Video does not appear in the media library or course playlists unless the backend import endpoint (section 9) has landed first. This reduction is stated in the demo, not discovered.
- **M2, full asset adoption.** Once the import endpoint exists, `apply --assets-only` imports pending video, then rewrites page nodes and playlist entries from legacy URLs to V3 media IDs and retires every legacy CDN reference. M2 is the point at which the hub no longer depends on legacy serving.
- **M3, upsert.** Rerun against a changed legacy hub or an improved mapping updates the same V3 hub in place (section 6.4).

## 2. What the sources decided (do not re-litigate)

- Jake's thread, 11 Sep: baseline is brand and theme, all 25 pages with header, footer and More menus, section-built home and register pages, media library and playlists per course, community spaces from categories, live calls as events, the four achievement badges. Segments lower priority. Member data, profiles and payments avoided.
- Thursday scrum, 10 Sep: the legacy MySQL database migrates eventually, no second source of truth. Hard assets stay in S3 with copy or pointer. A ledger mapping legacy IDs to V3 UUIDs is unavoidable. Atanas: S3 copy of all objects is about $1,500 one-time, ManTalks holds about 542 GiB, duplicate storage about $13 a month. Two CDNs front the two buckets. Transition runs months.
- Friday scrum, 11 Sep: Andrew set design and content first, then segments, achievements, discussions. Real member migration deferred, to be tested on the TME hub first. A real migration script, not a visual clone. FE leads because it needs node-tree knowledge. Mihai owns the mapping and starts Monday; this project kicks it off for him. Marko: every legacy section is achievable in the node tree, no old-to-new mapping exists yet.
- MIO-3824 and mio-backend PR 949: Jarius's recon scope doc with twelve open questions. This project answers question 7 (real ManTalks footprint) as a by-product of extract, and depends on question 5 (asset serving) for M2.

## 3. Facts established this session

- The legacy production read replica is `searchie-production.cluster-ro-clpdjx0mvdwf.us-east-1.rds.amazonaws.com:3306`. It is unreachable from a developer Mac and reachable from the remote dev box, which has a MySQL 8.4 client. Credentials are the read-replica user Atanas sent Alkein by DM on 12 Dec 2025. They live only in `.env` and are never written to a ticket, a commit or Slack.
- V3 has no route, service or CLI command that adopts an existing S3 object by caller-supplied key. The admin register-synthetic endpoint (`app/media/admin_router.py:503`) creates a ready Media row with one server-generated key (`{team_id}/media/{media_id}/original`), no transcoding, no dedupe on any natural key, and accepts `asset_kind` of `document` or `pdf` only, so migrated images register as `document`. The V3 key scheme is `{team_id}/media/{media_id}/{variant}` in one global bucket behind one CDN. Media rows are team-scoped, not hub-scoped.
- Legacy layout is a three-level `sections` tree (row, column, element rows linked by parent ID), not a JSON blob; `pages.settings` and `sections.settings` hold styling only. `sections.permissions` is a dead column: real access control is `sections.segment_id`, the `segmentables` pivot and `section_audience`. Where only `permissions` is populated the mapper reads it as a fallback and raises an `approximated` warning. Legacy media keys follow the Spatie convention (`media.disk` plus `media.file_name`), with the CDN URL produced by a string swap in `app/Helpers/cdn_url_function.php`.
- The legacy `events` table is a webhook registry, not live calls. The source for "live calls as events" is unidentified (section 11).
- The page-builder catalog served by the backend is 0.23.6 with 10 templates (`auth-brand-panel` landed in 0.23.0); the public docs page is stale at 0.22.1 with 9. It contains no legacy mapping.
- The mio CLI (0.19.0) is logged in against production as `v3demo@mantalks.com` on the ManTalks team, which has zero hubs. The previous login was backed up to the session scratchpad.

## 4. Architecture

One repo, TypeScript on Node 24 (nvm, `.nvmrc`). Four stages, each a CLI subcommand reading the previous stage's file and writing its own, so any stage reruns alone.

```
legacy MySQL (read replica, SSH tunnel through the remote box)
        |  extract <legacy-hub-id>
        v
bundle.json     raw legacy snapshot keyed by legacy IDs, with capture header
        |  map
        v
plan.json       V3-shaped ops in catalog vocabulary, plus warnings
        |  apply --profile <name> --mode fresh [--resume <run-id>] [--dry-run] [--assets-only]
        v
V3 (mio CLI + API, S3 server-side copy)  +  ledger/<profile>/<legacy-hub-id>/<run-id>.json
        |  verify --run <run-id>
        v
runs/<run-id>/report.md + contact-sheet.html + playback.json
```

Terms: "source" is the legacy replica, "target" is the V3 profile. "Mutation" means a write to source or target. Every stage writes local artifacts; only apply mutates the target; nothing ever mutates the source.

Rules:

- Extract is the only stage that reads the source. It opens a loopback-only local port forward over SSH to the box (host key verified against a pinned `known_hosts` entry) and connects through it. No other stage knows MySQL exists.
- Map is pure: bundle in, plan out, no network. It is where the legacy-to-catalog mapping lives and the part Mihai iterates on.
- Apply is the only stage that mutates the target. It uses the mio CLI where the CLI covers the operation, the V3 API directly where it does not, and the AWS SDK for S3 copies. Before any mutation it checks that the CLI session and the API key both resolve to the selected profile's API base and team ID, and refuses to run if either disagrees.
- Verify reads plan, ledger and both live sites and mutates nothing.
- Profiles (`profiles/<name>.json`) hold target API base, team ID, V3 bucket, region and CDN base. The first profile is `mantalks-prod`. Adding a dev profile is one file.
- Every CLI, API, SSH and S3 call has a timeout. For reads, a timeout is retried with backoff. For mutations, a timeout or lost response is an uncertain outcome handled by section 6.2, never by a blind retry.

### 4.1 Secrets and local artifacts

- `.env` (gitignored, `.env.example` committed, created at mode 600) holds: legacy DB host, port, user, password; SSH box host and user; AWS credentials and region; V3 API key per profile; the legacy hub login for verify.
- Logs redact anything matching a configured secret value and any URL query string.
- Gitignored: `bundles/`, `plans/`, `runs/`, Playwright browser state. Committed: `ledger/`, `profiles/`, the mapping table. Ledgers never contain signed URLs or tokens; legacy CDN URLs stored in ledgers are the plain public form.
- Extract never selects from member, subscription or payment tables. Raw settings and segment JSON may still carry personal data (an email in a segment condition, a name in a testimonial), so bundles, plans and runs are treated as customer content: local only, never attached to a ticket or Slack, and deleted by `mio-legacy-migrate clean --older-than 30d`. The report and contact sheet are the only artifacts shared, and the report redacts email addresses.
- The mio CLI session file is the CLI's own store; the tool never copies it. The backed-up previous session lives in the session scratchpad and is deleted once the ManTalks work is done.

## 5. Bundle and mapping

### 5.1 Extract contract

The bundle header records: legacy hub ID, source host, capture start and end time (UTC), replica lag as reported by `SHOW REPLICA STATUS` at capture start (or "unavailable"), bundle schema version, tool version. All reads run inside one `REPEATABLE READ` transaction so the snapshot is consistent. Reads are paginated by primary key in batches of 500.

Tables pulled: hubs, pages, sections (settings, permissions, meta), playlists and items, folders, files and Spatie media rows with every variant, discussion categories, achievements, segments with groups and conditions, theme. Raw JSON columns are stored untouched beside parsed fields. Files are scoped to those referenced by the hub's pages, playlists, folders and theme; team-wide files not referenced by the hub are excluded.

The asset manifest, per legacy file: file ID, media ID, disk, file name, every variant with its own disk and file name, the resolved source bucket and key per variant, object size, ETag, and where the legacy bucket has versioning, the `VersionId` per variant (read via `HeadObject` during extract). These pin the source identity the copy will insist on; they do not freeze the bytes, which is why the copy is conditional (6.3), MIME type, resolved CDN URL, folder and playlist membership, and the permissions of every section that references it.

### 5.2 Mapping

Three layers:

- Theme: legacy colours, fonts and logo assets to V3 branding keys, following the branding key map and six-digit hex rule documented in the mio CLI skill. A table, not logic.
- Sections: a mapping table keyed by legacy section type. Each entry names a catalog template, the node kinds to emit and a transform from legacy settings JSON to node values and settings. Node IDs are generated deterministically from `legacy-hub-id/page-id/section-id/ordinal` so reruns produce the same tree. Unmapped types fall back to a `row` section holding a `text` node with the legacy content and a warning of type `approximated`. Internal links inside content are rewritten to the preserved V3 slugs; asset references are rewritten to ledger placeholders that apply resolves. The first draft of the table comes from an agent pass over the catalog and the legacy section types; a human reviews it. The table has a review column.
- Navigation and pages: header, footer and More menus to V3 navigation. Page slugs are preserved. Links between pages are emitted as slug references, not IDs, so mutually linked pages need no ordering: apply creates every page as an empty draft first (allocating IDs and slugs), then writes trees (6.5).
- Schemas: the plan carries `planVersion` and the catalog version it was mapped against. Apply refuses a plan whose catalog version differs from the target's live catalog ETag unless `--allow-catalog-drift` is passed, and validates every tree against the catalog's settings schema before writing it.

Each section carries `restricted: true` when its legacy permissions are anything other than public. Each asset in the manifest carries `visibility`: `public` if any public section, public playlist or public folder references it in legacy, otherwise `restricted` with the set of legacy permissions that gate it. The mapper emits an `accessRule` for restricted sections only when the legacy permission maps to a V3 access rule it can express; otherwise the section is `restricted` with no rule and a warning of type `access-unmapped`.

The plan carries `warnings[]` with page, section, type (`approximated`, `dropped`, `access-unmapped`, `asset-pending`) and reason. Nothing is dropped silently.

## 6. Apply and the ledger

### 6.1 Ledger

Path: `ledger/<profile>/<legacy-hub-id>/<run-id>.json`. Header: source host, legacy hub ID, profile name, target API base, target team ID, run ID, tool version, plan hash. Header also records the target hub ID once created. On `--resume`, apply checks source host, legacy hub ID, profile name, target API base, team ID, target hub ID and plan hash against the current inputs, and refuses on any mismatch. A changed plan cannot be resumed: the operator either restores the original plan file (its hash is in the header) to finish the run, or starts a new run. In M3 a changed plan is applied as a new upsert run that reconciles every entry against the new plan, never as a resume.

Concurrency: one operator per legacy hub and profile at a time. The lock is a file `ledger/<profile>/<legacy-hub-id>/.lock` containing operator, host, run ID and a heartbeat timestamp the running process refreshes every 30 seconds. Apply refuses to start while a lock's heartbeat is under 5 minutes old. Older locks are stale and are cleared only by `apply --break-lock`, which prints the lock's owner first. Because ledgers are committed, apply also refuses to start unless the ledger directory is clean and up to date with the remote, so two operators on different clones see each other's runs. Two operators racing the same `git push` is an accepted risk (section 12).

Entry: legacy table, legacy ID, kind, V3 ID, state, run ID, timestamps, content hash of the plan entry, and for assets the fields in 6.3. Ledger writes are atomic: write to a temp file in the same directory, fsync, rename. The ledger is committed to git after a run for history, not for safety.

### 6.2 Idempotent operations

Every mutation follows the same protocol:

1. Append an entry in state `intent` with the legacy key and a deterministic marker.
2. Look up the target by the marker. If found, adopt it: record the V3 ID and skip the create.
3. Otherwise create, then record the V3 ID and move the entry to `done`.

Markers. Hub-level records (hub, pages, playlists, folders, spaces, achievements, segments) carry `lgc:<source>:<legacy-id>:run:<run-id>` where `<source>` is a short hash of the source host. Assets carry `lgc:<source>:<legacy-media-id>:<variant>:g:<gen>` where `<gen>` is a short hash of source bucket, key and VersionId (or ETag when unversioned). The run ID is absent because assets are reused across runs (6.4), and the generation component means a changed source produces a distinct marker, so a stale allocation is never re-adopted and lookups never return two generations for one legacy media. The ledger keeps the logical identity (legacy media ID and variant) as separate fields, and resume selects an allocation by its full marker, never by logical identity alone. The marker is stored in the target's description or metadata field where the entity has one, otherwise appended to its name. Register-synthetic stores its description on the File row (`app/media/service.py:643`), so the asset marker lives on File, and the asset lookup lists Files for the team and filters by marker; there is no assumption of a media search endpoint. The exact field and list call per entity is fixed in `docs/contracts.md`, the first build task, and apply refuses to mutate an entity type whose contract is missing.

In-flight commits. After an uncertain outcome the create may still land at any later time, and no client-side wait proves it has terminated. So apply never recreates on its own after an uncertain create. It waits a settle window of 60 seconds, lists by marker up to three times 30 seconds apart, and then: one match, adopt; more than one, stop and print `ledger resolve <entry>`; zero, also stop and print `ledger resolve <entry>`. The resolve command shows the candidates and the entry, and a human either picks one (`--adopt <id>`), or confirms absence (`--confirm-absent`), which lets the next resume create again. Where the API accepts an idempotency key header, the marker is sent as that key and a zero-match retry is then automatic, because the server guarantees a single outcome. Which entity types have such a header is recorded in `docs/contracts.md`.

Relationship writes and publication (attach a playlist item, set navigation, publish a page) are check-then-write: apply reads the target first, writes only the difference, and reads back to confirm before marking the step `done`. An uncertain outcome on these is resolved by the read-back alone.

Uncertain outcomes (timeout, lost response, process killed) leave the entry in `intent`. `apply --resume <run-id>` reprocesses every `intent` entry through the in-flight protocol first. Resume exists from the first iteration and does not depend on upsert.

### 6.3 Assets

States per variant: `intent`, `allocated`, `copied`, `verified`, `legacy-linked`, `pending-import`. Ledger fields: source bucket, source key, source ETag, source VersionId where present, source size, source checksum where S3 exposes one, V3 media ID, destination key, destination size and checksum after copy, `visibility`, and the marker.

Adoption path for image, PDF and audio:

1. `intent`, marker lookup as in 6.2.
2. Register-synthetic to obtain the V3 Media row. Persist media ID and destination key immediately as `allocated`. If the endpoint does not return the key, derive it from the documented scheme and confirm with a `HeadObject` that the destination is empty.
3. Server-side copy source to destination with the AWS SDK. The copy names the source `VersionId` when the legacy bucket is versioned, and otherwise sends `CopySourceIfMatch` with the source ETag, so changed source bytes fail the copy instead of migrating silently. The copy requests `ChecksumAlgorithm: CRC64NVME` with `ChecksumType: FULL_OBJECT`, the one algorithm S3 computes as a whole-object value regardless of part boundaries, so single-part and multipart copies produce comparable checksums. Multipart copy for objects over 5 GB; on resume, incomplete multipart uploads for the destination key are aborted before retrying. Destination keys are freshly allocated media IDs, so the only object that can already exist there is our own earlier attempt: a non-empty destination whose size matches the source is adopted as `copied`, any other non-empty destination is an error. Set content type and cache headers from the manifest. Move to `copied`.
4. `HeadObject` the destination with `ChecksumMode: ENABLED` and compare size. If the source exposed a full-object CRC64NVME checksum at extract, compare it too; a source with no checksum or only a composite checksum is compared by size alone, and the destination's full-object checksum is recorded for every later comparison. ETags and composite checksums are never used as an integrity check because they depend on part boundaries and encryption. Move to `verified`.
5. Only `verified` assets are attached to folders, playlists and page nodes, and only into containers whose visibility matches: a `restricted` asset is attached only to a playlist or folder that carries a mapped access rule equal to or stricter than the asset's legacy gate, and to page sections that are `restricted` with a mapped rule. A `restricted` asset with no mappable rule stays `verified` but unattached, with a warning of type `access-unmapped`. Assets that were public anywhere in legacy are treated as public. The manifest `visibility` is written to the V3 Media visibility field named in `docs/contracts.md`; if V3 exposes no such field, restricted assets are protected only by container gating, and that is recorded in the contract as a known limit.

A synthetic row that is `allocated` but not `verified` is never referenced by any page or playlist, so it is not reachable by members. `apply --cleanup-orphans` lists and, with `--confirm`, deletes allocated-but-unverified rows older than a day.

Video: recorded as `pending-import` with the legacy CDN URL of the playback variant and of poster and caption variants. In M1, when the asset is `public` and the playback check (7.3) passed, the page-level `video` node uses the legacy URL and the entry moves to `legacy-linked`. Restricted video never emits a legacy URL; it stays `pending-import` with a warning of type `asset-pending` and an empty `media-slot`. Media library and playlist rows for video wait on section 9, and M2 moves every `legacy-linked` entry to `verified` and rewrites the node.

Cross-account: the copy runs with credentials that can read the legacy bucket and write the V3 bucket, including `kms:Decrypt` on the legacy key, and both `kms:GenerateDataKey` and `kms:Decrypt` on the V3 key (multipart completion and checksum reads decrypt the destination), where either bucket uses SSE-KMS. `apply --check-access` proves this by copying one small real source object to a probe key under the team prefix, verifying it, and deleting it, before the first run on a profile.

### 6.4 Modes

- `fresh` (default): creates a new V3 hub. Hub-level markers include the run ID, so a fresh run never adopts an earlier run's hub, pages, playlists or folders. Assets are reused: before allocating, apply checks every ledger for the same profile (any legacy hub on the team) and adopts a `verified` asset whose marker matches and whose recorded source VersionId or ETag equals the current manifest's. If the source identity differs, the old entry is left as is, a new asset is allocated and copied, and the new run links to it; the report lists the superseded asset. Media is team-scoped in V3, so this is the only way fresh runs stay cheap.
- `upsert` (M3): loads the latest ledger for the legacy hub and profile, updates any record whose content hash or reference hash changed, creates missing records, and never deletes. The content hash is over the plan entry serialised with sorted keys and asset placeholders unresolved; the reference hash is over the resolved V3 IDs the entry points at, so a page is rewritten when an asset it references was re-allocated even though its content did not change. Records on the target that are not in the plan are left alone. Every successful write stores the target's revision token (the draft version for page trees, which the API already checks with `If-Match`; the equivalent field per entity from `docs/contracts.md`) in the ledger. Upsert sends that token as a conditional update, so a record edited on the target since the last write is rejected by the server, recorded as `target-edited`, and skipped unless `--overwrite-edits` is passed, in which case apply re-reads, shows the diff, and writes with the fresh token. Entity types with no revision token cannot be updated safely under concurrent editing; for those, M3 runs inside an announced maintenance window during which nobody edits the hub, and that is recorded in section 12. Drift where both hashes are unchanged is not repaired by upsert; `verify` reports it (7.1).
- `--resume <run-id>`: continues an interrupted run of either mode (6.2).
- `--dry-run`: prints every operation and mutates nothing. Default the first time a profile is used.
- `--assets-only`: runs only the asset stage, including the M2 completion of `pending-import` rows and the rewrite of page nodes and playlist entries from legacy URLs to V3 media IDs.

### 6.5 Ordering, publication and access

Order: hub and branding; segments and access rules; folders and assets; playlists; pages as empty drafts in slug order; page trees in slug order; navigation; community spaces; achievements. Segments come early because assets, playlists and pages attach to their rules; achievements come last because they reference pages and playlists. This is the single executable order.

Each page tree is written to the draft and then published, one page at a time. Publication is fail-closed: a page containing any `restricted` section without a mapped `accessRule` is written as a draft and left unpublished, with a warning. The hub is created with registration disabled; enabling it after verify passes is a human step and not a substitute for the access rules above.

### 6.6 Request budget and retries

The backend rate limiter is keyed on client IP, not admin identity, and the binding ceilings are 60 page creates and 60 publishes per hour. Apply keeps a sliding one-hour window of write timestamps per API identity (team ID plus a fingerprint of the key) in `state/budget/<identity>.json`, shared by every run and profile that uses that identity on this machine. It counts one draft write and one publish per page, and refuses to start a pass that would exceed the remaining window, printing the earliest time it can continue. Usage by other clients of the same identity is invisible until a 429 arrives; on 429 apply marks the window exhausted until `Retry-After` (or 10 minutes if absent), then resumes. Other rate-limited endpoints have their own windows. Retries on 429 are unbounded within the run's wall-clock limit; retries on other errors are at most five before the entry is left in `intent` and the run stops. Progress is persisted per page so an interrupted pass resumes at the next page.

### 6.7 Failure

Any failure stops the run, prints the legacy key it failed on and the state it left, and leaves the ledger consistent. `--resume` continues. Nothing is rolled back automatically; unpublishing or deleting migrated records is a human decision made with the mio CLI, and the README documents the ledger fields needed to do it.

## 7. Verify

### 7.1 Structural report

Per page: legacy section count, catalog sections emitted, node count, and every warning by type. Then the counts checked against the live target: pages in plan versus pages on the hub, sections per page in plan versus on the page, playlists and item counts, folder and file counts. Then drift: the published tree digest per page compared with the digest of the tree apply wrote, from the ledger; a mismatch is reported as `target-edited` with the page slug.

### 7.2 Contact sheet

Playwright logs into `alliance.mantalks.com` (legacy hub login from `.env`) and into the V3 hub as `v3demo`, captures each page at desktop and mobile widths, and writes a contact sheet with legacy left and V3 right. Browser state is discarded after the run. No automated pixel or layout diff.

### 7.3 Playback check

Two stages, both recorded per URL in `playback.json`.

Prefilter, run inside apply before a legacy URL is emitted: fetch from a clean session with no cookies, follow redirects, confirm 200 with the expected content type, reject any URL carrying a query string (signatures and expiring tokens live there). For HLS, fetch the master manifest, every variant manifest it references, the first segment of each, the encryption key URI if any, and every caption track. Any failure keeps the asset `pending-import`.

Browser check, run in verify: Playwright loads each V3 page that carries a legacy-linked video from the V3 origin, waits for the `<video>` element to reach `canplaythrough` or for the HLS player to report a loaded level within 20 seconds, asserts no console error mentioning CORS, MEDIA_ERR or a failed fetch, and for captions asserts the text track reached `loaded`. A page that fails moves its asset back to `pending-import` in the ledger and the run is not accepted.

Legacy dependency inventory: `inventory --profile <name>` lists every `legacy-linked` and `pending-import` entry across the profile's ledgers. Legacy serving for a hub cannot be switched off while its inventory is non-empty; that is the M2 exit condition.

### 7.4 Acceptance for a run

- Page and section counts match between plan and target.
- Zero warnings of type `dropped`.
- Every asset referenced by a page or playlist is `verified`, or in M1 `legacy-linked`. M2 acceptance requires `verified` only.
- Every emitted legacy URL passed both playback stages.
- Every `restricted` section is either published with a mapped rule or unpublished.
- Authorization checks (7.5) pass.
- Warnings of type `approximated` and `access-unmapped` are listed for human sign-off; the run is accepted when a named person signs the report.

### 7.5 Authorization checks

Expected outcomes depend on the mapped rule. For every `restricted` page section, playlist, folder and asset the report records three requests: anonymous, an authenticated test member with no entitlements, and an authenticated test member who satisfies the mapped rule. A members-only rule expects the first refused and the other two allowed; an entitlement or segment rule expects the first two refused and the third allowed. Refusal is 401, 403, a redirect to login, or a 404 where the target deliberately hides existence. For assets the checks include the direct media download URL. For a sample of `public` items all three requests must succeed. The test members exist on the target team for this purpose and are created by `apply --check-access`. Any mismatch blocks acceptance.

## 8. Testing

- Mapper: unit tests from bundle fixtures, one fixture per legacy section type, asserting the exact catalog nodes and deterministic node IDs emitted.
- Ledger: fresh, resume with `intent` entries, upsert-unchanged, upsert-changed, header mismatch rejected, lock contention rejected, corrupt file rejected with a clear message.
- Idempotency: simulated lost response after create, verified to adopt on resume rather than duplicate. Simulated kill between `allocated` and `copied`, verified to retry into the same key.
- S3: copy with mismatched source ETag fails; non-empty destination with a different ETag fails; multipart threshold exercised with a fake.
- Rate limit: 429 with and without `Retry-After`, budget exhaustion refuses to start.
- Extract and apply: one integration smoke test each, gated on the environment variables, run by hand against ManTalks.
- Verify: playback prefilter against a URL with a query string fails; browser check against a page whose video throws a CORS console error fails; authorization check against a restricted asset that returns 200 anonymously fails.
- Fresh isolation: a second fresh run adopts no hub-level record from the first, and adopts every asset whose source identity is unchanged.
- Stale reuse: a manifest whose source ETag differs from the ledger's allocates a new asset and links to it.
- Contracts gate: apply refuses an entity type missing from `docs/contracts.md`.
- Backend import identity (owned by the backend lane, listed here so the contract is testable): importing the same logical video twice with different source generations yields two Media rows, and a hub that referenced the first still resolves to the first.

## 9. Backend dependency

One admin-scoped endpoint owned by Asim's data-migration lane, aligned with question 5 of MIO-3824. Contract this project needs:

- Input: team ID, source host, legacy bucket and key per variant (with VersionId where present), legacy file ID, legacy media ID, target folder, source ETag per variant.
- Behaviour: server-side copy into the V3 key scheme, run the normal transcode pipeline, record source host, legacy file ID, legacy media ID and the source generation (bucket, key, VersionId or ETag) on the Media row. Idempotency identity is the tuple (team ID, source host, legacy media ID, source generation), the same rule as the client marker in 6.2: importing a replaced legacy video produces a new Media row, and the earlier row is never overwritten, so hubs and runs that reference it keep serving what they verified. The logical identity (team, source host, legacy media ID) is stored separately so callers can list every generation of one legacy video.
- Output: a job ID; a status route returning `queued`, `running`, `done` with the V3 media ID, or `failed` with a reason. Asynchronous because transcoding takes minutes.
- Ledger reconciliation: this project's ledger schema is versioned (`ledgerVersion` in the header). `ledger export` emits JSONL with one row per entry carrying every header and entry field. The V3 table's schema and its conflict rules are the backend lane's to define (MIO-3824 question 11); when they exist, the export gains a `--format` for that shape. Until then the file is the interface, and that is an accepted open item, not a blocker for M1 or M2.

Nothing in M1 waits on this endpoint. M2 does.

## 10. Out of scope

Members and member profiles, payments and Stripe backfill, discussion content, Elasticsearch analytics, the legacy editor revision files, semantic search data, member notifications. Deleting anything on legacy. Writing to the legacy database. Automatic rollback on the target.

## 11. Open items to resolve during build

- Which legacy table backs live calls. Rule: live calls are not mapped and not promised for M1 until the source table is identified and a mapping to V3 events with attached recordings is written and reviewed.
- Whether the Atanas read-replica user is still active. `extract --check-access` proves it.
- Whether register-synthetic returns the storage key or only the media ID (6.3 step 2 covers both).
- The marker field and list call for every entity type, written into `docs/contracts.md` before any apply code is merged. Register-synthetic's description lands on File; the others are unconfirmed.
- Which legacy variant names carry the playback rendition, poster and captions for video, needed for 6.3 and 9.
- Whether legacy CDN URLs are signed for any content class. The playback check answers it per URL.

## 12. Decisions and accepted risks

Stated so a reviewer can disagree with the decision rather than report the gap.

- **Single operator per hub, enforced by lock file plus clean-and-current ledger directory.** Two operators pushing a ledger at the same moment can still race. Accepted: the team is small, the README names the rule, and the marker protocol (6.2) turns a duplicate into an adopt-or-resolve step rather than silent duplication.
- **S3 integrity relies on conditional copy plus S3-computed SHA256 and size, not on ETags.** Where the legacy object exposes no checksum, the destination checksum is recorded for future comparison and size is the only pre-copy match. Accepted: the conditional copy already guarantees the bytes are the ones extract saw.
- **HEAD-then-copy is the overwrite guard.** Destination keys are freshly allocated UUIDs, so the only collision is with our own retry. Accepted.
- **M1 serves public video from the legacy CDN.** The hub depends on legacy serving until M2, and `inventory` is the record of that dependency. Accepted by the user for the Wednesday demo.
- **Ledger export has no agreed target schema.** The backend lane owns it. Accepted as open until MIO-3824 question 11 is answered.
- **Rate-limit usage by other clients behind the same IP is invisible until a 429.** Accepted; the operator's machine is the only client during a run.
- **`apply --check-access` verifies the two authorization test members exist and does not create them.** Creating contacts on a production team as a side effect of a check flag is a surprise; the command prints the exact `mio contacts create` invocations instead.
- **Multipart copy for objects over 5 GB is not implemented in M1.** Every such object is video and therefore `pending-import`; the path throws with the equivalent `aws s3 cp` command rather than silently skipping.
- **Live calls have no legacy source.** A sweep of the legacy codebase found only a Zoom recording-import connector, no call, meeting or webinar model. Live calls on the target are net-new content, not migration.
- **M3 upsert on entities without a revision token runs in a maintenance window.** Until the contract shows a token for an entity type, concurrent human edits to that type during an upsert run can be lost. Accepted for M3, and the README says which types.
- **Full-object checksum comparison needs the source to expose one.** Where legacy objects carry no full-object CRC64NVME, verification is size plus the conditional copy. Accepted; the destination checksum is recorded so M2 and later runs compare properly.
- **Personal data may appear inside legacy settings JSON.** Mitigated by treating every local artifact as customer content and by report redaction, not by attempting to scrub JSON we do not fully understand. Accepted.
