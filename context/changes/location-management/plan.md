# Location Management (S-02) Implementation Plan

## Overview

Give a signed-in user the three location-management capabilities the schema already supports but no UI exposes: **rename** a location, **delete** a location (with a warning when it still contains plants, FR-006), and **see all locations with their plant counts** (FR-007). The dashboard stays server-rendered; rename/delete are driven by a small React actions island per row (mirroring the `AddPlantForm` island + JSON-endpoint precedent), and delete does best-effort cleanup of the deleted plants' Storage photos.

PRD refs: FR-005 (rename), FR-006 (delete + non-empty warning), FR-007 (list with counts). Roadmap slice: S-02 `location-management`.

## Current State Analysis

- **Locations list** lives on `src/pages/dashboard.astro` — server-rendered, queries `locations (id, name)` ordered by `created_at`, with an inline create form that POSTs to `/api/locations`. No counts, no rename, no delete.
- **`src/pages/api/locations.ts`** has only a `POST` (create) handler using the **form-POST → redirect** convention (`?error=` query param on failure), distinct from the **JSON `fetch`** convention used by `/api/plants/*` (`src/lib/api.ts` `json()` / `requireUser()`).
- **`src/pages/locations/[id].astro`** is the detail page (name + plant list) — out of scope for management controls this slice.
- **Schema** (`supabase/migrations/20260608171954_core_domain_schema.sql`): `plants.location_id` is `ON DELETE CASCADE`, so deleting a location DB-cascades its plant rows. `locations.name` has a `check (char_length(btrim(name)) between 1 and 100)`. An `updated_at` trigger already fires on update.
- **RLS** scopes locations per-user on every operation (`select/insert/update/delete to authenticated using (auth.uid() = user_id)`). A foreign/unknown id returns no row — `update`/`delete` against another user's id are silent no-ops; no extra ownership guard is needed in the endpoint.
- **Storage**: photos live in the private `plant-photos` bucket under `<uid>/<plantId>/` (`src/lib/storage.ts`, `PHOTO_BUCKET`). The DB cascade deletes plant *rows* but **cannot reach Storage** — without explicit cleanup, deleting a non-empty location orphans those objects.
- **UI kit** (`src/components/ui/`): `alert, button, card, checkbox, input, label, skeleton, textarea`. **No `alert-dialog`** — must be added with `npx shadcn@latest add alert-dialog`.
- **Middleware** (`src/middleware.ts`): `PROTECTED_ROUTES = ["/dashboard", "/locations"]`. `/api/*` is **not** guarded — every endpoint self-guards via `requireUser`.

### Key Discoveries:

- Plant counts come free in one round-trip via Supabase's nested aggregate: `locations.select("id, name, plants(count)")` returns `plants: [{ count: N }]` per row — no N+1, no separate query (`src/pages/dashboard.astro:9`).
- The JSON endpoint pattern to follow is `src/pages/api/plants/index.ts` + `src/lib/api.ts`. **Note:** `src/lib/api.ts` currently exports only `json()` and `requireUser()`. `CLIENT_ERROR_CODES` (SQLSTATE → 400 vs 500 mapping) is a local const in `plants/index.ts:25`, and `UUID_RE` is already duplicated across `plants/index.ts:20` and `upload-url.ts:23`. Phase 2 **extracts both into `src/lib/api.ts`** so all consumers (the two existing endpoints + the new one) import them instead of copying — see Phase 2 §1.
- The island pattern to follow is `src/components/plants/AddPlantForm.tsx` — `fetch` to a JSON endpoint, local state, `window.location` reload on success.
- The batch Storage helper precedent is `signedPhotoUrls` (`src/lib/storage.ts:32`) — the new `removePhotos` sits beside it and uses the same `PHOTO_BUCKET` constant.

## Desired End State

On `/dashboard`, every location row shows its plant count (including "0 plants"). Each row exposes rename and delete actions. Rename edits the name in place and persists via `PATCH /api/locations/[id]`. Delete opens an AlertDialog; for a non-empty location the dialog states how many plants (and their photos) will be permanently removed; confirming fires `DELETE /api/locations/[id]`, which deletes the row (cascading plant rows) and best-effort-removes the plants' Storage photos. The list refreshes to reflect the change. All operations are RLS-scoped to the owner.

**Verification**: rename persists across reload; deleting a non-empty location removes it, its plants, and (best-effort) their photos, with the count-bearing warning shown first; counts are accurate; another user's location id cannot be renamed or deleted.

## What We're NOT Doing

