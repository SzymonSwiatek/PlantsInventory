# Plant Management (S-03) — Plan Brief

> Full plan: `context/changes/plant-management/plan.md`

## What & Why

Users can add plants from a photo (S-01) and manage locations (S-02), but there is no way to **open a plant and change anything about it**. This slice builds the plant detail screen (PRD FR-015/016/017): open a plant, see all its care info plus the original AI suggestion, edit any field in place, replace the photo, add a free-text note, and delete the plant — closing the catalog's CRUD loop at the plant level.

## Starting Point

The `plants` table already has every needed column (`name, species, description, note, sunlight, photo_path, ai_suggestion, watering_interval_days, winterization_cutoff`) with RLS and an updated-at trigger — **no migration**. The location page (`src/pages/locations/[id].astro`) lists plants as non-clickable cards; there is no `/plants/[id]` page and no `PATCH`/`DELETE` plant endpoint. S-02 just shipped the exact patterns to mirror: a `[id].ts` JSON endpoint, a `[id].test.ts` suite, and a `LocationActions` inline-edit + AlertDialog island. The photo upload flow (`upload-url` mint → direct PUT) already supports re-using an existing plant's id/folder.

## Desired End State

`/plants/<id>` shows the photo, name, and every care field. Each field is read-only text that becomes editable on click (per-field check/cancel), saving that one field via PATCH; the note is just a multi-line field. Where the original AI suggestion has a value, a display-only "AI suggested: …" hint sits beneath the field. The user can move the plant via a location `<select>`, replace the photo, and delete it (AlertDialog confirm → back to the location page). `ai_suggestion` and `user_id` are never mutated; a foreign/unknown id renders a 404.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Inline-editing model | Per-field click-to-edit (pencil → editor → check/cancel) | Directly matches FR-015 "no edit mode" and the shipped `LocationActions` rename pattern; small payloads, per-field error isolation. | Plan |
| Move between locations | Yes — `location_id` is an editable field (location `<select>`) | Honors S-02's "moving plants → S-03" hand-off + FR-015 "edit ANY field"; the same-user FK trigger already guards it. | Plan |
| Photo replacement | Yes — reuse the `upload-url` mint → direct-PUT flow | PRD Non-Goals explicitly says one photo "replaceable via plant edit"; the path already exists. | Plan |
| AI suggestion display | Per-field display-only "AI suggested: X" hints | Satisfies FR-015 "show original suggestion" with the lightest UI; null-safe for manual plants. | Plan |
| Note field | Same click-to-edit, multi-line textarea | Consistent interaction; PRD says note is a single field, not a journal. | Plan |
| Edit/delete safety | AlertDialog on delete; cancel-able edits, no post-save undo | Mirrors shipped patterns; per-field cancel is the safety net; US-03 undo is an S-04 care-action concern. | Plan |
| Post-delete destination | Back to the plant's location page | Natural "up one level"; the page already knows `location_id`. | Plan |
| Typed-field editors | Type-appropriate inline editors (text / textarea / number / date+toggle / select) | Correct validation per type, consistent with the create form. | Plan |

## Scope

**In scope:** SSR plant detail page + 404; clickable plant cards; per-field inline edit of name/species/description/sunlight/watering/winterization/note; move location; free-text note; photo replacement; delete (confirmed); `PATCH`/`DELETE /api/plants/[id]` + tests; display-only AI hints.

**Out of scope:** reminder/care-action logic (S-04/S-05); undo/soft-delete/toasts; multi-photo gallery; journaling; editing `ai_suggestion`; new fields; create-flow changes.

## Architecture / Approach

Four independently-verifiable layers mirroring S-02's read → write → interactive split, with photo-replace isolated as the heaviest piece. (1) **Read** — `src/pages/plants/[id].astro` SSR-fetches the plant (RLS-scoped) + signed photo URL, renders fields read-only with AI hints, 404 fallback; location cards link to it. (2) **Write** — new `src/pages/api/plants/[id].ts` `PATCH` (strict field whitelist; never `ai_suggestion`/`user_id`) + `DELETE` (collect path → delete → best-effort `removePhotos`), with unit tests. (3) **Interactive** — a `PlantDetail` island + reusable `EditableField` replace the static fields with per-field click-to-edit and the delete dialog. (4) **Photo** — reuse mint→PUT against the existing `plantId`, PATCH `photo_path`, clean up the orphaned old object.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Detail page (read) + nav | SSR `/plants/[id]` with all fields + AI hints + 404; clickable cards | RLS-scoped fetch + null `ai_suggestion` handling |
| 2. Update/delete endpoint | `PATCH`/`DELETE /api/plants/[id]` + unit tests | Strict whitelist (no `ai_suggestion`/`user_id`); location-FK 23514 → 400 |
| 3. Editable island | Per-field click-to-edit (typed editors), AI hints, delete dialog | Busiest UI; react-compiler safety; per-field state + typed editors |
| 4. Photo replacement | Replace photo, update `photo_path`, clean old object | Filename change → new key → orphan cleanup; upload timeout/retry |

**Prerequisites:** S-01 (done) — schema, storage, and the upload flow all exist. No migration.
**Estimated effort:** ~1–2 sessions across 4 phases (rides S-02 patterns; Phase 3 + 4 carry the weight).

## Open Risks & Assumptions

- Photo-replace can leave an orphaned Storage object on a partial cleanup failure — best-effort, logged, accepted for MVP (consistent with S-02).
- The per-field PATCH whitelist is the only guard keeping `ai_suggestion` write-once at the API layer — must be enforced and unit-tested.
- Moving a plant relies on the existing same-user FK trigger; no extra ownership check is added in app code.

## Success Criteria (Summary)

- A user can open any plant, edit any field in place, and see each change persist independently.
- A user can move a plant to another location, replace its photo, add a note, and delete the plant (with confirmation).
- The original AI suggestion is visible but never altered; no plant or photo is ever exposed across users.
