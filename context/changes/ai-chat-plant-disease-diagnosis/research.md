---
date: 2026-06-30T10:24:00+02:00
researcher: Szymon Świątek
git_commit: 62b7e0ddfc6bc649e5377e2a28ade695b419c4c2
branch: main
repository: 10xPlantsInventory
topic: "AI chat for plant disease diagnosis — reuse map for photo upload, AI provider, chat UI, and persistence"
tags: [research, codebase, ai-chat, gemini, photo-upload, rls, shadcn]
status: complete
last_updated: 2026-06-30
last_updated_by: Szymon Świątek
---

# Research: AI chat for plant disease diagnosis ("Ask AI" with photo upload/capture)

**Date**: 2026-06-30T10:24:00+02:00
**Researcher**: Szymon Świątek
**Git Commit**: 62b7e0ddfc6bc649e5377e2a28ade695b419c4c2 (local-only; origin/main at 3d1c55d)
**Branch**: main
**Repository**: 10xPlantsInventory (SzymonSwiatek/PlantsInventory)

## Research Question

What reusable building blocks already exist for adding an "Ask AI" chat for plant
disease diagnosis (photo upload/capture → multi-turn conversation), across four
areas: (1) photo upload/capture reuse, (2) AI provider wiring, (3) chat UI & state
patterns, and (4) data model & persistence?

## Summary

The codebase has a strong, consistent foundation to build on, but a conversational
chat is a **net-new shape** in three respects: there are **no custom React hooks**,
**no streaming/SSE anywhere** (all AI is single-shot), and **no multi-turn message
abstraction** (every AI call is a single image → single JSON response).

**The single most important correction:** the change.md note (line 24) assumes an
**Anthropic** provider. The codebase does not use Anthropic. It calls **Google
Gemini `gemini-2.5-flash`** via **raw `fetch`** to the v1beta REST API — there is
no AI SDK of any kind in `package.json`. The env var is the provider-neutral
`AI_API_KEY`, sent as Gemini's `x-goog-api-key` header. Plan the chat endpoint
around Gemini (or a deliberately provider-agnostic seam), not Anthropic.

What is **directly reusable**: the browser image downscaler (`src/lib/image.ts`),
the API self-guard helpers (`src/lib/api.ts`), the signed-upload-to-Storage
mechanism, the Gemini transport conventions (endpoint shape, retry/backoff, uniform
`ai_unavailable` degradation), the island-mount pattern, a solid subset of
shadcn/ui components, sonner toasts, and the RLS/migration templates.

What must be **built new**: a multi-turn `contents` history with `role` turns, a
`useChat`/streaming state hook, an SSE/`ReadableStream` response path (if streaming),
a disease-diagnosis prompt (replacing the plant-care JSON schema), 3 missing shadcn
primitives (`scroll-area`, `avatar`, `sheet`/`dialog`), a nav entry, and — only if
cross-session history is wanted — two new persisted tables with RLS.

## Detailed Findings

### Area 1 — Photo upload/capture reuse

**Architecture**: a **direct-to-Storage** pattern. The browser mints a signed
upload URL from a Worker endpoint, then `PUT`s raw file bytes straight to Supabase
Storage (bytes never transit the Worker — to stay under the Cloudflare free-tier
10ms CPU budget). In parallel, a **separate downscaled base64 copy** is sent to the
AI endpoint. There are already **two consumers** of this flow: `AddPlantForm.tsx`
(create) and `PlantDetail.tsx` (replace) — proving the upload path and AI path are
already separable.

- Add-plant UI island: `src/components/plants/AddPlantForm.tsx` (mounted `client:load`
  at `src/pages/locations/[id]/plants/new.astro:36`; only prop is `locationId`).
- Dual hidden file inputs sharing one `onChange`:
  - choose existing — `AddPlantForm.tsx:286-293` (`accept="image/png,image/jpeg,image/webp"`, `ALLOWED_TYPES` at `:31`)
  - camera capture — `AddPlantForm.tsx:306-314` (`capture="environment"`)
  - preview via `URL.createObjectURL`, revoked on cleanup (`:78-93`, `:278`). **No crop logic anywhere.**
