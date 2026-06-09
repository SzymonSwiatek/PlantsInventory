# First plant from a photo (S-01 north star) — Implementation Plan

## Overview

Deliver the product's north-star slice: a signed-in user creates a named location, taps "Add plant," uploads a photo, receives an AI-suggested species + care profile within ~10 s, accepts/edits/replaces any field (and may retake the photo), and saves the plant into the location — where it appears immediately in that location's plant list. A manual-creation fallback works whenever the AI is absent, slow, or erroring.

This is the first slice to exercise three integration surfaces at once (direct-to-Storage signed upload, an AI vision call, the magic-link auth boundary) and the first to establish three conventions the codebase lacks: a JSON-returning API endpoint, a `fetch`-based form island, and a domain list/CRUD UI. Those conventions get copied by S-02/S-03, so they are set deliberately here.

## Current State Analysis

Prerequisites F-01 (magic-link auth) and F-02 (domain schema + RLS + storage + DTOs) are **both landed and verified** against the code (CLAUDE.md is stale on both — it still describes a password scaffold and "no domain tables yet"):

- **Auth boundary — done, reuse it.** `createClient(headers, cookies)` (`src/lib/supabase.ts`) builds a JWT-scoped `createServerClient<Database>` and returns `null` when unconfigured. `src/middleware.ts` resolves `context.locals.user` on every request and redirects `PROTECTED_ROUTES` (`["/dashboard"]`) to `/auth/signin`. Two sharp edges: `/api/*` is **not** in `PROTECTED_ROUTES` (endpoints self-guard), and `locals.supabase` is **not** exposed (each caller builds its own client).
- **Schema — purpose-shaped for this slice.** `plants` requires only `name` + `location_id` on insert; `id`/`user_id`/timestamps default server-side; `species`/`description`/`sunlight`/`watering_interval_days`/`winterization_cutoff`/`note`/`photo_path`/`ai_suggestion` are all nullable and user-editable. RLS is deny-by-default (`(select auth.uid()) = user_id`), and a BEFORE-trigger (`assert_plant_location_same_user`) rejects a plant pointing at another user's location.
- **Storage — architecture decided, not yet coded.** Private `plant-photos` bucket (10 MiB, png/jpeg/webp). The 4 `storage.objects` policies gate on the **first** path segment only: `(storage.foldername(name))[1] = (select auth.uid())::text`. Direct-to-Storage signed upload is the mandated pattern; bytes must not transit the Worker.
- **AI — greenfield.** Zero AI deps or code. No `AI_API_KEY`. The seam is built from scratch.
- **Frontend — thin starter.** A form-island pattern exists (`src/components/auth/*`, native `<form method=POST>` + `useFormStatus`), but the auth `FormField` is hardcoded-styled (reference only). shadcn has **only `Button`**. No JSON endpoint, no list page, no `fetch`-based form yet.

Runtime constraints verified against current docs (June 2026): Cloudflare Workers **free tier** = 10 ms CPU, 100 MB request body, **no** wall-clock limit while the client stays connected, 50 subrequests/req. Supabase `createSignedUploadUrl` mints a token (TTL 2 h) the browser uploads against directly; free-project bucket cap is 50 MB (our bucket is 10 MiB). Gemini's free tier covers the Flash vision models (~1,500 req/day, no card) and accepts images as base64 inline data (not an arbitrary URL).

## Desired End State

A signed-in user can, end to end on `wrangler dev` (real `workerd`):

1. Create a location from `/dashboard` and open it at `/locations/[id]`.
2. Tap "Add plant," upload a photo, and within ~10 s see the form pre-filled with the AI's species guess + care fields.
3. Edit any field, replace the photo (re-running the suggestion), or — when AI is unavailable — fill the form manually with the photo preserved.
4. Save, landing back on `/locations/[id]` with the new plant rendered (photo, name).
5. The original AI suggestion is snapshotted verbatim in `plants.ai_suggestion` on the AI path (null on manual), enabling both success metrics with no schema change.

