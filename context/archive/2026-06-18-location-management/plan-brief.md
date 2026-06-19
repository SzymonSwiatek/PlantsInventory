# Location Management (S-02) — Plan Brief

> Full plan: `context/changes/location-management/plan.md`

## What & Why

Users can already create locations and add plants to them, but there's no way to **rename** a location, **delete** one, or **see how many plants each holds**. This slice adds those three management capabilities (PRD FR-005/006/007) — closing the basic CRUD loop for the catalog's top-level grouping.

## Starting Point

`/dashboard` server-renders a list of locations (`id, name`) with an inline create form posting to `/api/locations`. The schema already supports everything needed: `locations.name` has a length check, `plants.location_id` is `ON DELETE CASCADE`, and RLS scopes every operation to the owner. No rename/delete UI or endpoint exists, and counts aren't shown.

## Desired End State

Every dashboard location row shows its plant count (including "0 plants") and exposes rename + delete. Rename edits in place; delete opens an accessible AlertDialog that — when the location holds plants — warns how many plants and photos will be permanently removed. Confirming deletes the location, cascades its plants, and best-effort-removes their Storage photos.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| UI interaction pattern | SSR list + per-row React actions island (JSON endpoint) | Matches the `AddPlantForm` island+JSON precedent; smooth confirm/inline-edit without rewriting working SSR. | Plan |
| Non-empty delete warning | shadcn AlertDialog showing the plant count | Accessible, explicit about consequences, on-brand with shadcn (FR-006). | Plan |
| Photo cleanup on delete | Best-effort Storage delete in the endpoint, after row cascade | Prevents orphaned objects while honoring the user's intent; logs partial failures. | Plan |
| Control placement | Dashboard rows only | One surface to build/test; the list is the management hub (FR-007). | Plan |
| Plant counts | Badge on every row via one nested-aggregate query | Accurate, single round-trip, no N+1. | Plan |

## Scope

**In scope:** rename location; delete location (empty + non-empty, with count-bearing warning when non-empty); plant-count badge per row; best-effort photo cleanup on delete.

**Out of scope:** location reorder; moving plants between locations (S-03); undo/soft-delete; location notes/metadata; controls on the detail page; changes to the create flow.

## Architecture / Approach

Three layers, each independently verifiable. (1) **Read** — dashboard query gains `plants(count)`, rendered as a badge. (2) **Write** — new `src/pages/api/locations/[id].ts` with `PATCH` (rename) and `DELETE` (collect photo paths → delete row → best-effort `removePhotos`); a `removePhotos` helper joins `src/lib/storage.ts`. (3) **Interactive** — a `LocationActions` React island per row wires those endpoints, with the AlertDialog consuming the Phase-1 count. The existing form-POST create endpoint is untouched; the JSON `[id]` sibling coexists with it.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. List with counts | Plant-count badge on every row (SSR) | Nested-aggregate select shape (`plants(count)`) |
| 2. Rename + delete endpoint | `PATCH`/`DELETE /api/locations/[id]` + `removePhotos` | Collect photo paths *before* the cascade; best-effort cleanup semantics |
| 3. Actions island | Inline rename + AlertDialog delete on the dashboard | `<button>`-in-`<a>` nesting; react-compiler safety; focus handling |

**Prerequisites:** F-01 (auth) and F-02 (schema) — both done. No migration needed.
**Estimated effort:** ~1 session across 3 phases (trivial CRUD + one new endpoint + one island).

## Open Risks & Assumptions

- Best-effort photo cleanup can leave a few orphaned Storage objects on a partial failure — logged, accepted for MVP (no GC job this slice).
- Adds a second convention (JSON verbs) to the locations endpoint alongside the existing form-POST create — intentional, matches plants vs auth.

## Success Criteria (Summary)

- A user can rename a location and see it persist.
- A user can delete a location; a non-empty one warns with the plant count first, then removes the location, its plants, and (best-effort) their photos.
- Every location row shows an accurate plant count, including zero.