- Client upload orchestration: `runUpload` (`AddPlantForm.tsx:95-145`) — POST
  `/api/plants/upload-url` (JSON `{ locationId, filename, contentType, plantId? }`)
  then raw `PUT signedUrl` with `x-upsert: true`, 60s `AbortController`.
- Mint endpoint: `src/pages/api/plants/upload-url.ts` — `requireSameOrigin` + `requireUser`,
  content-type allowlist (`:22,48-50`), **plant-coupled** `locations`-table check (`:63-70`),
  pre-mints `plantId = crypto.randomUUID()` (`:73`), builds key
  `${user.id}/${plantId}/${sanitizeFilename(filename)}` (`:74`), calls
  `createSignedUploadUrl` on bucket `plant-photos` (`:79`).
- Storage helpers: `src/lib/storage.ts` — `signedPhotoUrl` (`:13-23`), `removePhotos`
  (`:30-39`), `signedPhotoUrls` (`:48-67`). **Bucket name `"plant-photos"` hard-coded
  in all four functions.** There is **no upload helper in `lib/`** — mint/PUT is
  inlined (and duplicated) in both React components.
- Image downscaler: `src/lib/image.ts` `downscaleToBase64(file, maxEdge=1024, quality=0.8)`
  (`:26-49`) — browser-only canvas, returns `{ base64, mimeType: "image/jpeg" }` with
  no `data:` prefix. **Fully generic, zero plant logic — the cleanest drop-in.**

**Reuse-readiness**: `downscaleToBase64`, the picker/capture/preview JSX block
(`AddPlantForm.tsx:267-322`), and the signed-upload *mechanism* are reusable.
Coupled-to-plants and needing a sibling/parameterized version: `upload-url.ts`
(validates the `locations` table, builds a plant-folder key), and the `plant-photos`
bucket constant. The `runUpload`/`runPhotoUpload` duplication across `AddPlantForm`
and `PlantDetail` is a signal to extract a shared `usePhotoUpload` hook while adding
the third (chat) consumer.

### Area 2 — AI provider wiring (Gemini, not Anthropic)

- Endpoint: `src/pages/api/plants/suggest.ts` — `POST` (`:28`), single-shot JSON in/out.
  Guards: `requireSameOrigin` (`:29`), `requireUser` (`:32`), missing-key short-circuit
  `if (!AI_API_KEY) return { status: "ai_unavailable" }` (`:38-40`). Body
  `{ imageBase64, mimeType }` (`:43-44`). Validates `ALLOWED_MIME_TYPES` (`:21`→415),
  `MAX_IMAGE_BYTES = 7*1024*1024` decoded cap + base64-shape check (`:26,57-62`→413/400).
  Calls `requestSuggestion(AI_API_KEY, imageBase64, mimeType, signal)` (`:69`) under a
  12s budget (`AI_TIMEOUT_MS = 12_000`, `:16,64-67`).
- Provider seam: `src/lib/ai/suggest.ts` — **raw `fetch`, no SDK**. `GEMINI_MODEL = "gemini-2.5-flash"`
  (`:19`), endpoint `…/v1beta/models/gemini-2.5-flash:generateContent` (`:20`). Key passed
  *in* as an arg, set as header `x-goog-api-key` (`:93`); the module imports nothing from
  `astro:env`. Prompt `buildPrompt(today)` (`:23-37`) is a **Polish botanist** instruction
  with the date interpolated. Image as `inlineData` block; body is a **single-turn
  `contents` array, no roles** (`:74-79`). Structured output via
  `responseMimeType: "application/json"` + `responseSchema` (`:43-52,80-83`). Parsing:
  `extractText` walks `candidates[0].content.parts[*].text` (`:162-176`) → `JSON.parse` →
  `normalizeSuggestion` pure coercer (`:146-155`). Retry: `RETRYABLE_STATUSES = {429,500,502,503,504}`,
  `MAX_ATTEMPTS = 3`, linear backoff (`:54-57,109-139`).
- DTO: `AiSuggestion` in `src/types.ts:52-58`, stored in `plants.ai_suggestion jsonb`.
- **Untrusted text**: governed by the CLAUDE.md "Tripwires" rule. Enforcement is
  **convention + framework auto-escaping**, not active sanitization — `normalizeSuggestion`
  validates *shape* only. No `set:html`/`dangerouslySetInnerHTML` anywhere (grep-confirmed).
  For chat, the **assistant text is equally untrusted**, and the user can echo injected
  content into later turns, so the rule applies to the whole transcript.
