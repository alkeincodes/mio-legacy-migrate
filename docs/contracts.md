# V3 entity contracts

`apply` parses the table below at startup and refuses to mutate any entity type
whose row is missing or whose `verified` column reads `no`. Keep the table
honest: a guess recorded as verified is worse than a missing row.

Column meanings: `create` is the call that brings the entity into existence.
`marker field` is where the deterministic marker string is stored.
`marker strategy` is `field` (a dedicated free-text column), `name-suffix`
(appended to the display name because the entity has no free-text column) or
`none` (the entity is identified by something the ledger already resolves).
`list by marker` is how apply finds an existing entity before creating one.
`revision token` is the field a conditional update sends. `idempotency` is the
header the route accepts, if any.

| entity | create | marker field | marker strategy | list by marker | revision token | idempotency | verified |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hub | `POST /api/v1/teams/{team_id}/hubs/` (`mio hubs create --name --slug --meta-json`) | `meta.lgcMarker` | field | `GET /api/v1/teams/{team_id}/hubs/` paginated by `page[size]`/`page[after]`, filter client-side on `attributes.meta.lgcMarker` | `ETag` from `hub_etag_token(updated_at)`, sent as optional `If-Match`, 409 `stale_hub` on mismatch | none | yes |
| page | `POST /api/v1/teams/{team_id}/hubs/{hub_id}/pages/` (note trailing slash) | `meta.lgcMarker` | field | `GET .../pages/` paginated, filter client-side on `attributes.meta.lgcMarker` | `draft_version` (integer), sent as `If-Match` on `PUT .../tree` and `POST .../publish`; 428 `precondition_required` when absent, 400 `invalid_if_match` on a weak validator, 409 `stale_draft` on mismatch | none | yes |
| playlist | `POST /api/v1/teams/{team_id}/playlists` (`mio media playlists create`) | `description` | field | `GET /api/v1/teams/{team_id}/playlists` paginated, filter client-side | none | none | yes |
| folder | `POST /api/v1/teams/{team_id}/folders` (`mio media folders create --name`) | `name` | name-suffix | `GET /api/v1/teams/{team_id}/folders` paginated, filter client-side on the name suffix | none | none | yes |
| asset | `POST /api/v1/admin/teams/{team_id}/files/synthetic` (`mio media files register-synthetic`) | `description` on the File row | field | `GET /api/v1/teams/{team_id}/files` with `page[size]=100`, filter client-side on `attributes.description` | none | none | yes |
| space | `POST /api/v1/admin/teams/{team_id}/hubs/{hub_id}/spaces/` (`mio community spaces create`) | `description` | field | `GET .../spaces/` paginated, filter client-side | none | none | yes |
| achievement | `POST /api/v1/teams/{team_id}/achievements` (`mio achievements create`) | `description` | field | `GET /api/v1/teams/{team_id}/achievements` paginated, filter client-side | none | none | yes |
| segment | `POST /api/v1/teams/{team_id}/segments` (`mio segments create`) | `description` (max 2000 chars) | field | `GET /api/v1/teams/{team_id}/segments` paginated, filter client-side | none exposed. `segments.definition_version` exists in the DB but is absent from the read schema and rejected on write by `_ForbidExtra` | none | yes |
| accessRule | `POST /api/v1/teams/{team_id}/hubs/{hub_id}/access-rules` (`mio access-rules rules create`) | none | none | `GET .../access-rules` paginated, match on `target_type` plus `target_id`, both of which the ledger already resolves | none | none | yes |
| navigation | `PATCH /api/v1/teams/{team_id}/hubs/{identifier}` with `attributes.navigation` (there is no navigation endpoint) | none | none | read `attributes.navigation` back from `GET .../hubs/{identifier}`; the blob is written wholesale so it is idempotent by construction | the hub `ETag` | none | yes |

## Known limits recorded here on purpose