- **Location reorder / sorting** — deferred (roadmap Parked).
- **Moving plants between locations** — belongs to S-03 plant management.
- **Undo / soft-delete for location delete** — the AlertDialog confirm is the safety net; no soft-delete schema or GC.
- **Location description / notes / metadata** — schema has only `name`; not in FR-005/006/007.
- **Rename/delete on the `/locations/[id]` detail page** — controls live on the dashboard rows only this slice.
- **Changing the existing create flow** — `/api/locations` `POST` and the dashboard create form stay as-is.

## Implementation Approach

Three vertical-ish phases, each independently verifiable: (1) read path — add counts to the SSR list; (2) write path — a JSON `[id]` endpoint for rename + delete with Storage cleanup; (3) interactive path — a per-row React island wiring those endpoints with the AlertDialog warning. Phase 1 surfaces the count that Phase 3's dialog consumes, so the ordering is load-bearing. The locations endpoint gains a JSON sibling (`/api/locations/[id].ts`) for the verb-based mutations while the existing form-POST create endpoint is left untouched — the two conventions coexist, matching how plants vs auth already differ.

## Critical Implementation Details

- **Delete ordering & photo cleanup**: collect the location's plant `photo_path`s *before* deleting the location row (after the cascade the rows are gone and the paths are unrecoverable). Delete the row, then call `removePhotos` best-effort — a Storage failure is logged but the request still returns success (the user's intent — remove the location — succeeded; orphaned objects are a cleanup nuisance, not a user-facing failure).
- **Empty vs non-empty delete UX**: FR-006 only mandates a warning when the location *contains plants*. The AlertDialog still confirms an empty delete but with lighter copy (no plant/photo count line). The count is already known client-side from Phase 1, so no extra fetch is needed to decide which copy to show.

## Phase 1: Locations list with plant counts (FR-007)

### Overview

Surface a plant count on every location row, computed in a single query, without changing the page's server-rendered shape.

### Changes Required:

#### 1. Dashboard list query + render

**File**: `src/pages/dashboard.astro`

**Intent**: Include each location's plant count in the existing list query and render it as a badge on every row (including "0 plants"), so FR-007 is satisfied and Phase 3's delete dialog has a count to display.

**Contract**: Change the select to the nested-aggregate form `select("id, name, plants(count)")` (ordering unchanged). Each row's count is `loc.plants[0]?.count ?? 0`. Render the number alongside the existing name/`→` row. Keep the empty-state and create-form markup untouched.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build` (Astro type-check via `astro sync` + tsc)
- Linting passes: `npm run lint`
- `astro sync` regenerates types cleanly: `npx astro sync`

#### Manual Verification:

- Each location row shows an accurate plant count; a location with no plants shows "0 plants".
- A location with N plants shows N; adding/deleting a plant updates the count on reload.
- The create form and empty state still render and work.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Rename + delete JSON endpoint

### Overview

Add the server-side mutation surface: a JSON `[id]` endpoint supporting rename (`PATCH`) and delete (`DELETE`), plus a Storage cleanup helper. No UI yet — verifiable via `curl` / unit checks against a signed-in session.

### Changes Required:

#### 1. Extract shared validation/error constants

**File**: `src/lib/api.ts` (+ update `src/pages/api/plants/index.ts`, `src/pages/api/plants/upload-url.ts`)

**Intent**: The new endpoint needs `UUID_RE` and `CLIENT_ERROR_CODES`; rather than add a third copy, lift them into the shared `api.ts` so all three consumers import one source of truth (and the existing UUID_RE duplication is removed).

**Contract**: Add `export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;` and `export const CLIENT_ERROR_CODES = new Set(["23514", "23503", "42501"]);` to `src/lib/api.ts` (keep the explanatory SQLSTATE comment). Update `plants/index.ts` and `upload-url.ts` to delete their local `const UUID_RE` and import it from `@/lib/api`; update `plants/index.ts` to import `CLIENT_ERROR_CODES` from `@/lib/api` and drop its local const. Pure move — no behavior change; `npm run lint` + `npm run build` confirm no broken references. (`PHOTO_BUCKET` is left as-is — `removePhotos` lives in `storage.ts` beside the existing const.)

#### 2. Storage cleanup helper

**File**: `src/lib/storage.ts`

**Intent**: Add a batch delete helper so the delete endpoint can remove the orphaned plant photos after the row cascade, reusing the existing `PHOTO_BUCKET`.