- **Graceful degradation**: every failure path collapses to `{ status: "ai_unavailable" }`
  at HTTP **200**, server-only `console.error` (`:38-40,71-77`). Covered by
  `src/pages/api/plants/suggest.fault.test.ts` (4 cases). The "runs unconfigured" analog
  of `createClient`-returns-null; all env fields `optional: true` in `astro.config.mjs`.
- **No rate limiting, no `maxOutputTokens`, no token/cost ceiling** anywhere
  (grep-confirmed). Cost controls today are pre-call gating only (MIME allowlist, 7MB cap,
  single image/turn, 12s budget) on the free-tier Flash model.

**Reuse vs build-new**: reuse `src/lib/api.ts` guards, the `AI_API_KEY` env seam +
`ai_unavailable` degrade contract, the `AbortController`+timeout+`finally` scaffold,
the retry/backoff helpers, and the Gemini wiring conventions. Build new: multi-turn
`contents` with `role: "user"|"model"` turns, turn/state management, a streaming
(`streamGenerateContent` + SSE) path replacing buffered `res.json()`/the `json()`
helper, a disease-diagnosis prompt (replacing the care schema), an idle-based timeout
(12s total is too tight for streamed multi-turn), and rate-limit/token ceilings
(multi-turn materially raises cost).

### Area 3 — Chat UI & state patterns

- **Island pattern**: every interactive component is mounted **`client:load`** (no
  `client:visible`/`idle`/`only` anywhere). `.astro` frontmatter does all server fetch
  via Supabase, maps rows to **JSON-serializable DTOs**, passes them as props; the
  island owns all client mutations. A `ChatPanel` island on a new `src/pages/ask.astro`
  fits exactly. (`@astrojs/react` v5; `@/*`→`src/*`.)
- **Hooks**: **no `src/components/hooks/` directory and no custom hooks exist.** All
  islands use inline `useState`/`useRef`/`useEffect` (+ one `useFormStatus` in
  `auth/SubmitButton.tsx`). The chat state/streaming hook is authored from scratch; the
  idiom to follow is the AbortController + timeout + status-enum pattern in
  `AddPlantForm.tsx` and `today/TodayList.tsx`.
- **shadcn/ui present** (`src/components/ui/`): `alert-dialog`, `alert`, `button`, `card`,
  `checkbox`, `input`, `label`, `number-stepper` (custom), `skeleton`, `switch`, `textarea`.
  Useful & ready: `Textarea` (auto-grow composer), `Button` (`size="icon"` send),
  `Card` (message bubbles/panel), `Skeleton` (assistant "thinking", already used at
  `AddPlantForm.tsx:341`), `Alert` (error). **Missing → `npx shadcn@latest add`:**
  `scroll-area` (transcript), `avatar` (message avatars), and a modal/panel
  (`dialog`/`sheet`/`drawer` — only `alert-dialog` exists). Style new-york, icons lucide.
- **Async fetch reference**: `AddPlantForm.tsx` models status as **string-literal union
  state machines** (`UploadStatus`, `AiStatus` at `:42-43`), not booleans; AbortController
  + timeout per fetch; loading via `Skeleton` + `aria-live="polite"`; errors via inline
  `Alert`. **Optimistic UI** reference is `today/TodayList.tsx` `markWatered` (`:24-53`):
  remove from local state → fetch → re-insert + toast on failure — maps directly to
  append-user-message + pending-assistant-message + rollback-on-error.
- **No streaming/SSE consumption exists** — all fetches are `await res.json()`. Token
  streaming is net-new on both client read-loop and a new endpoint.
- **Errors/toasts**: three conventions coexist — inline `Alert`, custom auth
  `ServerError`/`FormField`, and **sonner** `toast.*` (preferred for transient async
  failures; render `<Toaster richColors position="bottom-right" />` once in the island;
  supports undo actions + `toast.dismiss(id)`). `cn()` from `@/lib/utils` (clsx +
  tailwind-merge) is the class-merge convention.
