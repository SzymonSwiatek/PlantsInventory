---
date: 2026-06-08T21:03:55+02:00
researcher: Szymon Świątek
git_commit: 14446b1ea36b4c72140ae0d2b5a8084d7ff73c4b
branch: main
repository: PlantsInventory
topic: "First plant from a photo — AI care suggestion, accept/edit, save to a location (S-01 north star)"
tags: [research, codebase, plants, ai-vision, supabase-storage, rls, astro-api, cloudflare-workers]
status: complete
last_updated: 2026-06-08
last_updated_by: Szymon Świątek
---

# Research: First plant from a photo (S-01 north star)

**Date**: 2026-06-08T21:03:55+02:00
**Researcher**: Szymon Świątek
**Git Commit**: 14446b1ea36b4c72140ae0d2b5a8084d7ff73c4b
**Branch**: main
**Repository**: SzymonSwiatek/PlantsInventory

## Research Question

For the S-01 slice `first-plant-from-photo` (a signed-in user uploads a plant photo, an AI provider suggests species + care info within ~10s, the user accepts/edits/replaces any field, and saves the plant into a location — with a manual-creation fallback when AI is unavailable): map the **current codebase** so `/10x-plan` can build on it. Specifically: (1) verify exactly what F-02 landed (schema, RLS, storage, types, DTOs); (2) map all three integration seams — Supabase Storage signed-upload, the AI vision call, the magic-link auth boundary; (3) inventory the frontend form patterns. The AI provider/model choice is intentionally **deferred to `/10x-plan`** — this research defines the seam, not the vendor.

## Summary

**Both prerequisites are landed and verified** (CLAUDE.md is stale on both points):

- **F-01 (magic-link auth) is live**, not the password scaffold. Sign-in is `signInWithOtp`; the callback `src/pages/auth/confirm.ts` runs `verifyOtp`. There is no `signInWithPassword`, no `signUp`, no signup endpoint anywhere in `src`.
- **F-02 (domain schema + RLS + storage + types + DTOs) is fully landed** across three migrations. `locations`, `plants`, `care_events` exist with deny-by-default RLS, same-user FK-guard triggers, and a private `plant-photos` storage bucket (10 MiB, `png/jpeg/webp`) with per-user-folder RLS. Generated types live at `src/db/database.types.ts`; the stable DTO surface (incl. an `AiSuggestion` snapshot type) lives at `src/types.ts`.

**The `plants` row is already shaped for this exact slice.** It has every field the AI fills (`species`, `description`, `sunlight`, `watering_interval_days`, `winterization_cutoff`, `note`), a `photo_path` for the Storage object key, and a write-once `ai_suggestion jsonb` snapshot column purpose-built for the 75%-acceptance metric and the FR-015 "view original suggestion" feature. `name` + `location_id` are the only required inserts; `user_id`/`id`/timestamps default server-side.

**The three seams have very different maturity:**

1. **Auth boundary — done, just reuse.** The `createClient(headers, cookies)` factory is typed `<Database>` and resolves the user's JWT so RLS + storage policies evaluate correctly. Two gotchas for the plan: `/api/*` routes are **not** covered by `PROTECTED_ROUTES`, so every new endpoint must guard auth itself (read `context.locals.user`, 401 if null); and `locals.supabase` is **not** exposed — each endpoint/page calls `createClient(...)` itself.
2. **Storage upload — architecture already decided, not yet coded.** The landed decision (from the F-02 plan) is **direct-to-Storage**: the browser uploads the ~10 MB image straight to Supabase via a **signed upload URL** minted by an endpoint; the bytes **never transit the Worker** (decoding 10 MB would trip the free-tier ~10 ms CPU limit). The endpoint then stores the object key in `plants.photo_path`. A naive server-side `storage.upload(file)` is the anti-pattern.
3. **AI vision call — greenfield.** Zero AI dependencies or code exist. The seam is built from scratch: add an `AI_API_KEY` secret mirroring the existing `astro:env/server` pattern (keep it `optional: true` so a missing key degrades to manual create), call the provider over standard `fetch` (lazy-import any SDK to protect the Worker bundle size), and have the AI route read the image from Storage (or a signed read URL) rather than re-receiving the bytes.