Verification: `npm run build` + `npm run lint` pass; the manual end-to-end flow (including the missing-key fallback) succeeds on `wrangler dev`; a second user cannot see or reach the first user's location, plant, or photo.

### Key Discoveries

- `plants` insert needs only `name` + `location_id`; `ai_suggestion jsonb` is a write-once snapshot column purpose-built for the acceptance + adoption metrics (`supabase/migrations/20260608171954_core_domain_schema.sql:45-66`; `src/types.ts:36-42`).
- Storage RLS enforces only the **first** path segment = `auth.uid()` — the `<plant_id>` segment is convention, so we can pre-mint the plant id and use it as the folder (`supabase/migrations/20260608174754_plant_photos_storage.sql`).
- The same JWT-scoped client serves both DB (`.from(...)`) and Storage (`.storage.from('plant-photos')`) — no separate client needed (`src/lib/supabase.ts:6-24`).
- `/api/*` is unguarded by middleware; every endpoint must read `context.locals.user` and 401 if null (`src/middleware.ts:4`).
- The auth `FormField` is hardcoded-styled — build the plant form on fresh shadcn `Input`/`Label`/`Textarea`, not by reusing it (`src/components/auth/FormField.tsx`).
- Secrets follow the `astro:env/server` + `envField.string({ access:"secret", optional:true })` pattern; a missing key must degrade, not throw (`astro.config.mjs:17-22`, `src/lib/supabase.ts:7-9`).

## What We're NOT Doing

