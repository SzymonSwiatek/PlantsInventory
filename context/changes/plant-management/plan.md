# Plant Management (S-03) Implementation Plan

## Overview

Build the plant detail screen (PRD FR-015/016/017): a signed-in user opens a plant, sees all of its stored care info plus the original AI suggestion, edits **any field in place** (no separate read/edit mode), can **replace the photo**, **delete** the plant, and **add a free-text note**. This is the third slice in the plant-catalog stream (S-01 → S-02 → S-03) and rides on the JSON-endpoint + React-island patterns shipped by S-02 (location-management). No schema migration is required — every field already exists on the `plants` table.

## Current State Analysis

- **Schema is complete.** `plants` (`supabase/migrations/20260608171954_core_domain_schema.sql:45-66`) already has `name, species, description, note, sunlight, photo_path, ai_suggestion (jsonb), watering_interval_days, winterization_cutoff` (plus reminder columns owned by S-04/S-05). RLS scopes all four operations to `auth.uid()`; an `updated_at` trigger fires on update; a BEFORE trigger (`assert_plant_location_same_user`) rejects a `location_id` not owned by the caller — so moving a plant between locations is already guarded server-side. The `note` column exists but is surfaced nowhere today.
- **No detail page.** `src/pages/locations/[id].astro:64-80` renders plant cards as plain `<li>` items (not links); there is no `src/pages/plants/[id].astro`.
- **No update/delete endpoint.** Under `src/pages/api/plants/` only `index.ts` (create, POST), `suggest.ts`, and `upload-url.ts` exist. There is no `[id].ts`.
- **`ai_suggestion` is write-once by convention** (`src/types.ts:30-42`, schema comment lines 40-44): S-01 sets it on create; edits never overwrite it. The detail screen reads it for the FR-015 "original suggestion" requirement.
- **Patterns to mirror (S-02, just shipped):**
  - `src/pages/api/locations/[id].ts` — `PATCH`/`DELETE` JSON endpoint, RLS-scoped via the cookie client, `requireUser`/`json`/`UUID_RE`/`CLIENT_ERROR_CODES` from `src/lib/api.ts`, best-effort `removePhotos` on delete (collect paths **before** the cascade).
  - `src/pages/api/locations/[id].test.ts` — Vitest unit tests over the exported handlers with a mocked `createClient` (validation/401/400/503 paths).
  - `src/components/locations/LocationActions.tsx` — inline rename (pencil → `Input` → check/cancel), `AlertDialog` delete, `Alert` error surface, `window.location.reload()` on success.
- **Photo upload flow is reusable** (`src/components/plants/AddPlantForm.tsx:94-144`, `src/pages/api/plants/upload-url.ts`): mint a signed upload URL (object key `<uid>/<plantId>/<sanitizedFilename>`) → browser `PUT`s the full-res file directly to Storage with `x-upsert: true`. `upload-url` already accepts a supplied `plantId` (the retake path), so an existing plant can re-use its own id/folder. Read URLs come from `signedPhotoUrl` / `signedPhotoUrls` in `src/lib/storage.ts`.

## Desired End State