**Frontend is a thin but sound starter.** There is a reusable form-island pattern (`SignInForm` + `FormField` + `SubmitButton` + `ServerError`, `useState` + native `<form method="POST">` + `useFormStatus()`), `client:load` hydration, a Layout shell, Tailwind 4 CSS-first tokens, and `cn()`. But **shadcn/ui has only `Button`** — Input, Label, Textarea, Select, Card, Alert, Skeleton/Spinner, Dialog, and a file input all need adding. There is **no JSON-returning endpoint, no list/index page, and no domain CRUD** yet — those conventions get established by this slice.

**The roadmap's "three integration surfaces at once" risk is real but de-riskable** exactly as the change.md mitigation says: ship the photo-storage path and the AI-call path behind small, individually-observed endpoints before stitching them into the form.

## Detailed Findings

### Area 1 — F-02 domain surface (schema, RLS, types, DTOs, storage)

**Migrations** (`supabase/migrations/`, all landed):

- `20260608171954_core_domain_schema.sql` — enum `care_event_kind ('water','winterize')`; tables `locations`, `plants`, `care_events`; `set_updated_at()` BEFORE-UPDATE triggers on `locations`/`plants`; two same-user FK-guard triggers; RLS enabled + 4 policies/table.
- `20260608174754_plant_photos_storage.sql` — `plant-photos` bucket + 4 `storage.objects` policies.
- `20260608182949_plants_name_check.sql` — adds `plants_name_check`.

**`plants` table — the form's target** (core migration ~L45–66). Required on insert: `name text` (CHECK `char_length(btrim(name)) between 1 and 100`), `location_id uuid` (FK → `locations`, ON DELETE CASCADE). Server-defaulted: `id` (`gen_random_uuid()`), `user_id` (`auth.uid()`), `created_at`/`updated_at` (`now()`). AI-fillable / user-editable (all nullable):

| Column                   | Type      | Role                                                  |
| ------------------------ | --------- | ----------------------------------------------------- |
| `species`                | `text`    | AI species guess (user can override)                  |
| `description`            | `text`    | AI short prose description                            |
| `sunlight`               | `text`    | AI light needs (free text, **not** an enum)           |
| `watering_interval_days` | `integer` | CHECK `> 0`; AI suggestion or NULL                    |
| `winterization_cutoff`   | `date`    | NULL = "no winterization"                             |
| `note`                   | `text`    | FR-017 free-text note                                 |
| `photo_path`             | `text`    | Storage object key (`<uid>/<plant_id>/<file>`)        |
| `ai_suggestion`          | `jsonb`   | **write-once** snapshot of the original AI suggestion |

Reminder-state columns also exist (`last_watered_at`, `next_water_due_at`, `water_snooze_until`, `winterized_at`) but their write logic is **owned by S-04/S-05** — leave NULL on create. Partial index `plants_user_next_water_due_idx on (user_id, next_water_due_at) WHERE next_water_due_at IS NOT NULL` is for the future today-list/cron.

**RLS (deny-by-default).** Every table: 4 policies (`select`/`insert`/`update`/`delete`), all `to authenticated`, predicate `(select auth.uid()) = user_id` (scalar-subquery form for initplan caching). No `anon` policies. Two BEFORE INSERT/UPDATE triggers add cross-user FK integrity that RLS alone can't give: `plants_location_same_user` (a plant can't point at another user's location) and `care_events_plant_same_user`.

**Storage bucket** (`plant_photos_storage.sql` L18–26): id/name `plant-photos`, `public=false`, `file_size_limit=10485760` (10 MiB), `allowed_mime_types=['image/png','image/jpeg','image/webp']`, idempotent (`on conflict do nothing`). Mirrored locally in `supabase/config.toml` (`[storage.buckets.plant-photos]`). **Object-key convention is load-bearing for RLS**: `'<user_id>/<plant_id>/<filename>'` — the 4 `storage.objects` policies gate on `bucket_id = 'plant-photos' and (storage.foldername(name))[1] = (select auth.uid())::text`. Any upload path must place the object under `<auth.uid()>/…` or RLS rejects it.

**Generated types** — `src/db/database.types.ts` (excluded from eslint/prettier via `eslint.config.js` ignores + `.prettierignore`). Exports `Database` with `public.Tables.{plants,locations,care_events}.{Row,Insert,Update}` and `public.Enums.care_event_kind`. On `plants` Insert, `name` + `location_id` are required; everything else optional.