- **No reminder logic.** `last_watered_at`/`next_water_due_at`/`water_snooze_until`/`winterized_at` stay NULL on create; the plant list's "next care date" shows a placeholder. Reminders/today-list/cron are S-04/S-05.
- **No location rename/delete or plant-count badges** (FR-005/006/007 → S-02). Only create + list here.
- **No plant detail / edit-in-place / delete / free-text note surface** (FR-015/016/017 → S-03). The `note` column exists but is not in the create form.
- **No orphaned-object cleanup.** Abandoned uploads orphan a Storage object (DB CASCADE doesn't reach Storage) — accepted, noted as a follow-up.
- **No test runner.** Verification is static (lint/typecheck/build) + manual on `wrangler dev`. Module 3 `/10x-test-plan` owns the test rollout.
- **No `created_via_ai` column or analytics dashboard.** Adoption is inferred from `ai_suggestion IS NOT NULL`; the "minor edit" acceptance threshold (PRD Open Q2) is downstream analysis.
- **No multi-photo gallery, no search/filter, no location-override picker** (location is inferred from the route, FR-012's "MAY override" deferred).

## Implementation Approach

Build foundation-up, de-risking the two hard seams as **standalone, individually-observed endpoints before stitching them into the form** (the change.md + roadmap mitigation):

1. **Foundations & config** — env, UI primitives, route guard, shared helpers.
2. **Locations shell** — create + list pages (the flow's entry and exit).
3. **AI suggestion seam** — `/api/plants/suggest`, verified alone.
4. **Photo upload seam** — `/api/plants/upload-url`, verified alone.
5. **Stitch** — the `/plants/new` page + `AddPlantForm` island + `/api/plants` create endpoint compose all three.

Image handling is the spine: the **full-res photo goes browser → Storage directly** (raw `PUT` to a signed URL — never through the Worker); a **browser-downscaled copy (≤1024px base64)** goes to the AI route, which relays it to Gemini. This keeps 10 MB out of the 10 ms-CPU Worker while satisfying both the upload NFR and Gemini's base64 input requirement.

## Critical Implementation Details

- **The 10 ms CPU rule is the spine.** Never decode or encode the full-res image in the Worker. Full-res: browser → Storage via raw `PUT`. AI: the browser produces a small (≤1024px) base64 JPEG and the `/suggest` route relays that string to Gemini (trivial CPU, no decode). Violating this (server-side `storage.upload(file)`, decoding/encoding 10 MB in-Worker) is the single most likely way to blow the free-tier budget.
- **Storage path must start with `auth.uid()`.** Storage RLS checks only `(storage.foldername(name))[1]`. Mint every key as `<auth.uid()>/<plantId>/<filename>`; the `<plantId>` segment is convention (lets the photo folder match the row id). A key not under the caller's uid is rejected on both write and read.
- **`ai_suggestion` is write-once by app convention.** Persist the normalized `AiSuggestion` snapshot at create on the AI path; leave NULL on manual create; never overwrite on edit (S-03). Adoption metric = `ai_suggestion IS NOT NULL`; acceptance = saved-fields-vs-snapshot diff, computed downstream. **MVP fidelity caveat (conscious decision):** the snapshot round-trips through the browser — `/api/plants` trusts the `aiSuggestion` the client posts back rather than re-deriving it server-side. Accepted for the MVP (the data is the user's own; not a security issue), but the acceptance metric is only trustworthy if the form posts the *original* `/suggest` response verbatim, never the edited field values. If the metric later needs hardening, stash the normalized suggestion server-side at `/suggest` keyed by the pre-minted `plantId` and have create read the original — a follow-up, not this slice.
- **Create insert: explicit id, never `user_id`.** Insert with `id = plantId` (so the row matches the photo folder) and omit `user_id` (it defaults to `auth.uid()`). The FK-guard trigger rejects a `location_id` owned by another user — handle that error as a 400/409, don't surface a 500.
- **Signed-upload PUT mechanics — verify before coding.** `createSignedUploadUrl(path)` returns `{ signedUrl, token, path }`; the browser completes it via `uploadToSignedUrl` semantics (a `PUT` carrying the token). The mint endpoint returns the **absolute** URL so the browser needs no Supabase secret. Confirm the exact URL/token/header shape against the installed `@supabase/supabase-js` version at implement time.
- **Gemini specifics — verify before coding.** Call `generateContent` on a Flash model with the image as `inline_data` and request structured JSON output (`response_mime_type: "application/json"` + a response schema). Normalize leniently: coerce types, null any missing field, map `winterization_cutoff` to an ISO `YYYY-MM-DD` or null. Confirm the current model id + structured-output field names against Gemini docs.
- **Endpoints self-guard.** `/api/*` is outside `PROTECTED_ROUTES`; each endpoint reads `context.locals.user` and returns 401 if null, then builds its own `createClient(...)` and null-checks (no `locals.supabase`).

---

## Phase 1: Foundations & config

### Overview

Add the AI secret, the shadcn primitives, the route guard, and the shared API/storage helpers everything else builds on. No user-visible feature; the app must still run unconfigured.

### Changes Required:

#### 1. AI secret in the env schema

**File**: `astro.config.mjs`

**Intent**: Declare `AI_API_KEY` so the AI route can read it via `astro:env/server`, mirroring the existing Supabase secrets. Keep it `optional: true` so a missing key degrades to manual-create rather than throwing (PRD guardrail "catalog survives AI outage").

**Contract**: Append to `env.schema`: `AI_API_KEY: envField.string({ context: "server", access: "secret", optional: true })`. The Gemini model id stays a code constant in `src/lib/ai/suggest.ts` (overridable later) — no extra env var this slice.

#### 2. Example + local env documentation

**File**: `.env.example`

**Intent**: Document the new key so a fresh checkout knows to set it.

**Contract**: Add `AI_API_KEY=`. (Implementer note for the human: also add `AI_API_KEY` to local `.dev.vars` and `.env`, and `npx wrangler secret put AI_API_KEY` for prod — these are separate stores and a missing prod secret degrades silently.)

#### 3. shadcn UI primitives

**File**: `src/components/ui/{input,label,textarea,card,checkbox,skeleton,alert}.tsx` (generated)

**Intent**: Add the form/loading/error primitives the add-plant UI needs (the repo has only `Button`).

**Contract**: `npx shadcn@latest add input label textarea card checkbox skeleton alert` ("new-york" style is configured). Run `npx astro sync` afterward if types complain.

#### 4. Shared API helpers

**File**: `src/lib/api.ts` (new)

**Intent**: Establish the JSON-response + in-endpoint auth-guard conventions this slice introduces, so all four new endpoints share one shape.

**Contract**: Export `json(payload, status = 200)` returning a `Response` with `Content-Type: application/json`; and `requireUser(context)` returning the `User` or a 401 `Response` (caller short-circuits on the `Response`). No business logic.

#### 5. Signed-read-URL helper

**File**: `src/lib/storage.ts` (new)

**Intent**: One place to mint a short-lived signed **read** URL for a private `photo_path`, used by the plant-list render.

**Contract**: Export `signedPhotoUrl(supabase, path, ttlSeconds = 3600)` wrapping `supabase.storage.from('plant-photos').createSignedUrl(path, ttl)`, returning the URL or null.

#### 6. Protect the locations routes

**File**: `src/middleware.ts`

**Intent**: Gate the new pages behind auth (they're public until added).

**Contract**: Add `"/locations"` to `PROTECTED_ROUTES` (the `startsWith` match covers `/locations/[id]` and `/locations/[id]/plants/new`). `/dashboard` is already protected.

### Success Criteria:

#### Automated Verification:

- Build succeeds with the new env field: `npm run build`
- Lint + typecheck pass: `npm run lint`
- `astro sync` succeeds: `npx astro sync`
- The seven shadcn primitive files exist under `src/components/ui/`
- `src/lib/api.ts` and `src/lib/storage.ts` exist and typecheck

#### Manual Verification:

- The app still starts and renders unconfigured (no `AI_API_KEY`, even no Supabase) without throwing — the missing-config Banner path is intact
- Visiting `/locations` while logged out redirects to `/auth/signin`

**Implementation Note**: After completing this phase and all automated verification passes, pause for human confirmation of the manual checks before Phase 2.

---

## Phase 2: Locations shell (create + list pages)

### Overview

Build the flow's entry (create a location) and exit (the location's plant list). Pure server-rendered Astro + a native form POST — no island yet. The plant list renders empty until Phase 5 populates it.

### Changes Required:

#### 1. Location-create endpoint

**File**: `src/pages/api/locations.ts` (new)

**Intent**: Create a location for the signed-in user from a native form POST, then redirect back to the dashboard (mirrors the auth endpoints' form-POST→redirect shape; this is intentionally **not** JSON — the JSON convention is established by the plant endpoints).

**Contract**: `POST: APIRoute`; read `request.formData()` `name`; self-guard auth; `createClient(...)` + null-check; `insert({ name })` (user_id defaults to `auth.uid()`); on the `name` CHECK violation (1–100 chars) redirect back with `?error=`; success → `context.redirect('/dashboard')`.

#### 2. Dashboard: list + create locations

**File**: `src/pages/dashboard.astro`

**Intent**: Turn the placeholder dashboard into the locations home — list the user's locations (each linking to `/locations/[id]`) and a create-location form.

**Contract**: Build a server `createClient(Astro.request.headers, Astro.cookies)`, `select` locations (RLS-scoped, ordered by `created_at`), render the list + an empty state + a `<form method="POST" action="/api/locations">` with a single `name` field. Surface `?error=` if present.

#### 3. Location detail / plant list page

**File**: `src/pages/locations/[id].astro` (new)

**Intent**: Show one location's plants (FR-014) and the "Add plant" entry point. Establishes the domain list-page pattern.

**Contract**: Read `Astro.params.id`; `createClient(...)`; fetch the location by id (RLS-scoped — if not found, return 404 / redirect to `/dashboard`); fetch its plants (RLS-scoped). For each plant render a card: photo via `signedPhotoUrl(...)`, name, and next-care = "Not scheduled yet" (reminders are S-04). Empty state + an "Add plant" link to `./plants/new`.

### Success Criteria:

#### Automated Verification:

- Build + lint + typecheck pass: `npm run build && npm run lint`
- `src/pages/api/locations.ts` and `src/pages/locations/[id].astro` exist

#### Manual Verification:

- A signed-in user creates a location from `/dashboard` and sees it in the list
- Submitting an empty/over-long name shows the error, not a 500
- Opening a location shows an empty plant list + an "Add plant" CTA
- A second user cannot open the first user's location (404 / not visible)

**Implementation Note**: Pause for human confirmation of the manual checks before Phase 3.

---

## Phase 3: AI suggestion seam (observed alone)

### Overview

Stand up the AI vision call as a self-contained endpoint plus its pure normalizer and the browser downscale utility. Exercised in isolation before any form depends on it.

### Changes Required:

#### 1. Browser image-downscale utility

**File**: `src/lib/image.ts` (new, client-only)

**Intent**: Produce a small base64 JPEG for the AI call without imposing compression on the stored full-res photo.

**Contract**: Export `downscaleToBase64(file: File, maxEdge = 1024, quality = 0.8): Promise<{ base64: string; mimeType: string }>` using a canvas; longest edge clamped to `maxEdge`; returns base64 (no data-URL prefix) + mime. Pure client utility (uses `Image`/`canvas`).

#### 2. Gemini request builder + normalizer

**File**: `src/lib/ai/suggest.ts` (new, server)

**Intent**: Encapsulate the provider call and the provider-agnostic normalization to `AiSuggestion`, so swapping providers later touches only this file.

**Contract**: Export `requestSuggestion(base64, mimeType, signal): Promise<AiSuggestion>` — `fetch` to Gemini `generateContent` (Flash model constant) with `inline_data` + structured JSON output, passing the `AbortSignal`. Export pure `normalizeSuggestion(raw: unknown): AiSuggestion` — coerce/validate into `{ species, description, sunlight, watering_interval_days, winterization_cutoff }` (all nullable), `watering_interval_days` → positive int or null, `winterization_cutoff` → ISO `YYYY-MM-DD` or null. Import `AiSuggestion` from `src/types.ts`. (Verify model id + structured-output schema field names against current Gemini docs.)

#### 3. Suggestion endpoint

**File**: `src/pages/api/plants/suggest.ts` (new)

**Intent**: The first JSON endpoint — receive the downscaled image, return a normalized suggestion, and degrade uniformly when AI is unavailable.

**Contract**: `POST: APIRoute`; self-guard auth (`requireUser`); read JSON `{ imageBase64, mimeType }`. If `AI_API_KEY` is unset → `json({ status: 'ai_unavailable' })` (200, so the client treats missing-key, timeout, and error identically). Else wrap `requestSuggestion(...)` in a server `AbortController` (~12 s) → on success `json({ status: 'ok', suggestion })`; on abort/error → `json({ status: 'ai_unavailable' })`. Never throw to the client.

### Success Criteria:

#### Automated Verification:

- Build + lint + typecheck pass: `npm run build && npm run lint`
- `src/lib/image.ts`, `src/lib/ai/suggest.ts`, `src/pages/api/plants/suggest.ts` exist
- `normalizeSuggestion` is a pure export (no provider/network import at module top) — verified by a quick local eval against a missing-field and an extra-field payload

#### Manual Verification (on `wrangler dev`):

- With `AI_API_KEY` set, POSTing a sample plant image (base64) returns a plausible normalized `AiSuggestion` within ~10 s
- With `AI_API_KEY` unset, the endpoint returns `{ status: 'ai_unavailable' }` (no throw, no 500)
- A deliberately slow/aborted call returns `ai_unavailable` within ~12 s server-side (Worker CPU stays low — `wrangler tail`)

**Implementation Note**: Pause for human confirmation of the manual checks before Phase 4.

---

## Phase 4: Photo upload seam (observed alone)

### Overview

Stand up the direct-to-Storage signed upload as a self-contained endpoint, exercised in isolation. The plant row does not exist yet — the endpoint pre-mints the plant id that becomes both the photo folder and (in Phase 5) the row id.

### Changes Required:

#### 1. Signed-upload-URL mint endpoint

**File**: `src/pages/api/plants/upload-url.ts` (new)

**Intent**: Mint a one-time signed upload URL under the caller's folder so the browser can `PUT` the full-res photo directly to Storage, never through the Worker.

**Contract**: `POST: APIRoute`; self-guard auth; read JSON `{ locationId, filename, contentType, plantId? }`; validate `contentType` ∈ {png, jpeg, webp} and that `locationId` belongs to the user (RLS `select`); **reuse the supplied `plantId` on a retake, else mint `plantId = crypto.randomUUID()` on the first call**; build `path = \`${user.id}/${plantId}/${sanitize(filename)}\``; `createSignedUploadUrl(path, { upsert: true })` (the `upsert` flag lets a retake overwrite the object at the same key — verified required in storage-js; the default rejects an existing key); return `json({ plantId, path, token, signedUrl })` where `signedUrl` is **absolute** (prefixed so the browser needs no Supabase secret). (Verify the exact `uploadToSignedUrl` URL/token/header contract against the installed `@supabase/supabase-js`.)

### Success Criteria:

#### Automated Verification:

- Build + lint + typecheck pass: `npm run build && npm run lint`
- `src/pages/api/plants/upload-url.ts` exists

#### Manual Verification (on `wrangler dev`):

- Minting + a raw browser `PUT` (via devtools) lands an object at `<uid>/<plantId>/<file>` in the `plant-photos` bucket
- A 10 MB file uploads successfully and Worker CPU stays within budget (`wrangler tail`) — bytes do not transit the Worker
- A forged path not under the caller's uid is rejected by Storage RLS
- An unsupported `contentType` or a foreign `locationId` is rejected with a 4xx, not a 500

**Implementation Note**: Pause for human confirmation of the manual checks before Phase 5.

---

## Phase 5: Add-plant flow — stitch all three seams

### Overview

Compose the upload, suggestion, and create paths into the single user-facing flow and its create endpoint. This is where the first `fetch`-based island lands.

### Changes Required:

#### 1. Plant-create endpoint

**File**: `src/pages/api/plants/index.ts` (new)

**Intent**: Persist the finished plant (AI-path or manual) with the pre-minted id, snapshotting the AI suggestion.

**Contract**: `POST: APIRoute`; self-guard auth; read JSON `{ id, locationId, photoPath, name, species, description, sunlight, watering_interval_days, winterization_cutoff, aiSuggestion }`. Defense-in-depth: reject if `photoPath` doesn't start with `${user.id}/`. Build a `PlantInsert` (from `src/types.ts`) with **explicit `id`**, `location_id`, `name`, the editable fields, `photo_path = photoPath`, and `ai_suggestion = aiSuggestion ?? null`; **never set `user_id`**. Insert via the typed client; map the FK-guard / CHECK violations to 400/409; success → `json({ id }, 201)`.

#### 2. Add-plant page

**File**: `src/pages/locations/[id]/plants/new.astro` (new)

**Intent**: Host the form island for a specific location (location inferred from the route — FR-012).

**Contract**: Protected via the `/locations` prefix; read `Astro.params.id`; verify the location belongs to the user (RLS `select`, else 404); render `<AddPlantForm locationId={id} client:load />`.

#### 3. Add-plant form island

**File**: `src/components/plants/AddPlantForm.tsx` (new)

**Intent**: The first `fetch`-based island — orchestrate photo upload, AI suggestion, edit, retake, manual fallback, and save. (The auth `FormField` is not reused — build on shadcn `Input`/`Label`/`Textarea`/`Checkbox`.)

**Contract**: Local state machine: `idle → (uploading ∥ suggesting) → editing → saving`, with an `upload_failed` branch off the full-res PUT. On photo select: (a) `POST /api/plants/upload-url` then raw `PUT` the full-res file to the returned `signedUrl` — **on PUT failure (network / RLS reject / size) enter `upload_failed`: surface a retry Alert and gate Save until a full-res object is confirmed, so a plant is never saved with a dangling `photo_path` that the list render would 404 on**; (b) in parallel, `downscaleToBase64(...)` then `POST /api/plants/suggest` under a **~15 s client `AbortController`**. On `status: 'ok'` → prefill fields (and default `name` from `species`); on `ai_unavailable`/timeout/error → show an info Alert and leave fields empty/editable (photo preserved). Fields: `name` (required, 1–100), `species`, `description` (Textarea), `sunlight`, `watering_interval_days` (number ≥ 1), `winterization_cutoff` (date) + a "no winterization needed" Checkbox that nulls the date. "Replace photo" re-runs upload + suggest, **sending the stored `plantId` back to `/api/plants/upload-url`** so the same `<uid>/<plantId>/` folder is overwritten via `upsert` (no per-retake orphan). Save → `POST /api/plants` with all fields + `id = plantId` + `photoPath` + `aiSuggestion` (the snapshot, or null if manual) → on 201 `window.location` to `/locations/${locationId}`. Show a Skeleton/spinner during the AI wait.

### Success Criteria:

#### Automated Verification:

- Build + lint + typecheck pass: `npm run build && npm run lint`
- `src/pages/api/plants/index.ts`, `src/pages/locations/[id]/plants/new.astro`, `src/components/plants/AddPlantForm.tsx` exist
- `react-compiler` lint passes on the island (no prop/state mutation)

#### Manual Verification (end-to-end on `wrangler dev`):

- Upload a photo → a suggestion pre-fills the form within ~10 s; edit a field; save; the plant appears in `/locations/[id]` with its photo
- Replace the photo before saving → a fresh suggestion replaces the previous one; the retake reuses the same `plantId`/folder (the new object overwrites the prior — no second orphan)
- With `AI_API_KEY` unset → the manual form appears (photo preserved) and a manual save succeeds
- DB check: `ai_suggestion` is the snapshot on the AI path and NULL on a manual create
- A simulated full-res PUT failure enters `upload_failed`: Save is blocked and a retry Alert shows (no plant saved with a dangling `photo_path`)
- A second user cannot see the saved plant or its photo (RLS)
- Returning-user "open → first plant saved" is comfortably usable (secondary NFR < 60 s)

**Implementation Note**: This is the final phase — after automated + manual verification pass, the slice is complete. Mark the §3 roadmap row and close the change.

---

## Testing Strategy

No test runner is configured and none is introduced here (Module 3 `/10x-test-plan` owns that). Verification is **static + manual**:

### Static gates (every phase):

- `npm run lint` (ESLint, type-aware + `react-compiler`)
- `npm run build` (SSR build on `@astrojs/cloudflare`)
- `npx astro sync` after the env-schema change

### Manual testing steps (on real `workerd`):

1. `wrangler dev`; sign in via magic link.
2. Create a location; open it; confirm the empty list + CTA.
3. Phase 3/4 isolation: POST a sample image to `/api/plants/suggest` (key set and unset); mint + `PUT` a 10 MB file to `/api/plants/upload-url`, confirming the object key and Worker CPU via `wrangler tail`.
4. Full flow: upload → suggestion → edit → save → see the plant in the list.
5. Retake: replace the photo, confirm a new suggestion.
6. Outage: unset `AI_API_KEY`, confirm the manual fallback with the photo preserved.
7. Isolation: from a second account, confirm the first user's location/plant/photo are unreachable.

## Performance Considerations

- The full-res 10 MB photo never enters the Worker (direct `PUT` to Storage) — protects the 10 ms free-tier CPU budget.
- The AI route relays only a ≤1024px base64 image (~200–300 KB) — trivial CPU, well within 50 subrequests/req.
- The ~10 s AI `fetch` is awaited; Workers bill CPU not wall-clock, so a suspended `await` does not consume the budget (no wall-clock limit while the client is connected).
- Keep any provider SDK lazy-imported (prefer plain `fetch`) to protect the ~3 MB free-tier bundle cap (current 391 KiB gzip).

## Migration Notes

None. No schema change — F-02 already shipped every column this slice writes (`ai_suggestion` snapshot included). Adoption is inferred from `ai_suggestion IS NOT NULL`.

## References

- Research: `context/changes/first-plant-from-photo/research.md`
- Change identity: `context/changes/first-plant-from-photo/change.md`
- F-02 plan (direct-to-Storage mandate, write-once `ai_suggestion`): `context/archive`/`context/changes/domain-schema-with-rls/plan.md`
- Infra risk register (10 ms CPU, `nodejs_compat`, secret stores): `context/foundation/infrastructure.md`
- Schema + RLS: `supabase/migrations/20260608171954_core_domain_schema.sql`, `supabase/migrations/20260608174754_plant_photos_storage.sql`
- DTO surface: `src/types.ts:36-42`; auth boundary: `src/lib/supabase.ts`, `src/middleware.ts`; form-island reference: `src/components/auth/SignInForm.tsx`; secret pattern: `astro.config.mjs:17-22`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundations & config

#### Automated

- [x] 1.1 Build succeeds with the new env field (`npm run build`) — 188652e
- [x] 1.2 Lint + typecheck pass (`npm run lint`) — 188652e
- [x] 1.3 `astro sync` succeeds (`npx astro sync`) — 188652e
- [x] 1.4 The seven shadcn primitive files exist under `src/components/ui/` — 188652e
- [x] 1.5 `src/lib/api.ts` and `src/lib/storage.ts` exist and typecheck — 188652e

#### Manual

- [x] 1.6 App still starts/renders unconfigured without throwing (Banner path intact) — 188652e
- [x] 1.7 `/locations` while logged out redirects to `/auth/signin` — 188652e

### Phase 2: Locations shell (create + list pages)

#### Automated

- [x] 2.1 Build + lint + typecheck pass
- [x] 2.2 `src/pages/api/locations.ts` and `src/pages/locations/[id].astro` exist

#### Manual

- [x] 2.3 Signed-in user creates a location and sees it listed
- [x] 2.4 Empty/over-long name shows an error, not a 500
- [x] 2.5 Opening a location shows an empty plant list + "Add plant" CTA
- [x] 2.6 A second user cannot open the first user's location

### Phase 3: AI suggestion seam (observed alone)

#### Automated

- [ ] 3.1 Build + lint + typecheck pass
- [ ] 3.2 `src/lib/image.ts`, `src/lib/ai/suggest.ts`, `src/pages/api/plants/suggest.ts` exist
- [ ] 3.3 `normalizeSuggestion` is pure and handles missing/extra fields without throwing

#### Manual

- [ ] 3.4 Key set: POSTing a sample image returns a plausible normalized `AiSuggestion` within ~10 s
- [ ] 3.5 Key unset: endpoint returns `ai_unavailable` (no throw)
- [ ] 3.6 Slow/aborted call returns `ai_unavailable` within ~12 s; Worker CPU stays low

### Phase 4: Photo upload seam (observed alone)

#### Automated

- [ ] 4.1 Build + lint + typecheck pass
- [ ] 4.2 `src/pages/api/plants/upload-url.ts` exists

#### Manual

- [ ] 4.3 Mint + raw `PUT` lands an object at `<uid>/<plantId>/<file>`
- [ ] 4.4 A 10 MB file uploads; Worker CPU stays within budget (bytes bypass the Worker)
- [ ] 4.5 A forged path not under the caller's uid is rejected by Storage RLS
- [ ] 4.6 Bad `contentType` / foreign `locationId` rejected with 4xx, not 500

### Phase 5: Add-plant flow — stitch all three seams

#### Automated

- [ ] 5.1 Build + lint + typecheck pass
- [ ] 5.2 `src/pages/api/plants/index.ts`, `src/pages/locations/[id]/plants/new.astro`, `src/components/plants/AddPlantForm.tsx` exist
- [ ] 5.3 `react-compiler` lint passes on the island

#### Manual

- [ ] 5.4 Upload → suggestion prefills within ~10 s; edit; save; plant appears in the list with its photo
- [ ] 5.5 Replace photo before saving → a fresh suggestion replaces the previous one; retake reuses the same `plantId`/folder (no second orphan)
- [ ] 5.6 Key unset → manual form with photo preserved; manual save works
- [ ] 5.7 DB check: `ai_suggestion` snapshot on AI path, NULL on manual
- [ ] 5.8 A second user cannot see the saved plant or its photo
- [ ] 5.9 Returning-user "open → first plant saved" is comfortably usable (< 60 s)
- [ ] 5.10 Simulated full-res PUT failure enters `upload_failed`: Save blocked + retry Alert (no dangling `photo_path`)
