# Watering Reminder Loop Implementation Plan

## Overview

Close the watering reminder loop (roadmap S-04): a daily Cloudflare cron emails each user a digest of plants due for watering, a dedicated `/today` page aggregates due plants across all of a user's locations, and users can mark plants watered (single and bulk), undo within a short window, and snooze a reminder by N days. This is the slice that satisfies PRD Success Criterion #3 (a user receives and acts on at least one reminder within their first two weeks).

## Current State Analysis

The schema and cron skeleton are already in place; the loop is unwired.

- **Schema is ready** (`supabase/migrations/20260608171954_core_domain_schema.sql`). `plants` carries every reminder column this slice needs — `watering_interval_days` (`> 0` check), `last_watered_at`, `next_water_due_at`, `water_snooze_until` — and the comment block states their "write/read logic ships in S-04/S-05." There is an append-only `care_events` table (`kind` enum `water | winterize`, `done_at`) with same-user FK guard triggers, and RLS scoped `to authenticated` with per-operation policies on all three tables. A **partial index `plants_user_next_water_due_idx` on `(user_id, next_water_due_at) where next_water_due_at is not null`** already exists, purpose-built for the cron scan and the today-list.
- **Cron skeleton is live** (`src/worker.ts`). It re-exports the `@astrojs/cloudflare` fetch handler and adds a `scheduled()` handler that calls `runScheduledTick(now)` (`src/lib/reminders/scheduled.ts`), currently a no-op heartbeat (`console.log` only). `wrangler.jsonc` declares `triggers.crons: ["0 18 * * *"]` (18:00 UTC = 20:00 CEST, daily). F-03's whole point was that this survives `@astrojs/cloudflare` adapter rebuilds.
- **Gap 1 — `next_water_due_at` is never populated.** `POST /api/plants` (`src/pages/api/plants/index.ts`) writes `watering_interval_days` but never `next_water_due_at`. So today no plant is ever "due." This slice must own the due-date lifecycle *and* backfill existing rows.
- **Gap 2 — the cron has no user session.** `createClient(headers, cookies)` (`src/lib/supabase.ts`) is a cookie/session `@supabase/ssr` client, and RLS is `to authenticated`. The cron can't read cross-user due plants, and the user's email lives in `auth.users` (invisible to the anon/authenticated key). This requires a service-role client + a new secret.
- **Gap 3 — no email provider.** No dependency installed; `astro.config.mjs` `env.schema` declares only `SUPABASE_URL`, `SUPABASE_KEY`, `AI_API_KEY` (all `context: "server", access: "secret", optional: true`). `context/foundation/infrastructure.md` confirms: "Email is not a platform primitive… MailChannels closed its free Workers route in 2024 → pick Resend/Postmark."
- **Established API conventions** (`src/lib/api.ts`): JSON endpoints under `/api/` self-guard via `requireUser(context)` (returns the `User` or a 401 `Response`), build responses with `json(payload, status)`, and map SQLSTATE codes in `CLIENT_ERROR_CODES` (`23514`, `23503`, `42501`) to 400 instead of 500. `/api/*` is outside the middleware's `PROTECTED_ROUTES` guard, so endpoints self-guard; page routes are protected via the `PROTECTED_ROUTES` array in `src/middleware.ts`.
- **Dashboard exists** (`src/pages/dashboard.astro`) and is where signed-in users land; it lists locations with plant counts. The today-list will be a sibling `/today` page linked from here.

## Desired End State

A signed-in user with at least one plant that has a watering interval:

- Opens `/today` and sees every plant due for watering across all their locations, with mark/snooze controls and a clean empty state when nothing is due.
- Marks one plant — or all of them via "mark all watered" — as watered; the plants vanish from the list immediately, the interval resets, and a ~5-second "Undo" toast can revert the action (restoring the prior state).
- Snoozes a plant by a chosen number of days; it disappears from the list and the digest until the snooze lapses, with the watering interval untouched.
- Receives, once per day at 18:00 UTC, an email listing exactly the plants needing water (no email when nothing is due), with a link back to `/today`.