- **Asset visibility.** V3 stores visibility on the `Media` row (`public` |
  `unlisted` | `private`) and surfaces it as `attributes.visibility` on the File
  API. It is writable at registration and through
  `PATCH /api/v1/teams/{team_id}/files/{id}`. A per-hub override exists on the
  `HubMedia` join with a different value set (`members` | `private` | `public`).
  The two are not the same axis; apply writes the `Media` value and lets
  container gating do the rest.
- **`GET /api/v1/teams/{team_id}/files` drops rows whose `media_id` is NULL** and
  hard-filters `origin = 'library'`. Synthetic registrations set
  `origin = 'library'`, so they are listed, but a marker scan must still page all
  the way through because there is no filter parameter of any kind.
- **Synthetic files are never indexed for search.** `register_synthetic_file`
  deliberately does not emit `MediaUploaded`, so
  `GET /api/v1/teams/{team_id}/search/media` will never find one. Do not build
  marker lookup on it.
- **`asset_kind` accepts only `document` or `pdf`.** A migrated image is
  registered as `document`.
- **Only pages and hubs have concurrency control.** Playlists, folders, spaces,
  achievements, segments, access rules and media files are last-write-wins. Two
  tools running concurrently against those clobber each other with no error. This
  is why M3 upsert on those types needs a maintenance window.
- **Three scaffold routes exist that would do a hub rebuild transactionally**
  (`POST /api/v1/teams/{team_id}/hubs/from-template` and the two page-scaffold
  routes). All three ship behind flags that default to false and return a bare
  405 with `Allow: GET` while off, which is indistinguishable from a backend that
  never had them. If they are ever enabled on the target, they are strictly
  better than hand-driving create then tree then publish, and this tool should be
  revisited. UNVERIFIED whether they will be enabled for ManTalks.
- **Access rule condition payloads.** `condition_data` is an unconstrained JSONB
  column. UNVERIFIED whether the service rejects unknown keys per
  `condition_type`. Apply sends only the three documented condition types
  (`has_entitlement`, `in_segment`, `past_drip_date`) with their documented
  shapes.
- **Segments are not created in M1.** `POST /api/v1/teams/{team_id}/segments`
  demands a typed condition tree (`conditions.version: 1`, `groups[].logic:
  "AND"`, discriminated condition members, `app/segments/schemas.py:801-805`)
  and no legacy-to-V3 condition mapping exists yet. The segments stage records
  each legacy segment as unmapped; every access rule that depends on one is
  skipped, and the page that rule would have gated stays unpublished.
- **Navigation url items store root-relative hrefs only**
  (`app/hubs/validation.py:329-354`). A same-origin legacy link is rewritten to
  its path; an off-site link is dropped with a run warning.
- **The folder marker rides in the name** as ` [lgc:...]`, because folders
  have no free-text column. Adoption matches on that suffix.
- **Achievements and segments require `Content-Type: application/vnd.api+json`**
  (`require_jsonapi_content_type`); the client sends it on every write.
- **Reserved page slugs.** `POST .../pages/` answers 422 `page_slug_reserved`
  for a slug that collides with a built-in route
  (`app/pages/service.py` `RESERVED_SLUGS`, 23 entries): access-denied, account, align, banned, discussions, editor-fixture, forgot, forgot-password, history, home, legal, login, members, messages, moderation, my-list, notifications, onboarding, payment, playlists, register, reset-password, search. The mapper appends `-page` to any of these, records the
  rename in the plan, rewrites internal links to the new slug, and the verify
  report lists every rename.
- **The content page type is pinned to the slug `content`** and the slug
  `content` to that type (`content_page_slug_type_mismatch`). The mapper maps
  the legacy `content` page type to V3 `content` at that slug and moves any
  other page off it.
- **The catalog has no page-level templates.** The root node's `template`
  (`page-generic`, `page-content`, ...) is not in the catalog and the backend
  does not validate it; sections below the root must carry catalog templates.
- **`--accept-plan-change` refuses when any done entry would differ under the
  new plan.** `--rewrite-pages` relaxes that for page trees only: differing
  trees are rewritten (If-Match on draft_version) and republished, which is how
  a content mapping fix reaches a hub that is already applied. Every other kind
  must still hash identically.