- **Nav**: shared `src/components/NavBar.astro` (pure Astro, reads `Astro.locals.user`,
  prop `active?: "dashboard"|"today"|"settings"`). Single source-of-truth `navItems`
  array (`:18-22`) drives both desktop top nav and mobile fixed bottom bar. To add
  "Ask AI": (1) add `{ key: "ask", href: "/ask", label: "Ask AI" }`; (2) widen the
  `active` union; (3) **add an inline-SVG icon block for the new key in the mobile bottom
  bar** (`:181-225`) or the mobile tile renders icon-less (easy to miss). Legacy
  `Topbar.astro` may still be used by some pages — confirm before assuming NavBar is universal.

### Area 4 — Data model & persistence

- **Six migrations**, naming `YYYYMMDDHHMMSS_snake_case_description.sql`. A new one
  sorts after `20260624120000` (e.g. `20260630HHMMSS_ai_chat_diagnosis.sql`). **No seed
  data.** No existing chat/conversation/diagnosis table, type, or code (grep-confirmed).
- Foundational `20260608171954_core_domain_schema.sql` creates `locations`, `plants`,
  `care_events` + RLS + grants in one file (the header explains the deliberate "a table
  is never live without its policies" convention). Every table denormalizes
  `user_id uuid not null default auth.uid() references auth.users(id) on delete cascade`.
- **Load-bearing convention — same-user FK guards** (`core_domain:113-157`): any child
  whose owning FK points at a user-owned parent needs a `SECURITY INVOKER` BEFORE
  INSERT/UPDATE trigger asserting the parent's `user_id` matches `new.user_id` (e.g.
  `assert_care_event_plant_same_user`). Needed because the with-check still passes when
  `user_id` defaults to `auth.uid()`.
- **RLS template** (cleanest copy source: `20260624120000_user_preferences.sql:20-37`):
  per table, `enable row level security` + **four separate policies** named
  `"<table>_<op>_own"`, each `to authenticated`, ownership via
  `(select auth.uid()) = user_id` (subquery-wrapped for initplan caching), plus
  `grant select, insert, update, delete on table <T> to authenticated, service_role;`
  (anon intentionally excluded).
- **`plant-photos` Storage bucket**: private, 10MiB, png/jpeg/webp; defined in
  `supabase/config.toml:117-120` (local) and migration `20260608174754_plant_photos_storage.sql`
  (remote, idempotent). Four `storage.objects` policies keyed on first path segment =
  owner uid. Path convention `<user_id>/<plant_id>/<filename>` (built at
  `upload-url.ts:74`). `plants.photo_path` stores the **object key, not a URL** (private
  bucket → signed read URLs minted on demand in `src/lib/storage.ts`).
- **Persistence options for chat**:
  - **(a) Ephemeral / no DB** — mirrors the current stateless `/api/plants/suggest`
    (persists nothing; the caller writes results). Lowest cost, no migration, most
    consistent with the "AI is stateless, catalog survives AI outage" posture. No
    cross-reload/device history.
  - **(b) Persisted** `diagnosis_conversations` + `diagnosis_messages` — two tables on
    the §4 template. `diagnosis_conversations`: `id`, `user_id`, **nullable**
    `plant_id references plants(id) on delete cascade`, `photo_path`, `title`,
    timestamps + `set_updated_at`. `diagnosis_messages`: `id`, denormalized `user_id`,
    `conversation_id … on delete cascade`, a `chat_message_role` enum (`'user','assistant'`,
    following the `care_event_kind` enum convention), `content text not null`,
    `created_at` (append-only like `care_events`), index `(conversation_id, created_at)`.
    Both need the four-policy RLS, grants, and **same-user FK guard triggers** (guard
    `plant_id` only when non-null).
- **Standalone vs. linked**: change.md (12-15) lets the user diagnose from a fresh
  photo of an **uncatalogued** plant; the existing suggest flow likewise runs before a
  plant row exists (plant id pre-minted at `upload-url.ts:73`). So a session should
  **not hard-require** a plant — make `plant_id` **nullable**, optionally linking to an
  existing `plants.id` when the user started from a catalog plant.

## Code References