**DTO surface** — `src/types.ts` is the **stable import boundary; feature code imports from here, never from `database.types.ts`** (per the file's own header). Exports: `Location`/`Plant`/`CareEvent` (Rows), `LocationInsert`/`PlantInsert`/`CareEventInsert`, `LocationUpdate`/`PlantUpdate`/`CareEventUpdate`, `CareEventKind`, and:

```ts
export interface AiSuggestion {
  // src/types.ts:36-42 — shape stored in plants.ai_suggestion
  species: string | null;
  description: string | null;
  sunlight: string | null;
  watering_interval_days: number | null;
  winterization_cutoff: string | null; // ISO date YYYY-MM-DD
}
```

This is the contract the AI provider response should be normalized into, and the snapshot persisted verbatim on create (never overwritten on edit) for the acceptance metric.

### Area 2 — Auth boundary, Supabase client, API-route conventions

**Client factory** (`src/lib/supabase.ts:6-24`): `createClient(requestHeaders: Headers, cookies: AstroCookies)` builds a `createServerClient<Database>(...)` (typed!) from `SUPABASE_URL`/`SUPABASE_KEY` (imported from `astro:env/server`), parsing the inbound `Cookie` header and writing refreshed cookies back. **Returns `null` when unconfigured** (`:7-9`) — every caller null-checks. Because it carries the request JWT, `auth.uid()` resolves correctly inside both table RLS and storage RLS, and `.storage.from('plant-photos')` is usable on the same client — **no separate client needed for uploads**.

**Middleware** (`src/middleware.ts`): builds a client, calls `supabase.auth.getUser()`, sets `context.locals.user = user ?? null`. `PROTECTED_ROUTES = ["/dashboard"]` (`:4`) — `startsWith` match, redirect to `/auth/signin`. **Two consequences for the plan:**

- A new page like `/plants` or `/locations/[id]` is **public until added to `PROTECTED_ROUTES`**.
- `locals.supabase` is **not** set — middleware discards its client. Each endpoint/page calls `createClient(...)` itself.

**`src/env.d.ts`**: `App.Locals` has only `user: User | null`. No `supabase`.

**Endpoint conventions** — all existing handlers are form-POST + redirect, none return JSON:

- `src/pages/api/auth/signin.ts` — `export const POST: APIRoute`, reads `await context.request.formData()`, null-checks client → `context.redirect('/auth/signin?error=' + encodeURIComponent(...))`, calls `signInWithOtp({ email, options:{ emailRedirectTo: ${origin}/auth/confirm } })`, success → `/auth/check-email`.
- `src/pages/api/auth/signout.ts` — minimal POST, null-degrades, redirects `/`.
- `src/pages/auth/confirm.ts` — `GET: APIRoute` magic-link callback: `verifyOtp({ type, token_hash })`, with an open-redirect guard `safeNext()` on `?next=` (default `/dashboard`).

**New-endpoint guidance (no JSON endpoint exists yet — this slice establishes it):**

- `export const POST: APIRoute = async (context) => {…}`; build client via `createClient(context.request.headers, context.cookies)`; null-check.
- **Guard auth in-endpoint** (because `/api/*` isn't in `PROTECTED_ROUTES`): read `context.locals.user`, return 401 if null.
- JSON body: `await context.request.json()`; photo multipart: `await context.request.formData()` + `form.get('photo') as File`.
- Return `new Response(JSON.stringify(payload), { status, headers:{ 'Content-Type':'application/json' } })`. There is no JSON-response helper yet — establish one.
- Inserts go through the typed client: `supabase.from('plants').insert(<PlantInsert>)`; import DTOs from `src/types.ts`.

**Page gating pattern** (`src/pages/dashboard.astro:4`): `const { user } = Astro.locals;` then use `user` for display — the page never re-checks because middleware guarantees non-null on a protected route. A new plant page: (1) add its path to `PROTECTED_ROUTES`, (2) read `Astro.locals.user`, (3) for server-side data build `createClient(Astro.request.headers, Astro.cookies)` and `supabase.from('plants').select(...)` (RLS-scoped).

### Area 3 — Frontend building blocks (form island, UI kit, layout)

**Reusable form-island pattern** (the template to copy for the Add-Plant form):

- `src/components/auth/SignInForm.tsx` — `useState` form state, **native** `<form method="POST" action="/api/...">` (not `fetch`), client-side validation before submit, server errors via `serverError` prop / URL `?error=`. No form library (no react-hook-form).
- `src/components/auth/FormField.tsx` — controlled input + label + error/hint + left icon (auth-styled, hardcoded colors — reference, not directly reusable).
- `src/components/auth/SubmitButton.tsx` — uses `useFormStatus()` for the pending/spinner state (works with native form POST).
- `src/components/auth/ServerError.tsx` — red alert box.

> Note for the plan: the Add-Plant flow is **not** a simple native POST — it needs an async AI round-trip and a pre-fill-then-edit step, so it will likely need `fetch`-based submission (the first in the repo) rather than the native-POST pattern. The `useFormStatus()` pending trick only works inside a native `<form>` action; an async/`fetch` flow needs its own loading state.

**Mounting**: Astro pages import the island and hydrate `client:load` (e.g. `src/pages/auth/signin.astro:17` `<SignInForm serverError={error} client:load />`).

**Layout**: `src/layouts/Layout.astro` is the shell (`<head>`, global `Banner` for missing-config, `<slot/>`), imports `src/styles/global.css`. Navigation is plain `<a href>` (SSR, no client router). `src/components/Topbar.astro` branches on `Astro.locals.user`.

**shadcn/ui inventory** (`src/components/ui/`): **only `button.tsx`** (CVA variants: default/destructive/outline/secondary/ghost/link; sizes; `asChild` via Radix Slot) plus `LibBadge.astro`. **Missing and needed:** Input, Label, Textarea, Select/Combobox (for sunlight/winterization if not free-text), Card, Alert/Toast, Skeleton or Spinner (for the AI-loading state), Dialog (optional), and a file input. Add via `npx shadcn@latest add <name>` ("new-york" style is configured).

**Utilities & tokens**: `src/lib/utils.ts` → `cn(...inputs: ClassValue[])` (clsx + tailwind-merge). `src/styles/global.css` — Tailwind 4 CSS-first (`@import "tailwindcss"`, `@theme inline`), oklch design tokens (`--primary`, `--card`, `--destructive`, `--ring`, `--radius`, …), `.dark` overrides, and a `@utility bg-cosmic` gradient used on auth shells. No `tailwind.config`. Icons: `lucide-react`.

**Gaps**: no list/index page pattern (the "location's plant list" in FR-014 is greenfield UI), no domain components, no plant CRUD endpoints, no AI route.

### Area 4 — Runtime, secrets, AI seam & storage-upload constraints

**Secret pattern** (`astro.config.mjs:17-22`): two secrets declared identically — `envField.string({ context:"server", access:"secret", optional:true })` — read via `import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server"` (`src/lib/supabase.ts:3`). `access:"secret"` means runtime-read, **not** baked into the bundle. **To add the AI key**, append to the schema:

```js
AI_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
```

Keep `optional: true` — a missing key must degrade to manual create (PRD guardrail "catalog survives AI outage"), not throw. Add base-URL/model as sibling `envField.string` entries if the chosen provider needs them.

**Local + prod stores are separate.** `.env` (Node toolchain) and `.dev.vars` (workerd local) are gitignored; `.env.example` documents keys (currently `SUPABASE_URL`, `SUPABASE_KEY`). Dev must add `AI_API_KEY` to **both** `.dev.vars` and `.env`, plus `AI_API_KEY=###` to `.env.example`. Prod needs `npx wrangler secret put AI_API_KEY` separately — a missing prod secret degrades **silently** (same trap as Supabase).

**`wrangler.jsonc`**: `name:"10x-plants-inventory"` (**tripwire resolved** — CLAUDE.md is stale; `package.json` matches), `main:"@astrojs/cloudflare/entrypoints/server"`, `compatibility_date:"2026-05-08"`, `compatibility_flags:["nodejs_compat"]`, Workers-with-static-assets (`assets` binding `ASSETS`, `./dist`), `observability.enabled:true`, **no `vars`, no secrets bindings, no `triggers.crons`** (correct — cron is deferred to S-04/S-05). First deploy auto-provisioned a KV `SESSION` and an unused Cloudflare `IMAGES` binding (storage routes to Supabase, not Cloudflare Images — ignore `IMAGES` for this slice).

**workerd constraints that shape the design:**

- Standard `fetch` to the AI provider works (no adapter). `nodejs_compat` is a **partial** shim — a Node-oriented AI SDK reaching for `fs`/`net`/stream internals can fail only at the edge; **lazy-import** any SDK and exercise the path on real `wrangler dev`/`workerd` before deploy. Keep the bundle lean (current 391 KiB gzip; free-tier cap ~3 MB).
- `Request.formData()`/`File`/`Blob` are supported (auth routes already use `formData()`), **but** the team decided **not** to stream the 10 MB image through the Worker at all (next point).
- **CPU ~10 ms free tier** is the binding constraint and the reason decoding a ~10 MB image in-Worker is forbidden (infrastructure.md). Workers bill **CPU**, not wall-clock, so an `await`ed ~10 s AI `fetch` does **not** by itself blow the CPU budget while suspended.
- **Verify at plan time (not in repo):** exact Workers subrequest count, request-body-size cap, and free-vs-paid CPU/wall-clock limits; Supabase `createSignedUploadUrl` size cap / TTL semantics.

**Direct-to-Storage upload (the decided pattern, not yet coded):** per the F-02 plan, photos go **directly** to Supabase Storage, never through the Worker. Intended flow: an endpoint mints a **signed upload URL** (`createSignedUploadUrl`) under `<auth.uid()>/…`; the **browser uploads bytes directly** to Supabase; the plant row stores the returned object key in `plants.photo_path`. The signed URL is issued via the existing JWT-bearing client so the storage RLS policies pass. For the AI call, prefer having the AI route read the image **from Storage** (or a short-lived signed read URL) rather than re-receiving the 10 MB — so the bytes never re-enter the Worker. **Orphan caveat:** DB `CASCADE` deletes `plants` rows but **not** Storage objects — abandoned uploads can orphan objects (not a blocker for create, but note it).

## Code References

GitHub permalinks (commit `14446b1`). Local `path:line` anchors are also clickable in-terminal.

- [`supabase/migrations/20260608171954_core_domain_schema.sql`](https://github.com/SzymonSwiatek/PlantsInventory/blob/14446b1ea36b4c72140ae0d2b5a8084d7ff73c4b/supabase/migrations/20260608171954_core_domain_schema.sql) — `plants`/`locations`/`care_events`, RLS (4 policies/table, `(select auth.uid()) = user_id`), same-user FK-guard triggers, `updated_at` triggers
- [`supabase/migrations/20260608174754_plant_photos_storage.sql`](https://github.com/SzymonSwiatek/PlantsInventory/blob/14446b1ea36b4c72140ae0d2b5a8084d7ff73c4b/supabase/migrations/20260608174754_plant_photos_storage.sql) — `plant-photos` bucket (private, 10 MiB, png/jpeg/webp) + 4 `storage.objects` policies; key convention `<uid>/<plant_id>/<file>`
- [`supabase/migrations/20260608182949_plants_name_check.sql`](https://github.com/SzymonSwiatek/PlantsInventory/blob/14446b1ea36b4c72140ae0d2b5a8084d7ff73c4b/supabase/migrations/20260608182949_plants_name_check.sql) — `plants_name_check (char_length(btrim(name)) between 1 and 100)`
- [`src/types.ts`](https://github.com/SzymonSwiatek/PlantsInventory/blob/14446b1ea36b4c72140ae0d2b5a8084d7ff73c4b/src/types.ts) — stable DTO surface; `PlantInsert`, `AiSuggestion` (`:36-42`). **Import domain types from here, not `database.types.ts`.**
- [`src/db/database.types.ts`](https://github.com/SzymonSwiatek/PlantsInventory/blob/14446b1ea36b4c72140ae0d2b5a8084d7ff73c4b/src/db/database.types.ts) — generated `Database`; `plants` Insert requires only `name`+`location_id`
- [`src/lib/supabase.ts`](https://github.com/SzymonSwiatek/PlantsInventory/blob/14446b1ea36b4c72140ae0d2b5a8084d7ff73c4b/src/lib/supabase.ts) — `createClient(headers, cookies)` typed `<Database>`, null-when-unconfigured, JWT-scoped (DB + storage)
- [`src/middleware.ts`](https://github.com/SzymonSwiatek/PlantsInventory/blob/14446b1ea36b4c72140ae0d2b5a8084d7ff73c4b/src/middleware.ts) — `PROTECTED_ROUTES = ["/dashboard"]` (`:4`); sets only `locals.user`; **does not expose `locals.supabase`**
- [`src/env.d.ts`](https://github.com/SzymonSwiatek/PlantsInventory/blob/14446b1ea36b4c72140ae0d2b5a8084d7ff73c4b/src/env.d.ts) — `App.Locals { user }` only
- [`src/pages/api/auth/signin.ts`](https://github.com/SzymonSwiatek/PlantsInventory/blob/14446b1ea36b4c72140ae0d2b5a8084d7ff73c4b/src/pages/api/auth/signin.ts) — `APIRoute` + `formData()` + redirect-with-`?error=` pattern; `signInWithOtp`
- [`src/pages/auth/confirm.ts`](https://github.com/SzymonSwiatek/PlantsInventory/blob/14446b1ea36b4c72140ae0d2b5a8084d7ff73c4b/src/pages/auth/confirm.ts) — magic-link `GET` callback `verifyOtp`, `safeNext()` open-redirect guard
- [`src/pages/dashboard.astro`](https://github.com/SzymonSwiatek/PlantsInventory/blob/14446b1ea36b4c72140ae0d2b5a8084d7ff73c4b/src/pages/dashboard.astro) — protected-page `const { user } = Astro.locals` pattern
- [`src/components/auth/SignInForm.tsx`](https://github.com/SzymonSwiatek/PlantsInventory/blob/14446b1ea36b4c72140ae0d2b5a8084d7ff73c4b/src/components/auth/SignInForm.tsx) — form-island template (`useState`, native POST, `useFormStatus`)
- [`src/components/ui/button.tsx`](https://github.com/SzymonSwiatek/PlantsInventory/blob/14446b1ea36b4c72140ae0d2b5a8084d7ff73c4b/src/components/ui/button.tsx) — the **only** shadcn primitive present
- [`src/lib/utils.ts`](https://github.com/SzymonSwiatek/PlantsInventory/blob/14446b1ea36b4c72140ae0d2b5a8084d7ff73c4b/src/lib/utils.ts) — `cn()`
- [`src/layouts/Layout.astro`](https://github.com/SzymonSwiatek/PlantsInventory/blob/14446b1ea36b4c72140ae0d2b5a8084d7ff73c4b/src/layouts/Layout.astro) / [`src/styles/global.css`](https://github.com/SzymonSwiatek/PlantsInventory/blob/14446b1ea36b4c72140ae0d2b5a8084d7ff73c4b/src/styles/global.css) — shell + Tailwind 4 tokens
- [`astro.config.mjs`](https://github.com/SzymonSwiatek/PlantsInventory/blob/14446b1ea36b4c72140ae0d2b5a8084d7ff73c4b/astro.config.mjs) — `env.schema` (`:17-22`), where `AI_API_KEY` is added
- [`wrangler.jsonc`](https://github.com/SzymonSwiatek/PlantsInventory/blob/14446b1ea36b4c72140ae0d2b5a8084d7ff73c4b/wrangler.jsonc) — `nodejs_compat`, observability, no crons, name resolved
- [`.env.example`](https://github.com/SzymonSwiatek/PlantsInventory/blob/14446b1ea36b4c72140ae0d2b5a8084d7ff73c4b/.env.example) / [`supabase/config.toml`](https://github.com/SzymonSwiatek/PlantsInventory/blob/14446b1ea36b4c72140ae0d2b5a8084d7ff73c4b/supabase/config.toml) — env keys + local bucket parity

## Architecture Insights

- **Type flow is deliberate and one-directional:** SQL migration → `supabase gen types` → `src/db/database.types.ts` → re-exported DTOs in `src/types.ts` → feature code. Feature code must import from `src/types.ts` (the generated file is lint/format-excluded and not a stable boundary). `PlantInsert` and `AiSuggestion` are the two types the plan will lean on.
- **Security is layered, not UI-trusted:** per-user isolation is enforced at the DB (RLS `auth.uid() = user_id`), reinforced by FK-guard triggers (cross-user references), and at Storage (per-folder RLS via the `<uid>/…` key). The endpoint inherits all of this for free _as long as it uses the JWT-scoped client_ and does not pass an explicit foreign `user_id`.
- **The `ai_suggestion jsonb` column is a product decision encoded in the schema:** it exists to snapshot the original suggestion write-once, feeding both the FR-015 "view original" surface and the ≥75% acceptance metric (diff saved-vs-suggested). The plan should persist the normalized `AiSuggestion` on create and never overwrite it on edit.
- **The "don't put bytes in the Worker" rule is the spine of the design** — it dictates direct-to-Storage signed upload, an AI route that reads from Storage, lazy-imported SDKs, and a lean bundle. Violating it (server-side `storage.upload(file)`, decoding the image in-Worker) is the single most likely way to break the 10 MB NFR on the free tier.
- **The slice establishes three new conventions the codebase doesn't have yet:** the first JSON-returning API endpoint, the first `fetch`-based (non-native-POST) form island, and the first domain list/CRUD UI. These are net-new patterns, so the plan should set them thoughtfully (they'll be copied by S-02/S-03).
- **Auth is "done" but has two sharp edges:** `/api/*` is unguarded by middleware (endpoints self-guard via `locals.user`), and new protected pages must be added to `PROTECTED_ROUTES`. Both are easy to forget.

## Historical Context (from prior changes)

- `context/changes/domain-schema-with-rls/plan.md` — the F-02 plan. States the **direct-to-Storage mandate** explicitly (`:13`, `:28`): "Photos go DIRECTLY to Supabase Storage, never through the Worker… `plants.photo_path` holds a Storage object key." Documents `photo_path` + write-once `ai_suggestion` (`:82`), the no-DB→Storage-cascade orphan caveat (`:42`), and the bucket/RLS phase (all checks `[x]`).
- `context/foundation/infrastructure.md` — Cloudflare Workers risk register: ~10 ms free-tier CPU limit drives the storage architecture (`:61`, `:91`); `nodejs_compat` is partial → exercise full auth+AI path on `wrangler dev`, lazy-import the AI SDK, keep deps lean (`:62`, `:64`, `:92`, `:95`); local `.dev.vars` vs prod Workers Secrets are separate stores and a missing prod secret degrades quietly (`:74`, `:81`).
- `context/changes/deployment/deployment-plan.md` — live at `https://10x-plants-inventory.swiatek1996.workers.dev`; `access:"secret"` vars are runtime-read not bundled (`:119-123`); prod secrets via `wrangler secret put` after deploy (`:150-164`); first deploy auto-provisioned KV `SESSION` + unused `IMAGES` binding (`:132-137`); reminder cron deferred (`:385`).
- `context/changes/magic-link-auth/` — F-01 (now landed/live): the `signInWithOtp` + `confirm.ts verifyOtp` flow this slice's auth boundary reuses.

## Related Research

None prior for this change. This is the first `research.md` under `context/changes/first-plant-from-photo/`. Adjacent prior-change plans referenced above (`domain-schema-with-rls`, `deployment`, `magic-link-auth`) are the closest related artifacts.

## Open Questions

Carried forward for `/10x-plan` (none block opening the plan):

1. **AI vision provider + model + per-call cost ceiling** — deliberately deferred (change.md `:18`; PRD Open Q6 on disclosure). Default to the cheapest viable vision model the day planning starts. The seam (`AI_API_KEY` optional secret, `fetch`-based call, normalize to `AiSuggestion`, degrade-to-manual on absence/timeout) is provider-agnostic.
2. **Exact Cloudflare Workers limits** — subrequest count, request-body-size cap, free-vs-paid CPU/wall-clock ceilings. Not in the repo; verify against current Cloudflare docs at plan time before committing to the upload/AI request shape.
3. **Supabase `createSignedUploadUrl` semantics** — size cap and TTL for signed uploads; confirm it honors the bucket's 10 MiB limit and the `<uid>/<plant_id>/…` key path.
4. **"Minor edit" definition for the ≥75% acceptance metric** (PRD Open Q2) — instrumentation can ship now (snapshot `ai_suggestion`, record per-field diffs on save); the threshold is downstream.
5. **AI image input mechanism** — does the chosen provider accept a signed read URL, or require bytes? Decide so the 10 MB never re-enters the Worker (prefer URL/Storage-read).
6. **Sunlight / winterization field UI** — schema stores `sunlight` as free `text` and `winterization_cutoff` as `date`. Decide whether the form uses free-text/Select for sunlight and a date picker (or "none" toggle) for the cutoff. Pure UI choice; no schema change needed.