**Verification:** `npm run test:run`, `npm run lint`, `npx astro sync` clean; migration applies (`npx supabase db reset` locally); a manual walkthrough of mark → undo → snooze on `/today`; and a manually triggered/observed cron tick sends a correctly-scoped digest.

### Key Discoveries:

- All reminder columns already exist on `plants` — **no new plant columns are needed** (`supabase/migrations/20260608171954_core_domain_schema.sql:57-63`).
- The cron-scan index is already built (`plants_user_next_water_due_idx`, same file, lines 72-74).
- The `scheduled()` handler already exists and is structured to call `runScheduledTick(now)` and swallow/log errors via `ctx.waitUntil(...).catch(...)` (`src/worker.ts:20-26`); F-03 left a note that "S-04 can wire the real types properly."
- The same-user FK guard triggers (`assert_care_event_plant_same_user`) already protect `care_events` inserts against cross-user `plant_id` (`...schema.sql:140-157`), so the care endpoints lean on existing DB-level isolation.
- TZ is pinned to UTC in `vitest.setup.ts`, so date math in unit tests is deterministic.

## What We're NOT Doing

- **Winterization reminders** (FR-019, mark-winterized) — that is S-05. This slice is watering-only; the `winterize` enum value and `winterization_cutoff` / `winterized_at` columns are left untouched.
- **Web push / in-app notifications** — PRD Open Question 1 defaults to email-only.
- **Per-notification configurability** — no per-user quiet hours, frequency settings, or channel preferences in v1.
- **Care history / journaling UI** — PRD Non-Goal. `care_events` is written and read for the loop, but there is no history screen and no soft-delete/audit trail.
- **Hard idempotency for the digest** — no "last sent" tracking table; we rely on `noRetry()` plus an idempotent daily query (accepted tiny double-send risk).
- **Changing `POST /api/plants`** beyond what the due-date trigger covers — the trigger makes the due date correct without editing the create endpoint.

## Implementation Approach

Build bottom-up so each phase is independently verifiable: (1) make "due" meaningful at the data layer via a DB trigger + backfill; (2) stand up the email + service-role plumbing; (3) wire the cron to query → compose → send; (4) add the user-facing care mutation endpoints; (5) build the `/today` UI on top. Phases 3 and 4-5 are independent once Phases 1-2 land, but the listed order keeps the dependency chain simple.

The due-date rule lives in the database (a `BEFORE` trigger), so every writer — the existing create endpoint, the new mark/snooze endpoints, and any future one — stays consistent without remembering to recompute. The cron uses a dedicated service-role client that must never be reachable from a request path. The care endpoints use the ordinary session client and lean on existing RLS + FK-guard triggers for isolation.

## Critical Implementation Details

