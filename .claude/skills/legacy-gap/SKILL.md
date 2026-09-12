---
name: legacy-gap
description: Use when a migrated hub page looks or behaves differently from the legacy Searchie hub (spacing, alignment, colour, sizes, missing tiles, a section rendering empty, an element V3 draws that legacy did not) and the migration script has to be corrected or the difference recorded. Triggers include "legacy has X but ours shows Y", "why is this section empty", "the migrated hub shows", "fix the mapper", "/legacy-gap".
---

# Closing a gap between a legacy hub and its V3 copy

## The rule

The script maps every legacy hub-data value onto the V3 setting that exists for it. Where V3 has no setting, the gap is V3's limitation: record it as a `fidelity` warning and a radar row, never invent a workaround (no shell stacks, no colour baked into trees, no buttons legacy does not draw). Where the mapper itself was wrong, fix the mapper.

## The loop

1. **Check whether it is already known.** `grep -n <property> README.md`, the plan's fidelity summary (`map` prints it), and the radar artifact (see `references/apply-runbook.md`). A recorded limitation is answered by pointing at the row, not by re-investigating.
2. **Find the legacy data.** Locate the section in the newest `bundles/hub-*.json` by page slug, section id or title; dump the level-1 section, its columns and their elements with their `settings` JSON. The bundle is the truth, not the legacy screenshot.
3. **Read what legacy paints.** Use the file map in `references/renderer-map.md`; it names the exact searchie file and lines for each concern. Do not grep the whole repo again.
4. **Read what V3 accepts.** Same map, mio-hub side. The `settings-registry.ts` and the primitive component are authoritative; the mio skill's SKILL.md and catalog `defaults` are stale or unapplied.
5. **Decide by the rule.** V3 setting exists: add the fact to `src/map/profile/` and the translation to `src/map/translate/`, with a test. None: emit a `FidelityEntry` from the translator, add a radar row.
6. **Map and apply.** `references/apply-runbook.md` has the one command. Never run `apply` on this hub without `--resume`.
7. **Verify on the live hub** with `scripts/probe/hub-probe.mjs measure|shot|images`, not by eye alone. Compare the numbers to the legacy renderer's, not to a screenshot's.
8. **Record**: WORKLOG entry, radar row when a new limitation appeared, memory note.

## Red flags

- An apply command without `--resume run-…`: it will create a second hub.
- "I'll wrap it in a stack painted the right colour": that is a workaround; record instead.
- Re-deriving button, tile or scrim facts: they are in the renderer map with line numbers.
- Trusting a green exit from a shell wrapper around `apply`: read the apply log's last line.

## Common mistakes

| Mistake | Reality |
| --- | --- |
| Legacy column `styles.align` treated as horizontal | It is `justify-content`, vertical (`Column.vue:65-67`) |
| Snapping padding to a V3 token | `surface.padding` takes any px string |
| Listing a playlist's files for a playlist tile | Bind the card without `repeat`; V3's collection scope gives title, cover, link |
| Dropping tiles that are not playlists | Grid and scroll sections draw one tile per block, in legacy order |
| Leaving V3's image backdrop on | Legacy paints nothing under an `<img>`: `backdrop: false` |