Navigating to `/plants/<id>` shows the plant's photo, name, and every care field. Each field is text by default and becomes editable on click (per-field check/cancel), saving that single field through `PATCH /api/plants/<id>`. The note is one of those editable fields (multi-line). Where the original AI suggestion holds a value for a field, a display-only "AI suggested: …" hint sits beneath it. The user can change the plant's location via a `<select>` of their own locations, replace the photo, and delete the plant (confirmed via an `AlertDialog`, landing back on the plant's location page). A foreign or unknown id renders a 404 state. `ai_suggestion` and `user_id` are never mutated.

### Key Discoveries:

- All editable columns already exist — no migration (`supabase/migrations/20260608171954_core_domain_schema.sql:45-66`).
- The same-user FK trigger already makes `location_id` reassignment safe (`...schema.sql:121-138`) — a foreign location id surfaces as SQLSTATE `23514`, already in `CLIENT_ERROR_CODES` (`src/lib/api.ts:15`).
- Photo path = `<uid>/<plantId>/<filename>` (`src/pages/api/plants/upload-url.ts:71`). On replace, a **different filename produces a different key**, so `photo_path` must be PATCHed to the new value and the old object best-effort removed — overwrite-in-place only happens when the filename is identical.
- `requireUser` returns a `Response` on failure that the handler must short-circuit on (`src/lib/api.ts:32-38`); `/api/*` is outside the middleware guard, so the new endpoint self-guards.

## What We're NOT Doing

- **No reminder/care-action logic** — `watering_interval_days` and `winterization_cutoff` are editable as plain profile fields; `last_watered_at`, `next_water_due_at`, `winterized_at`, snooze, "mark watered/winterized", and the today-list are S-04/S-05.
- **No post-save undo / soft-delete / toast system** — the per-field check/cancel is the safety net; delete is guarded by an `AlertDialog` only. (US-03's undo window is a care-action concern in S-04, not these edits.)
- **No multi-photo gallery / history** — one current photo per plant, replaceable (PRD Non-Goal).
- **No journaling** — `note` is a single free-text field, not a timestamped log (PRD FR-017 resolution).
- **No edits to `ai_suggestion`** — read-only snapshot; PATCH must reject/ignore it.
- **No new editable fields beyond the existing columns** — no tags, no custom fields.
- **No changes to the create flow** (`AddPlantForm`, `POST /api/plants`, `suggest`, `upload-url`) beyond reusing `upload-url` as-is.

## Implementation Approach

Four phases, each independently verifiable, mirroring S-02's read → write → interactive layering, with photo replacement isolated as the heaviest sub-task:

1. **Read + navigation** — the SSR detail page renders all fields (read-only) and wires the location list's cards to it. Shippable and verifiable before any write path exists.
2. **Write endpoint** — `PATCH`/`DELETE /api/plants/[id]` with unit tests, mirroring the locations sibling. Verifiable via tests alone.
3. **Editable island** — a `PlantDetail` React island replaces the read-only field rendering with per-field click-to-edit (type-appropriate editors), display-only AI hints, and the delete dialog.
4. **Photo replacement** — reuse the mint→PUT flow against the existing `plantId`, PATCH `photo_path`, best-effort remove a now-orphaned old object, refresh the signed read URL.

## Critical Implementation Details

- **Photo-replace path change & orphan cleanup.** The object key embeds the filename. On replace, mint with the existing `plantId`; if the new sanitized filename differs from the current one the new key differs, so the client must PATCH `photo_path` to the minted `path` and the endpoint (or a follow-up DELETE of the stale object) must best-effort remove the prior object. Only an identical filename overwrites in place (`x-upsert`) with no `photo_path` change. Treat orphan removal as best-effort (log, don't fail the user) — consistent with `removePhotos` semantics in S-02.
- **`PATCH` is a strict field whitelist.** Only `name, species, description, sunlight, note, watering_interval_days, winterization_cutoff, location_id, photo_path` may be written. `ai_suggestion`, `user_id`, `id`, timestamps, and all reminder columns are never accepted from the body. A `location_id` owned by another user comes back as a trigger `check_violation` (23514) → 400, not 500.

## Phase 1: Plant detail page (read) + navigation

### Overview

Stand up `/plants/<id>` as an SSR page that fetches the plant (RLS-scoped), mints a signed read URL for its photo, renders all fields read-only with AI-suggestion hints, and falls back to a 404 state for a foreign/unknown id. Make the location page's plant cards link to it.

### Changes Required:

#### 1. Plant detail page

**File**: `src/pages/plants/[id].astro` (new)

**Intent**: Server-render the full plant profile for the owner, following the SSR + 404-fallback shape of `src/pages/locations/[id].astro`. Fetch the plant by id (`maybeSingle()` → RLS makes a foreign id return no row → set `Astro.response.status = 404` and render a not-found card). Mint the photo read URL with `signedPhotoUrl`. Render photo, name, species, description, sunlight, watering interval, winterization cutoff, and note as read-only text, with a breadcrumb back to `/locations/<location_id>`. Where `ai_suggestion.<field>` is non-null, show a small "AI suggested: …" hint under the corresponding field. This phase renders statically; Phase 3 swaps the field block for the interactive island.

**Contract**: New route `GET /plants/[id]`. Selects the plant's full row (all editable fields + `ai_suggestion` + `location_id` + `photo_path`) scoped by RLS; 404 state for null. Uses `signedPhotoUrl` from `@/lib/storage` and the `Plant` / `AiSuggestion` types from `@/types`.

#### 2. Link plant cards to the detail page

**File**: `src/pages/locations/[id].astro`

**Intent**: Make each plant card (currently a non-interactive `<li>`, lines 66-79) navigate to `/plants/<plant.id>`, matching the full-row-clickable affordance used for location rows on the dashboard.

**Contract**: Each plant list item links to `/plants/${plant.id}`; no data-shape change to the existing query.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Visiting `/plants/<own-plant-id>` shows the photo and every stored field, with the breadcrumb returning to the correct location.
- Fields that had an AI suggestion show an "AI suggested: …" hint; manually-created plants (null `ai_suggestion`) show no hints and don't error.
- Visiting a random/foreign UUID renders the 404 not-found state (no other user's data leaks).
- Plant cards on the location page navigate to the detail page.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 2: Plant update/delete endpoint

### Overview

Add `PATCH` (partial, whitelisted field update) and `DELETE` (row + best-effort photo cleanup) at `/api/plants/[id]`, with unit tests mirroring the locations sibling.

### Changes Required:

#### 1. Plant `[id]` endpoint

**File**: `src/pages/api/plants/[id].ts` (new)

**Intent**: Mirror `src/pages/api/locations/[id].ts`'s structure (id check, RLS-scoped update, error mapping) but **diverge on field handling**: this is a partial PATCH, so every whitelisted key is validated **only when present** in the body. The locations sibling reads `name` unconditionally and 400s when it's absent — do **not** copy that here; making `name` mandatory would break the core single-field-edit flow (e.g. editing only `species` would 400 for a missing `name`). Build a `PlantUpdate` from only the whitelisted keys present in the body (`name, species, description, sunlight, note, watering_interval_days, winterization_cutoff, location_id, photo_path`). For each key that **is** present, validate it like the create endpoint (name 1-100 after trim; watering a positive int or null; empty strings → null via the `emptyToNull` pattern; `winterization_cutoff` a date string or null); a present-but-invalid value → 400, an absent key is simply omitted from the update. It updates the row scoped by RLS, maps `CLIENT_ERROR_CODES` to 400 and other DB errors to 500, and returns `{ id }`. `ai_suggestion`, `user_id`, `id`, and timestamps are never written. `DELETE` collects `photo_path` before deleting, deletes the row (RLS-scoped), then best-effort `removePhotos`.

**Contract**: New handlers `PATCH`/`DELETE` for `/api/plants/[id]`. Reuses `json, requireUser, UUID_RE, CLIENT_ERROR_CODES` from `@/lib/api`, `createClient` from `@/lib/supabase`, `removePhotos` from `@/lib/storage`, and the `PlantUpdate` type from `@/types`. Self-guards auth (outside middleware). PATCH with an empty/all-invalid whitelist → 400 (`no_fields`); a `location_id` not owned by caller → trigger 23514 → 400. Consider extracting the shared `readValue`/`readString`/`emptyToNull`/`asPositiveInt` helpers from `src/pages/api/plants/index.ts` into `@/lib/api` if duplication is non-trivial; otherwise re-declare locally to match the existing per-endpoint style.

#### 2. Endpoint unit tests

**File**: `src/pages/api/plants/[id].test.ts` (new)

**Intent**: Mirror `src/pages/api/locations/[id].test.ts`: mock `createClient`, cover 401 (unauthenticated), 400 (non-UUID id, invalid name, invalid watering interval, empty whitelist), 503 (Supabase unconfigured), and the `ai_suggestion`/`user_id` keys being ignored when present in the body. Cover `DELETE` 401/400/503 paths.

**Contract**: Vitest suite over the exported `PATCH`/`DELETE` handlers using a `fakeContext` helper like the locations test. Asserts whitelisted-only writes (ai_suggestion in body does not appear in the update payload).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:run`
- Type checking + lint pass: `npx astro sync && npm run lint`

#### Manual Verification:

- `curl`/devtools PATCH of a single field persists and is reflected on reload; a PATCH attempting to set `ai_suggestion` leaves the stored snapshot unchanged.
- DELETE removes the plant and its photo object; the plant disappears from its location's list.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 3: Editable detail island

### Overview

Replace the read-only field rendering with a `PlantDetail` React island that makes every field editable in place (per-field click-to-edit, type-appropriate editor, check/cancel), shows display-only AI hints, supports the location `<select>`, and exposes the delete `AlertDialog`.

### Changes Required:

#### 1. Editable field component

**File**: `src/components/plants/EditableField.tsx` (new, or co-located inside `PlantDetail.tsx`)

**Intent**: A single reusable inline editor following `LocationActions`' rename ergonomics (display text → click/pencil → editor with check/cancel; Enter saves, Escape cancels; spinner while saving; `Alert` on error). It branches on a `kind` prop to render the right control: `text` (`Input`), `multiline` (`Textarea`, for description and note), `number` (numeric `Input`, positive-int validation, for watering interval), `date` (date `Input` + "No winterization needed" toggle that clears to null, for winterization cutoff), and `select` (location picker). On confirm it PATCHes the one field and reflects the saved value.

**Contract**: Props ≈ `{ plantId, field, label, kind, value, options? (for select), aiHint? }`. Saves via `PATCH /api/plants/<plantId>` with a single-key body. Display-only `aiHint` renders beneath the field when provided. Must be react-compiler-safe (no prop/state mutation, hook rules) per the strict lint config.

#### 2. Plant detail island

**File**: `src/components/plants/PlantDetail.tsx` (new)

**Intent**: Compose the editable fields for the whole plant, plus the delete action. Renders name, species, description, sunlight, watering interval, winterization cutoff, note (each via `EditableField`) and a location `<select>` populated from the user's locations passed in as a prop. Track the current `location_id` in island state (seeded from `plant.location_id`), updating it when the location `<select>` saves, so the delete redirect always targets the plant's **current** location, not the SSR snapshot. The delete control uses an `AlertDialog` (mirror `LocationActions`); on confirm it `DELETE`s and redirects to `/locations/<current location_id>`. Photo is shown read-only here (replacement lands in Phase 4).

**Contract**: Props ≈ `{ plant, locations, photoUrl }`. Holds current `location_id` in state (init from `plant.location_id`, updated on a successful location-select save). Wires `EditableField` per field; delete → `DELETE /api/plants/<id>` → `window.location.href = "/locations/<current location_id>"`. AI hints sourced from `plant.ai_suggestion` (null-safe; nothing shown for manual plants).

#### 3. Mount the island on the detail page

**File**: `src/pages/plants/[id].astro`

**Intent**: Replace the Phase-1 static field block with `<PlantDetail client:load … />`, passing the plant row, the user's locations (new query: `select id, name from locations`), and the signed photo URL.

**Contract**: Detail page now fetches the user's locations alongside the plant and renders the island; the read-only fallback for the 404 state is unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking + lint pass (incl. `react-compiler`): `npx astro sync && npm run lint`
- Existing unit tests still pass: `npm run test:run`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Each field edits in place with check/cancel; saving one field persists it without touching others; Escape/cancel reverts the editor.
- Watering interval rejects non-positive/non-integer input; winterization "No winterization needed" toggle clears the date to null.
- Changing the location `<select>` moves the plant (it appears under the new location, gone from the old); selecting works only among the user's own locations.
- AI hints show only where a snapshot value exists; manual plants show none.
- Delete prompts an `AlertDialog`; confirming removes the plant and lands on its (former) location page.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 4: Photo replacement

### Overview

Let the user replace the plant's photo from the detail screen, reusing the mint→PUT upload flow against the plant's existing id/folder, then updating `photo_path` and cleaning up an orphaned old object.

### Changes Required:

#### 1. Photo-replace control in the island

**File**: `src/components/plants/PlantDetail.tsx` (and/or a small `PlantPhoto.tsx` sub-component)

**Intent**: Add a "Replace photo" affordance over/under the photo, reusing `AddPlantForm`'s upload mechanics (`src/components/plants/AddPlantForm.tsx:94-144`): on file select, POST to `/api/plants/upload-url` with `{ locationId, filename, contentType, plantId: <existing plant id> }`, then `PUT` the file to the returned `signedUrl` with `x-upsert: true` and an upload timeout/abort + retry path. On success, PATCH `photo_path` to the minted `path` (only needed when the path changed, but always-PATCH is safe), then refresh the displayed image (reload, or swap to the new signed URL). Surface uploading/failed states like the create form.

**Contract**: Reuses the existing `upload-url` endpoint unchanged (it already accepts a supplied `plantId`). After a successful PUT, `PATCH /api/plants/<id>` with `{ photoPath }` (or `{ photo_path }` — match the endpoint's accepted key). Bytes never transit the Worker.

#### 2. Old-object cleanup on path change

**File**: `src/pages/api/plants/[id].ts`

**Intent**: When `PATCH` changes `photo_path` to a value different from the row's current `photo_path`, best-effort remove the now-orphaned prior object via `removePhotos`. Read the existing `photo_path` before the update to compare.

**Contract**: PATCH that includes `photo_path`: fetch current `photo_path`, apply the update, and if the old path differs and is non-null, `removePhotos([oldPath])` (best-effort, logged, never fails the request). Identical-filename overwrites leave the path unchanged → no removal.

### Success Criteria:

#### Automated Verification:

- Type checking + lint pass: `npx astro sync && npm run lint`
- Unit tests pass (incl. a PATCH-photo_path old-object-cleanup case): `npm run test:run`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Replacing the photo with a new file shows the new image after save; the plant's `photo_path` updates and the old Storage object is gone (no orphan) when the filename differs.
- Replacing with a same-named file overwrites in place and still displays correctly.
- A stalled/failed upload surfaces a retry path and never leaves the plant pointing at a missing object.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human.

---

## Testing Strategy

### Unit Tests:

- `src/pages/api/plants/[id].test.ts`: 401/400/503 validation paths for `PATCH` and `DELETE`; whitelist enforcement (`ai_suggestion`/`user_id` in body are ignored); empty-whitelist → 400; positive-int watering validation; photo_path old-object-cleanup branch.

### Integration / Manual Testing Steps:

1. Open a plant from its location list → detail page shows all fields + photo.
2. Edit each field type (text, textarea note, number watering, date winterization + toggle, location select); confirm each persists independently on reload.
3. Attempt to set `ai_suggestion` via devtools PATCH → stored snapshot unchanged.
4. Replace the photo → new image shows, old object cleaned up.
5. Delete the plant → `AlertDialog` confirm → redirected to the location page, plant gone, photo removed.
6. Hit a foreign/unknown plant id → 404 state, no data leak (verify with a second user's plant id if available).

## Performance Considerations

Negligible — single-row reads/writes scoped by indexed `user_id`/`id`. The detail page adds one extra `locations` select (small, indexed) for the picker and one signed-URL mint for the photo. Per-field PATCH keeps payloads tiny.

## Migration Notes

None — no schema change. All fields already exist on `plants`.

## References

- Roadmap slice: `context/foundation/roadmap.md` S-03 (lines 135-145)
- PRD: FR-015 (`prd.md:132`), FR-016 (`prd.md:134`), FR-017 (`prd.md:136`); Non-Goals photo-replaceable (`prd.md:182`)
- Pattern — endpoint: `src/pages/api/locations/[id].ts`; tests: `src/pages/api/locations/[id].test.ts`; island: `src/components/locations/LocationActions.tsx`
- Pattern — SSR detail + 404: `src/pages/locations/[id].astro`
- Photo flow: `src/components/plants/AddPlantForm.tsx:94-144`, `src/pages/api/plants/upload-url.ts`, `src/lib/storage.ts`
- Schema: `supabase/migrations/20260608171954_core_domain_schema.sql`; types: `src/types.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Plant detail page (read) + navigation

#### Automated

- [x] 1.1 Type checking passes: `npx astro sync && npm run lint` — a463ef8
- [x] 1.2 Production build succeeds: `npm run build` — a463ef8

#### Manual

- [x] 1.3 Detail page shows photo + every field with correct breadcrumb — a463ef8
- [x] 1.4 AI hints show where a suggestion exists; manual plants show none and don't error — a463ef8
- [x] 1.5 Foreign/unknown id renders the 404 state (no data leak) — a463ef8
- [x] 1.6 Plant cards on the location page navigate to the detail page — a463ef8

### Phase 2: Plant update/delete endpoint

#### Automated

- [x] 2.1 Unit tests pass: `npm run test:run` — 3377e7e
- [x] 2.2 Type checking + lint pass: `npx astro sync && npm run lint` — 3377e7e

#### Manual

- [x] 2.3 Single-field PATCH persists; PATCH of `ai_suggestion` leaves the snapshot unchanged — 3377e7e
- [x] 2.4 DELETE removes the plant and its photo object — 3377e7e

### Phase 3: Editable detail island

#### Automated

- [x] 3.1 Type checking + lint pass (incl. react-compiler): `npx astro sync && npm run lint` — b501bef
- [x] 3.2 Existing unit tests still pass: `npm run test:run` — b501bef
- [x] 3.3 Production build succeeds: `npm run build` — b501bef

#### Manual

- [x] 3.4 Each field edits in place with check/cancel; one save doesn't touch others; cancel reverts — b501bef
- [x] 3.5 Watering rejects non-positive/non-int; winterization toggle clears the date to null — b501bef
- [x] 3.6 Location `<select>` moves the plant; only own locations selectable — b501bef
- [x] 3.7 AI hints show only where a snapshot value exists — b501bef
- [x] 3.8 Delete `AlertDialog` confirm removes the plant and lands on its location page — b501bef

### Phase 4: Photo replacement

#### Automated

- [x] 4.1 Type checking + lint pass: `npx astro sync && npm run lint` — 8e08dad
- [x] 4.2 Unit tests pass (incl. photo_path old-object-cleanup case): `npm run test:run` — 8e08dad
- [x] 4.3 Production build succeeds: `npm run build` — 8e08dad

#### Manual

- [x] 4.4 Replacing with a new filename shows the new image; `photo_path` updates; old object removed — 8e08dad
- [x] 4.5 Replacing with a same-named file overwrites in place and displays correctly — 8e08dad
- [x] 4.6 A stalled/failed upload surfaces a retry path; plant never points at a missing object — 8e08dad