- **Service-role key must never leak into request code.** The service-role client factory belongs in a cron-only module imported solely by `src/lib/reminders/*`. Do not import it from anything under `src/pages/api/` or `src/middleware.ts`. The factory reads the key from the env and returns `null` when unset (mirroring `createClient`'s degrade-gracefully contract) so the unconfigured app still builds and the cron no-ops.
- **Secrets in `scheduled()` come from the Worker `env` argument, not `astro:env/server`.** `@astrojs/cloudflare` populates the `astro:env/server` value-bag from per-request AsyncLocalStorage inside its *fetch* entrypoint; `scheduled()` runs outside that wrapper (`src/worker.ts:20` adds it alongside `...handler`), so ALS is never established and `astro:env/server` reads return `undefined` in cron context — a trap that fails *invisibly* because every unit test mocks `astro:env/server` green. Therefore the cron path threads the Cloudflare Worker `env` bag explicitly: `scheduled(controller, env, ctx)` → `runScheduledTick(now, env)` → `createServiceClient(env)` / `sendDigest(…, env)`. Define a small typed `ReminderEnv` interface (in `src/lib/reminders/env.ts` or `service-client.ts`) listing the five secrets read here — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `REMINDER_FROM_EMAIL`, `PUBLIC_SITE_URL` — typed `string | undefined`, and tighten the `_env: unknown` slot in `src/worker.ts:20` to it. Each factory still reads at call time and returns `null`/throws when a needed key is absent (degrade-gracefully contract preserved), so an unconfigured deploy no-ops rather than throwing. Request-path code is unchanged — it keeps using `astro:env/server` (which works there).
- **Undo must restore prior state from the log, not from client memory.** Marking watered sets `last_watered_at = now()` (trigger recomputes `next_water_due_at`) and clears `water_snooze_until`. Undo deletes the just-created `water` `care_event` and sets `last_watered_at` back to the `done_at` of the now-most-recent remaining `water` event for that plant (or `NULL` if none) — the trigger then recomputes the due date. State lives in the DB so undo survives a refresh.
- **Snooze vs. interval integrity.** Snooze sets only `water_snooze_until`; it never touches `watering_interval_days`, `last_watered_at`, or `next_water_due_at`. Due-and-not-snoozed is the filter everywhere: `next_water_due_at <= now() AND (water_snooze_until IS NULL OR water_snooze_until <= now())`.

## Phase 1: Due-date data foundation

### Overview

Make `next_water_due_at` correct for all current and future plants via a DB trigger, and backfill existing rows, so "due today" is meaningful.

### Changes Required:

#### 1. Due-date trigger + backfill migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_watering_due_date.sql` (new)

**Intent**: Add a `BEFORE INSERT OR UPDATE` trigger on `plants` that computes `next_water_due_at` whenever `watering_interval_days` or `last_watered_at` changes, and a one-time `UPDATE` to backfill existing rows. This closes Gap 1 in the DB so no app writer has to remember the rule.

**Contract**: A `SECURITY INVOKER` plpgsql function with `set search_path = ''` (matching the existing `set_updated_at` / FK-guard functions in the core schema). Rule: when `watering_interval_days IS NULL` → `next_water_due_at := NULL`; else `next_water_due_at := coalesce(last_watered_at, now()) + (watering_interval_days || ' days')::interval`. The trigger must not clobber a due date the app set deliberately on the same statement — recompute only when the inputs (`watering_interval_days`, `last_watered_at`) are part of the change (on `INSERT` always; on `UPDATE` when either differs from `OLD`). Backfill: a single `update plants set next_water_due_at = coalesce(last_watered_at, now()) + ... where watering_interval_days is not null` at the end of the migration. Snooze (`water_snooze_until`) is deliberately *not* an input to this trigger.

### Success Criteria:

#### Automated Verification:

- [ ] Migration applies cleanly on a fresh DB: `npx supabase db reset`
- [ ] Type generation still succeeds and lint passes: `npx astro sync && npm run lint`
- [ ] Existing tests pass: `npm run test:run`

#### Manual Verification:

- [ ] Inserting a plant with `watering_interval_days = 7` and no `last_watered_at` yields `next_water_due_at ≈ now() + 7d` (checked via SQL/Supabase studio)
- [ ] A pre-existing plant (created before this migration) with an interval now has a non-NULL `next_water_due_at` after `db reset`
- [ ] Updating `last_watered_at` shifts `next_water_due_at` accordingly; setting interval to NULL clears it

**Implementation Note**: After automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Email + service-role infrastructure

### Overview

Stand up the plumbing the cron needs: the Resend dependency, the new secrets, a service-role Supabase client, and an email-composition module — all degrading gracefully when unconfigured.

### Changes Required:

#### 1. Resend dependency + env schema

**File**: `package.json`, `astro.config.mjs`, `.env.example`, `.dev.vars` (local, gitignored — document in `.env.example`)

**Intent**: Install the Resend SDK and declare the new secrets so they're importable via `astro:env/server` and documented for local dev.

**Contract**: Add `resend` to dependencies. Extend the `env.schema` in `astro.config.mjs` with `RESEND_API_KEY` and `REMINDER_FROM_EMAIL`, both `context: "server", access: "secret", optional: true` (matching the existing optional-secret pattern so the app builds unconfigured). Add `SUPABASE_SERVICE_ROLE_KEY` with the same shape. Also add `PUBLIC_SITE_URL` as `context: "server", access: "public", optional: true` (non-secret — the deployed origin used to build the `/today` link in the digest email; see Phase 2 §3 and F3). Add all four new keys (`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `REMINDER_FROM_EMAIL`, `PUBLIC_SITE_URL`) to `.env.example` with placeholder values, joining the 3 existing keys. Note: the cron reads these from the Worker `env` bag at runtime (see Critical Implementation Details), but they are still declared in `env.schema` so request-path code and the type system know them. Run `npx astro sync` after editing `astro.config.mjs`.

#### 2. Service-role Supabase client

**File**: `src/lib/reminders/service-client.ts` (new)

**Intent**: A cron-only factory returning a service-role `@supabase/supabase-js` client that bypasses RLS and can read `auth.users`. Used solely inside `src/lib/reminders/*`.

**Contract**: `createServiceClient(env: ReminderEnv): SupabaseClient<Database> | null` — reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` **from the passed `env` bag** (the Cloudflare Worker env from `scheduled()`), *not* from `astro:env/server` (unavailable in cron context — see Critical Implementation Details). Returns `null` when either is unset (degrade-gracefully contract, mirroring `src/lib/supabase.ts:7-9`). Uses the non-SSR `createClient` from `@supabase/supabase-js` with `auth: { persistSession: false }`. Define the `ReminderEnv` interface here (or in a sibling `env.ts`) — see Critical Implementation Details for its fields. **Must not be imported by any file under `src/pages/` or `src/middleware.ts`.**

**Enforce the boundary in ESLint, not by convention.** Add an `import/no-restricted-paths` zone (or `no-restricted-imports`) to `eslint.config.*` forbidding imports of `@/lib/reminders/service-client` (and, more broadly, the `@/lib/reminders/**` cron modules) from any path outside `src/lib/reminders/**` — in particular `src/pages/**` and `src/middleware.ts`. This makes a stray import that would route an RLS-bypassing, `auth.users`-reading client into a request handler a lint *error*, not a review catch. Add a lint-check success criterion (below) that verifies a deliberate cross-boundary import fails.

#### 3. Reminder email module

**File**: `src/lib/reminders/email.ts` (new)

**Intent**: Compose and send the per-user watering digest via Resend, isolated so it can be unit/fault-tested without the cron.

**Contract**: Two functions — `composeDigest(plants: DuePlant[], siteUrl: string): { subject, html, text }` (pure, no I/O — testable) and `sendDigest(to: string, digest, env: ReminderEnv): Promise<void>` (Resend call). `DuePlant` is a small type (name, location name, days overdue) defined here or in `src/types.ts`. `sendDigest` reads `RESEND_API_KEY` / `REMINDER_FROM_EMAIL` **from the passed `env` bag** (not `astro:env/server` — unavailable in cron) at call time and throws on a missing key or a Resend error (the caller decides whether to continue). The digest links to `/today` as an absolute URL built from `siteUrl` (passed into `composeDigest` by the caller, which reads `env.PUBLIC_SITE_URL` — declared in Phase 2 §1). No hardcoded origin and no TODO ship in the email. If `PUBLIC_SITE_URL` is unset, `composeDigest` should fall back to a bare `/today` relative path or omit the link rather than emit a broken absolute URL.

### Success Criteria:

#### Automated Verification:

- [ ] `composeDigest` unit test: given N due plants, subject/body name each plant and its location: `npm run test:run`
- [ ] Lint + type-check pass with the new env fields: `npx astro sync && npm run lint`
- [ ] Build succeeds with all new secrets unset (graceful-degrade): `npm run build`
- [ ] ESLint boundary holds: a deliberate `import` of `@/lib/reminders/service-client` from a file under `src/pages/` fails `npm run lint` (revert the probe after confirming)

#### Manual Verification:

- [ ] With `RESEND_API_KEY` set locally, `sendDigest` to a real inbox delivers a readable digest (run via a throwaway script or test)
- [ ] Service-role client reads a plant row that the anon client could not (confirms RLS bypass works)

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Cron digest logic

### Overview

Replace the `runScheduledTick` heartbeat with the real loop: query due-and-not-snoozed plants grouped by user, compose one digest per user, send via Resend, with per-user error isolation and idempotent behavior.

### Changes Required:

#### 1. Implement `runScheduledTick`

**File**: `src/lib/reminders/scheduled.ts`

**Intent**: Drive the digest: service-role query → group by user → compose → send. Skip cleanly when unconfigured; never let one user's failure abort the rest.

**Contract**: `runScheduledTick(now: Date, env: ReminderEnv): Promise<void>` — gains the `env` parameter (the Cloudflare Worker env bag from `scheduled()`); secrets are read from it, never from `astro:env/server` (unavailable in cron — see Critical Implementation Details). The existing heartbeat test must be updated to pass a fake `env` bag (a plain object literal) instead of mocking `astro:env/server`. Preserve the `scheduled.tick` structured log. Steps: (a) `createServiceClient(env)`; if `null`, log `scheduled.skip` and return. Read `env.PUBLIC_SITE_URL` once for the digest link (pass to `composeDigest`), and thread `env` into each `sendDigest(…, env)` call. (b) Query `plants` where `watering_interval_days IS NOT NULL AND next_water_due_at <= now AND (water_snooze_until IS NULL OR water_snooze_until <= now)`, selecting plant name + `location_id`→location name (join) + `user_id` + `next_water_due_at` (for "days overdue"). (c) Fetch emails for the distinct `user_id`s via **`supabase.auth.admin.getUserById(userId)` per distinct due-user** (N small service-role calls — acceptable at this scale per the Performance section), reading `.user.email`. **Do not** use `.from("users")` — `auth.users` is not exposed over PostgREST (the `auth` schema isn't in the API) so a table read fails; and `auth.admin.listUsers()` paginates *all* users rather than looking up by id. Skip any user whose lookup fails or returns no email (log and continue). (d) Group plants by user; for each user with ≥1 due plant, `composeDigest` + `sendDigest`, wrapped in try/catch that logs `scheduled.email_error` and continues. (e) A user with zero due plants gets no email (US-02 AC). Emit a `scheduled.summary` log (counts) at the end.

#### 2. Wire `noRetry()` + real Worker types

**File**: `src/worker.ts`

**Intent**: Call `controller.noRetry()` so a platform retry doesn't re-send, thread the Worker `env` into `runScheduledTick`, and tighten the placeholder `ScheduledController`/`ExecutionContext`/`env` types now that S-04 owns this (F-03 left this as a follow-up).

**Contract**: In `scheduled()`, call `_controller.noRetry()` (rename to `controller`) before/around the `waitUntil`, and pass the `env` argument through: `runScheduledTick(new Date(), env)`. **Tighten the `_env: unknown` slot to the typed `ReminderEnv` interface** (no longer optional polish — the cron now depends on `env` for its secrets; rename `_env` → `env`). Keep the `.catch` error log. Do not import `@cloudflare/workers-types` globally if it still overrides `Response.json()` (the documented reason in `src/worker.ts:6-7`); a local typed interface is acceptable.

### Success Criteria:

#### Automated Verification:

- [ ] Unit test: due-plant selection filter excludes snoozed and not-yet-due plants (mock the service client): `npm run test:run`
- [ ] Fault test: a `sendDigest` rejection for one user does not prevent sends to other users (mirrors `src/lib/ai/suggest.fault.test.ts` pattern)
- [ ] Unit test: zero due plants for a user ⇒ `sendDigest` not called for them
- [ ] Existing heartbeat-log expectation still satisfied (or updated intentionally): `npm run test:run`
- [ ] Lint passes: `npm run lint`

#### Manual Verification:

- [ ] Manually invoke the scheduled handler (local `wrangler dev` cron trigger or a temporary test harness) with seeded due plants for 2 users ⇒ each gets a digest naming only their own plants
- [ ] A snoozed plant and a not-yet-due plant are absent from the digest
- [ ] Re-running the same tick the same day re-sends the same content (confirms idempotent-by-query behavior; acceptable per decision)

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: Care API endpoints

### Overview

Add the user-facing mutation endpoints: mark-watered (single + bulk), undo, and snooze — self-guarded, RLS-scoped, following the existing `/api/plants` conventions.

### Changes Required:

#### 1. Mark-watered endpoint

**File**: `src/pages/api/plants/water.ts` (new)

**Intent**: Mark one or more plants watered in a single call (single = array of one), writing a `care_event` and resetting the interval via the trigger.

**Contract**: `POST` accepting `{ plantIds: string[] }`. Self-guard via `requireUser`; validate each id with `UUID_RE`; reject empty/oversized arrays (cap, e.g., ≤200). For each plant (RLS scopes to the owner; the FK-guard trigger rejects cross-user ids): insert a `care_events` row (`kind: 'water'`, `done_at: now()`) and `update plants set last_watered_at = now(), water_snooze_until = null` (the trigger recomputes `next_water_due_at`). Use the session client from `createClient`. Return the per-plant prior `last_watered_at` is **not** needed (undo recomputes from the log). Map `CLIENT_ERROR_CODES` → 400. Return `{ watered: string[] }` (200) or `503` if `supabase` is null.

#### 2. Undo / revert endpoint

**File**: `src/pages/api/plants/water.ts` (same file, second handler) or `src/pages/api/plants/water-undo.ts` (new)

**Intent**: Reverse a just-completed mark-watered for the given plants, restoring the prior due date from the care-event log.

**Contract**: `POST { plantIds: string[] }`. For each plant: delete the most-recent `water` `care_event` (highest `done_at`), then `update plants set last_watered_at = <done_at of the now-most-recent remaining water event, or NULL>` — trigger recomputes `next_water_due_at`. RLS + FK-guards enforce ownership. Idempotent-ish: if there's no water event to remove, no-op for that plant. Returns `{ reverted: string[] }`.

#### 3. Snooze endpoint

**File**: `src/pages/api/plants/snooze.ts` (new)

**Intent**: Defer a plant's reminder by N days without touching the watering interval.

**Contract**: `POST { plantId: string, days: number }`. Validate `days` as a positive integer within a sane bound (e.g., 1-30). `update plants set water_snooze_until = now() + (days || ' days')::interval` for the owned plant. Does not touch interval/last_watered/next_water_due. Returns `{ snoozed_until }` (200).

### Success Criteria:

#### Automated Verification:

- [ ] Endpoint tests (mirroring `src/pages/api/plants/[id].test.ts`): mark-watered inserts a care_event and clears snooze; bulk marks all ids: `npm run test:run`
- [ ] Undo test: reverting restores `last_watered_at` to the prior value (and due date follows)
- [ ] Snooze test: sets `water_snooze_until`, leaves interval/last_watered untouched
- [ ] Auth test: unauthenticated request ⇒ 401; another user's plant id ⇒ rejected (no state change)
- [ ] Lint passes: `npm run lint`

#### Manual Verification:

- [ ] After mark-watered, the plant's `next_water_due_at` advances by its interval (verified via SQL)
- [ ] Undo within seconds restores the original due date; the plant reappears as due
- [ ] Snooze removes the plant from the due set until the snooze date passes

**Implementation Note**: Pause for manual confirmation before Phase 5.

---

## Phase 5: `/today` page + UI

### Overview

Build the in-app today-list (FR-021): a dedicated `/today` page showing due plants across all locations, with mark (single + "mark all watered"), an Undo toast, and a snooze control — linked from the dashboard.

### Changes Required:

#### 1. `/today` page (server-rendered shell)

**File**: `src/pages/today.astro` (new)

**Intent**: Land the user on their aggregated care list, server-rendering the due plants via the session client and hydrating a React island for the interactions.

**Contract**: Uses `createClient(Astro.request.headers, Astro.cookies)`; queries due-and-not-snoozed plants (`next_water_due_at <= now AND (water_snooze_until IS NULL OR water_snooze_until <= now)`) joined to location name, ordered by `next_water_due_at`. Renders within `Layout.astro` with a clean empty state ("All caught up — nothing needs water today"). Passes the due-plant list to the island as a prop. Matches the cosmic/Tailwind styling used in `dashboard.astro`.

#### 2. Today-list React island

**File**: `src/components/today/TodayList.tsx` (new), plus a small hook in `src/components/hooks/` if needed

**Intent**: Interactive list with per-plant mark/snooze, a "Mark all watered" action, and a ~5s Undo toast.

**Contract**: Receives `plants: DuePlant[]`. "Mark watered" (per plant) and "Mark all watered" call `POST /api/plants/water` with the relevant ids, optimistically remove rows, and show an Undo toast (~5s) wired to `POST` the undo endpoint; on toast expiry the action stands. Snooze offers a small day choice (e.g., 1/3/7) calling `POST /api/plants/snooze`. Compiler-safe (no prop/state mutation, rules-of-hooks) per the repo's `react-compiler` error rule. Use `cn()` for classes, `lucide-react` icons, existing `shadcn/ui` primitives. A toast primitive may need adding via `npx shadcn@latest add sonner` (or reuse an existing one if present).

#### 3. Dashboard link + protected route

**File**: `src/pages/dashboard.astro`, `src/middleware.ts`

**Intent**: Make `/today` reachable and protected.

**Contract**: Add a link/button to `/today` in the dashboard header area. Add `/today` to the `PROTECTED_ROUTES` array in `src/middleware.ts` so unauthenticated access redirects to sign-in.

### Success Criteria:

#### Automated Verification:

- [ ] Lint + type-check pass (including `react-compiler` rule): `npx astro sync && npm run lint`
- [ ] Build succeeds: `npm run build`
- [ ] Any component-level unit tests pass: `npm run test:run`

#### Manual Verification:

- [ ] `/today` lists exactly the due plants across multiple locations; empty state shows when none are due
- [ ] "Mark watered" and "Mark all watered" remove plants immediately; the Undo toast restores them within the window
- [ ] Snooze removes a plant and it does not reappear until the snooze lapses
- [ ] Unauthenticated visit to `/today` redirects to `/auth/signin`
- [ ] Responsive on mobile Safari/Chrome widths (per NFR)

**Implementation Note**: After automated verification passes, pause for final manual confirmation. This phase closes the loop end-to-end (cron digest → `/today` → mark-done).

---

## Testing Strategy

### Unit Tests:

- Due-plant selection filter (excludes snoozed, excludes not-yet-due, includes overdue) — date math is deterministic (TZ pinned UTC in `vitest.setup.ts`).
- `composeDigest` output names each plant + location and pluralizes correctly.
- Mark-watered resets interval + clears snooze; undo restores prior `last_watered_at`; snooze sets only `water_snooze_until`.
- Auth/isolation: 401 unauthenticated, cross-user plant id rejected.

### Integration / Fault Tests:

- `sendDigest` failure for one user does not abort the others (`*.fault.test.ts` pattern, mirroring `src/lib/ai/suggest.fault.test.ts`).
- Zero-due-plants ⇒ no email.

### Manual Testing Steps:

1. Seed two users with due/snoozed/not-due plants; trigger the scheduled handler; confirm each user's digest names only their own due plants.
2. On `/today`: mark a single plant, undo it; mark all watered; snooze a plant 3 days and confirm it disappears.
3. Confirm `/today` redirects when logged out.

## Performance Considerations

Target scale is small (PRD: small users, low qps). The cron scan uses the existing `plants_user_next_water_due_idx` partial index — a single indexed range scan. The digest groups in memory; fine at this scale. No new hotspots.

## Migration Notes

One forward-only migration (Phase 1) adds the trigger and backfills existing plants. No destructive changes; re-runnable on a fresh DB via `npx supabase db reset`. The backfill `UPDATE` touches only rows with a non-NULL interval.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-04, lines 147-159)
- PRD: US-02, US-03, FR-018, FR-020, FR-021, FR-022; Open Questions 1 & 3 (defaults applied)
- Infrastructure (email): `context/foundation/infrastructure.md:72,93`
- Core schema (columns + index): `supabase/migrations/20260608171954_core_domain_schema.sql:45-87`
- Cron skeleton: `src/worker.ts`, `src/lib/reminders/scheduled.ts`
- API conventions: `src/lib/api.ts`, `src/pages/api/plants/index.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Due-date data foundation

#### Automated

- [x] 1.1 Migration applies cleanly on a fresh DB (`npx supabase db reset`) — f754e37
- [x] 1.2 Type generation + lint pass (`npx astro sync && npm run lint`) — f754e37
- [x] 1.3 Existing tests pass (`npm run test:run`) — f754e37

#### Manual

- [x] 1.4 Insert with interval, no last_watered ⇒ due ≈ now + interval — f754e37
- [x] 1.5 Pre-existing plant with interval has non-NULL due after backfill — f754e37
- [x] 1.6 Updating last_watered shifts due; NULL interval clears it — f754e37

### Phase 2: Email + service-role infrastructure

#### Automated

- [x] 2.1 `composeDigest` unit test names each plant + location — b017d09
- [x] 2.2 Lint + type-check pass with new env fields — b017d09
- [x] 2.3 Build succeeds with all new secrets unset (graceful degrade) — b017d09
- [x] 2.4 ESLint boundary: cross-boundary import of service-client from `src/pages/` fails lint — b017d09

#### Manual

- [x] 2.5 `sendDigest` to a real inbox delivers a readable digest — b017d09
- [x] 2.6 Service-role client reads a row the anon client cannot — b017d09

### Phase 3: Cron digest logic

#### Automated

- [x] 3.1 Due-plant selection excludes snoozed + not-yet-due
- [x] 3.2 Fault test: one user's send failure doesn't abort others
- [x] 3.3 Zero due plants ⇒ no send for that user
- [x] 3.4 Heartbeat-log expectation still satisfied (or updated)
- [x] 3.5 Lint passes

#### Manual

- [x] 3.6 Two seeded users each get a digest of only their own due plants
- [x] 3.7 Snoozed + not-yet-due plants absent from digest
- [x] 3.8 Same-day re-run re-sends same content (idempotent-by-query)

### Phase 4: Care API endpoints

#### Automated

- [ ] 4.1 Mark-watered inserts care_event + clears snooze; bulk marks all ids
- [ ] 4.2 Undo restores prior last_watered_at (due follows)
- [ ] 4.3 Snooze sets water_snooze_until, leaves interval/last_watered untouched
- [ ] 4.4 401 unauthenticated; cross-user id rejected with no state change
- [ ] 4.5 Lint passes

#### Manual

- [ ] 4.6 After mark-watered, due advances by interval
- [ ] 4.7 Undo restores original due date; plant reappears
- [ ] 4.8 Snooze removes plant from due set until snooze passes

### Phase 5: `/today` page + UI

#### Automated

- [ ] 5.1 Lint + type-check pass (incl. react-compiler rule)
- [ ] 5.2 Build succeeds
- [ ] 5.3 Component unit tests pass

#### Manual

- [ ] 5.4 `/today` lists exactly the due plants across locations; empty state works
- [ ] 5.5 Mark / Mark-all remove plants immediately; Undo restores within window
- [ ] 5.6 Snooze removes plant until snooze lapses
- [ ] 5.7 Unauthenticated `/today` redirects to sign-in
- [ ] 5.8 Responsive on mobile widths