**Contract**: `export async function removePhotos(supabase, paths: string[]): Promise<void>` — no-op on empty input; calls `supabase.storage.from(PHOTO_BUCKET).remove(paths)`; on error, log and return (best-effort, never throws). Mirror the null-tolerant style of `signedPhotoUrls`.

#### 3. Rename + delete endpoint

**File**: `src/pages/api/locations/[id].ts` (new)

**Intent**: Provide verb-based JSON mutations for a single location, self-guarded and RLS-scoped, following the `/api/plants` endpoint conventions.

**Contract**:
- Both handlers: `requireUser(context)` (401 JSON if absent); read `context.params.id`, 400 (`invalid_id`) if missing/not a UUID (import `UUID_RE` from `@/lib/api`, per §1); build `createClient`, 503 (`supabase_unavailable`) if null.
- `PATCH`: parse JSON body, read+trim `name`; validate 1–100 chars → 400 (`invalid_name`) otherwise; `supabase.from("locations").update({ name }).eq("id", id)`. Map SQLSTATE via `CLIENT_ERROR_CODES` imported from `@/lib/api` (23514 → 400 `invalid_request`) else 500. Return `json({ id }, 200)`. (RLS makes a foreign id a no-op; an update affecting zero rows is not an error.)
- `DELETE`: query `plants.select("photo_path").eq("location_id", id)` to collect non-null paths **before** deleting; `supabase.from("locations").delete().eq("id", id)`; on DB error map via `CLIENT_ERROR_CODES`; then `await removePhotos(supabase, paths)` (best-effort, after the row delete succeeds). Return `json({ id }, 200)`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Unit tests pass: `npm run test:run` — **required this phase** (Phase 2 ships no UI, so these tests are its standalone gate): one covering `removePhotos` (no-op on empty, swallows Storage errors) and one covering endpoint validation (`invalid_id`, `invalid_name` bounds, 401, 503).

#### Manual Verification:

- `PATCH` with a valid name renames the location (verify via dashboard reload); name <1 or >100 chars returns 400.
- `DELETE` on an empty location removes it; `DELETE` on a non-empty location removes it, cascades its plants, and removes their Storage objects (verify the bucket folder is gone).
- Renaming/deleting another user's location id is a no-op (no error, no cross-user effect).
- Unauthenticated request returns 401; unconfigured Supabase returns 503.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Dashboard actions island

### Overview

Add the interactive layer: a per-row React island for inline rename and delete, with a shadcn AlertDialog that surfaces the plant count before a destructive delete.

### Changes Required:

#### 1. AlertDialog component

**File**: `src/components/ui/alert-dialog.tsx` (new, generated)

**Intent**: Bring in the accessible confirm-dialog primitive for the delete warning.

**Contract**: `npx shadcn@latest add alert-dialog` (new-york style, already configured). No hand-edits beyond what the generator produces.

#### 2. Location actions island

**File**: `src/components/locations/LocationActions.tsx` (new)

**Intent**: Render rename + delete affordances for one location row, calling the Phase 2 endpoints and refreshing the list on success.

**Contract**: `Props { id: string; name: string; plantCount: number }`. Rename: inline edit (input + save/cancel) → `PATCH /api/locations/{id}` with `{ name }`; on success `window.location.reload()`. Delete: a trigger opening `AlertDialog`; dialog copy shows the plant/photo count line **only when `plantCount > 0`** (FR-006), lighter copy otherwise; confirm → `DELETE /api/locations/{id}` → reload on success. Surface request failures inline (reuse `Alert`/`destructive` like `AddPlantForm`). Keep the component react-compiler-safe (no prop mutation, hook rules).

#### 3. Wire island into dashboard rows

**File**: `src/pages/dashboard.astro`

**Intent**: Mount the island on each location row, passing the id, name, and the Phase 1 count, without breaking the existing link-to-detail navigation.

**Contract**: Recompose the row so the action controls are a **sibling** of the navigation anchor, not nested inside it (no `<button>`-in-`<a>`). Today the whole row is one full-width `<a href="/locations/{id}">` (dashboard.astro:66–72); split it:

- `<li class="flex items-center justify-between rounded-2xl border border-white/10 bg-white/10 px-5 py-4 backdrop-blur-xl transition-colors hover:bg-white/20">` — the flex/card styling moves from the anchor up to the `<li>`.
- Left: `<a href={`/locations/${loc.id}`} class="flex items-center gap-3 …">` wrapping **only** the name `<span>` and the plant-count badge from Phase 1. Drop the standalone `→` glyph — the name link now carries navigation.
- Right: `<LocationActions client:load id={loc.id} name={loc.name} plantCount={count} />` as a right-aligned sibling.
- While inline-renaming, `LocationActions` swaps the displayed name for an `<input>` (the rename UI lives entirely inside the island; the left-hand `<a>` shows the name only in the non-editing state).