- `src/components/plants/AddPlantForm.tsx:267-322` — reusable photo picker/capture/preview block
- `src/components/plants/AddPlantForm.tsx:95-178` — `runUpload` (signed PUT) + `runSuggest` (AI handoff)
- `src/components/plants/PlantDetail.tsx:67-119` — second consumer; duplicate upload logic
- `src/lib/image.ts:26-49` — `downscaleToBase64`, fully generic, drop-in
- `src/lib/storage.ts:6-67` — signed read/upload-URL helpers; bucket name hard-coded
- `src/pages/api/plants/upload-url.ts:21-106` — signed-upload mint (plant-coupled)
- `src/pages/api/plants/suggest.ts:16-86` — single-shot AI endpoint, guards, uniform degrade
- `src/lib/ai/suggest.ts:19-176` — **Gemini** transport seam, prompt/schema, retry, parsing
- `src/lib/api.ts:10-64` — `json`, `requireUser`, `requireSameOrigin`, `UUID_RE`
- `src/components/today/TodayList.tsx:24-53,140` — optimistic UI + sonner pattern
- `src/components/NavBar.astro:11,18-22,181-225` — nav array, `active` union, mobile icon blocks
- `src/components/ui/` — present shadcn set (textarea/button/card/skeleton/alert ready)
- `src/types.ts:52-58` — `AiSuggestion` DTO
- `supabase/migrations/20260608171954_core_domain_schema.sql:113-227` — same-user guards + RLS template
- `supabase/migrations/20260624120000_user_preferences.sql:7-37` — cleanest new-table template
- `supabase/migrations/20260608174754_plant_photos_storage.sql:10-68` — bucket + storage RLS + path convention
- `CLAUDE.md` "Tripwires" — untrusted AI-text rule (applies to whole chat transcript)

## Architecture Insights

- **Stateless-AI posture is a design principle, not an accident**: the suggest endpoint
  persists nothing, degrades to `ai_unavailable` at HTTP 200, and the catalog is fully
  usable with AI off (`createClient`/`AI_API_KEY` both optional). A chat feature should
  preserve this — ephemeral-first, and any persistence kept orthogonal to availability.
- **Upload path and AI path are already decoupled** (the AI gets a separate downscaled
  base64 copy directly from the browser; `PlantDetail` uploads with no AI call). A chat
  photo picker can pick either path independently.
- **Provider isolation already exists** at `src/lib/ai/suggest.ts` (the "swap providers
  here only" seam) — extend this file/seam for chat rather than scattering Gemini calls.
- **RLS is uniform and copy-pasteable**: four `<table>_<op>_own` policies + denormalized
  `user_id` + same-user FK guard triggers. The guard triggers are the easy-to-forget part.
- **Two structural gaps define the build cost**: no streaming primitives, and no
  multi-turn message model. Everything else is assembly of existing parts.

## Historical Context (from prior changes)

- `context/changes/ai-chat-plant-disease-diagnosis/change.md` — the change identity:
  scopes "Ask AI" as a deliberately pulled-forward **v2** feature (PRD line 180 lists it
  as a Non-Goal; do not edit that section). Flags reuse of the add-plant photo UI and the
  AI-vision endpoint. **Note its line 24 "Anthropic provider wiring" is inaccurate** — the
  code uses Google Gemini (corrected throughout this research). Status advanced
  `new → preparing` during this research.

## Related Research

- None yet — this is the first research artifact for this change. (`context/changes/`
  contains other in-flight changes; `context/archive/` holds closed ones — none overlap
  the AI-chat surface.)

## Open Questions

1. **Streaming or single-shot for v1?** Single-shot (reuse `generateContent` +
   `ai_unavailable` degrade) is far cheaper to build; streaming (`streamGenerateContent`
   + SSE) is net-new on both ends. Product call.
2. **Persistence: ephemeral (a) or persisted (b)?** Drives whether a migration + two
   tables are in scope. Ephemeral matches current posture; persisted needs the §4 schema.
3. **Cost/abuse controls**: there is no rate limiting or token ceiling today. Multi-turn
   chat materially raises Gemini cost — is a per-user rate limit / `maxOutputTokens` in
   scope for v1?
4. **Entry point shape**: dedicated `/ask` page+island, or a slide-out `sheet`/`drawer`
   panel reachable from a plant? Affects nav changes and which shadcn primitive to add.
5. **Diagnosis prompt language/format**: the existing prompt forces Polish output and a
   JSON schema — chat likely wants free-form conversational text; new prompt design needed.