Keep the empty-state and create-form markup untouched.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint` (including `react-compiler/react-compiler`)
- `astro sync` clean: `npx astro sync`

#### Manual Verification:

- Renaming a location from the dashboard persists and shows the new name after refresh.
- Deleting an **empty** location shows a confirm with no plant-count line; confirming removes it.
- Deleting a **non-empty** location shows a warning naming the plant count; confirming removes the location, its plants, and their photos; canceling leaves everything intact.
- Failure paths (e.g. server down) surface an inline error rather than silently doing nothing.
- Keyboard/focus works in the AlertDialog (Esc cancels, focus trapped).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `removePhotos`: no-op on empty input; swallows Storage errors (best-effort contract).
- Endpoint validation: `invalid_id` (non-UUID), `invalid_name` (length bounds), 401 when unauthenticated, 503 when Supabase unconfigured. **Required in Phase 2** (not optional) — follow the style of `src/pages/api/plants/suggest.fault.test.ts`. These are Phase 2's real standalone gate since it ships no UI to manually exercise.

### Integration / Manual Testing Steps:

1. Sign in; create a location with 0 plants and one with ≥1 plant.
2. Rename each from the dashboard; reload — names persist.
3. Delete the empty one — confirm copy has no count line; it disappears.
4. Delete the non-empty one — confirm copy names the plant count; after confirm, location + plants gone and the `<uid>/<plantId>/` Storage objects are removed.
5. As a second user, attempt (via crafted request) to rename/delete the first user's location id — no effect, no error leak.

## Performance Considerations

Counts use one nested-aggregate query (no N+1). Delete adds one `select` (collect paths) + one `delete` + one batch Storage `remove` — all bounded by the (small) number of plants in a single location. Negligible at the PRD's "dozens of plants" scale.

## Migration Notes

No schema migration — the schema already supports rename (`update`), delete (`ON DELETE CASCADE`), and counts (FK relationship). This slice is application-layer only.

## References

- Roadmap slice S-02: `context/foundation/roadmap.md`
- JSON endpoint + guard conventions: `src/lib/api.ts`, `src/pages/api/plants/index.ts`
- Island precedent: `src/components/plants/AddPlantForm.tsx`
- Storage helpers + bucket: `src/lib/storage.ts`
- Schema + RLS: `supabase/migrations/20260608171954_core_domain_schema.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Locations list with plant counts (FR-007)

#### Automated

- [x] 1.1 Type checking passes: `npm run build` — 3f85e43
- [x] 1.2 Linting passes: `npm run lint` — 3f85e43
- [x] 1.3 `astro sync` regenerates types cleanly: `npx astro sync` — 3f85e43

#### Manual

- [x] 1.4 Each location row shows an accurate plant count, including "0 plants" — 3f85e43
- [x] 1.5 Count updates on reload after adding/deleting a plant — 3f85e43
- [x] 1.6 Create form and empty state still render and work — 3f85e43

### Phase 2: Rename + delete JSON endpoint

#### Automated

- [x] 2.1 Type checking passes: `npm run build`
- [x] 2.2 Linting passes: `npm run lint`
- [x] 2.3 Unit tests pass: `npm run test:run`

#### Manual

- [x] 2.4 PATCH renames with valid name; name length bounds return 400
- [x] 2.5 DELETE removes empty + non-empty locations, cascades plants, removes Storage objects
- [x] 2.6 Cross-user rename/delete is a no-op
- [x] 2.7 Unauthenticated returns 401; unconfigured Supabase returns 503

### Phase 3: Dashboard actions island

#### Automated

- [ ] 3.1 Type checking passes: `npm run build`
- [ ] 3.2 Linting passes: `npm run lint` (incl. react-compiler)
- [ ] 3.3 `astro sync` clean: `npx astro sync`

#### Manual

- [ ] 3.4 Rename from dashboard persists after refresh
- [ ] 3.5 Empty-location delete confirm has no count line; removes it
- [ ] 3.6 Non-empty delete warns with plant count; removes location + plants + photos; cancel is a no-op
- [ ] 3.7 Failure paths surface an inline error
- [ ] 3.8 AlertDialog keyboard/focus behavior works (Esc cancels, focus trapped)
