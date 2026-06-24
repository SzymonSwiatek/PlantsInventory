# Disable Watering/Winterization Reminders (User Opt-Out) Implementation Plan

## Overview

Give users a way to turn off the daily reminder digest (watering + winterization). Two entry points write the same flag: a signed **one-click unsubscribe link** in every digest email (no login required) and an **in-app settings toggle** (which also serves as the re-enable path). A new `user_preferences` table holds a single `reminders_enabled` boolean per user; the reminder cron skips opted-out users before composing/sending their digest.

## Current State Analysis

Reminders are already built (CLAUDE.md is stale on this point):

- **Cron**: `wrangler.jsonc` declares `"crons": ["0 18 * * *"]`; `src/worker.ts` `scheduled()` calls `runScheduledTick(new Date(), env)` with `noRetry()` and `ctx.waitUntil`.
- **Tick**: `src/lib/reminders/scheduled.ts` builds a service-role client (`createServiceClient`), scans `plants` (watering due, respecting `water_snooze_until`) and the `winterization_due_plants` view, groups rows into a per-user `Map<string, UserBucket>`, looks up each user's email via `supabase.auth.admin.getUserById(userId)`, composes a digest, and sends via Resend. On a `waterError`/`winterError` it logs and `return`s — i.e. the tick already **fails closed** (sends nothing) on a query error.
- **Email**: `src/lib/reminders/email.ts` — `composeDigest()` builds subject/html/text (HTML-escapes all plant/location strings) and `sendDigest()` sends through `resend.emails.send(...)`. Requires `RESEND_API_KEY` + `REMINDER_FROM_EMAIL`, throwing if unset.
- **Env**: secrets are declared in `astro.config.mjs` `env.schema` (`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `REMINDER_FROM_EMAIL` are `server`/`secret`/`optional`; `PUBLIC_SITE_URL` is `server`/`public`/`optional`). The cron reads the same names off the Worker `env` via the `ReminderEnv` interface in `service-client.ts`.
- **Auth/middleware**: `src/middleware.ts` resolves the user and redirects unauthenticated requests for any path in `PROTECTED_ROUTES = ["/dashboard", "/locations", "/today"]` to `/auth/signin`.
- **API route pattern**: `APIRoute` handlers; `createClient(context.request.headers, context.cookies)` for session-scoped work (null-checked, degrade gracefully); JSON body for fetch-driven mutations (`src/pages/api/plants/water.ts`).
- **React mutation islands**: optimistic `fetch` POST + `sonner` toasts (`src/components/today/TodayList.tsx`).
- **RLS convention** (`supabase/migrations/20260608171954_core_domain_schema.sql`): table created, RLS enabled, four per-operation policies `to authenticated` using `(select auth.uid()) = user_id`, and grants to `authenticated, service_role` — all in one migration. `anon` excluded.
- **DB types**: `src/db/database.types.ts` (supabase-generated), imported as `Database` by both the SSR and service clients.

What's missing: any notion of a user preference, an unsubscribe surface, and a `/settings` page.

## Desired End State

- A user with no `user_preferences` row receives reminders exactly as today (default = enabled).
- Each digest email contains a working "Unsubscribe" link and the `List-Unsubscribe` / `List-Unsubscribe-Post` headers; clicking it (or a mail client's built-in one-click unsubscribe) sets `reminders_enabled = false` with no login.
- After the next cron tick, an opted-out user receives **no** digest (neither watering nor winterization).
- A signed-in user can visit `/settings`, see a reminders toggle reflecting their current state, and flip it on or off; turning it back on restores reminders.
- The app still builds and runs with the new secret unset (graceful degrade: no link, no header, route refuses).

Verify: `npm run lint`, `npm run test:run`, `npx astro sync` all pass; manual cron dry-run shows opted-out users skipped; manual settings round-trip toggles the flag.

### Key Discoveries:

- Cron already fails closed on query error (`src/lib/reminders/scheduled.ts:30`, `:43`) — opt-out lookup should follow the same `return`-on-error shape.
- Per-user email lookup (`auth.admin.getUserById`) happens **after** bucket assembly (`scheduled.ts:78`) — filtering opted-out users before that loop avoids wasted admin API calls.
- Web Crypto `crypto.subtle` HMAC is available in workerd for both the cron (signing) and the route (verifying) — no Node `crypto` import needed.
- `composeDigest` already HTML-escapes untrusted fields; the unsubscribe URL is app-generated so it needs no escaping, but build it from `PUBLIC_SITE_URL` consistently with the existing `todayLink`.
- `ReminderEnv` (`service-client.ts`) is the single typed surface the cron sees; new secrets must be added there **and** to `astro.config.mjs` for the route.

## What We're NOT Doing

- No per-type opt-out (separate watering vs winterization switches) — single master `reminders_enabled` flag only.
- No email re-enable link — re-enabling is via `/settings` (login required). The unsubscribe confirmation page just links to settings.
- No general user-settings shell, notification-frequency controls, quiet hours, or digest-time preferences — only the reminders on/off toggle.
- No backfill migration — absence of a row means enabled.
- No change to the cron schedule, the watering/winterization due logic, snooze, or the `/today` view.
- No new email provider work beyond the header + footer additions.

## Implementation Approach

Four phases, each independently testable and landing in dependency order: data model → cron enforcement → email entry point → in-app entry point. The cron filter (Phase 2) is the safety-critical piece and ships right after the table so opt-outs are honored the moment any flag can be written. The two write surfaces (email link, settings toggle) follow.

## Critical Implementation Details

- **Token scheme**: `token = base64url(HMAC-SHA256(message = user_id, key = REMINDER_UNSUBSCRIBE_SECRET))`. The link carries both the user id and the token: `${siteUrl}/api/reminders/unsubscribe?u=<user_id>&t=<token>`. Verify by recomputing the HMAC over `u` and comparing in constant time (`crypto.subtle.verify` does this). Never trust `u` without a matching `t`. This is stateless — no token table, nothing to expire or clean up.
- **One-click (RFC 8058)**: mail clients POST to the `List-Unsubscribe-Post` URL with body `List-Unsubscribe=One-Click` and no cookies. The route's `POST` handler must therefore authenticate **solely** via the `t` token (not the session) and must not require CSRF/session. `GET` (human click) renders a confirmation page; `POST` (one-click) flips silently and returns 200.
- **Astro CSRF / `checkOrigin` (blocks one-click if unaddressed)**: `security.checkOrigin` defaults to `true` for on-demand (`output: "server"`) routes and rejects mutating requests with a form content-type (`application/x-www-form-urlencoded`) and a missing/foreign `Origin` header — which is exactly the RFC 8058 one-click POST shape (it comes from a mail provider's servers, not a browser on our origin). This fails **invisibly**: the GET footer link and all same-origin local tests still pass; only the real-world one-click POST 403s before the handler runs. `checkOrigin` is a **global** setting with no per-route override, so the fix is not a one-liner. **Verify before building** (Phase 3 step below): `curl -X POST` the route with `Content-Type: application/x-www-form-urlencoded` and no `Origin` header against `npm run dev`. If it 403s, set `security: { checkOrigin: false }` in `astro.config.mjs` and add an explicit same-origin assertion to the existing session-mutation routes that were relying on the global guard (water, snooze, winterize, locations); the unsubscribe (token) and preferences (RLS) routes do their own auth and don't need it.
- **Default-enabled semantics**: the cron computes the opted-out set as `select user_id from user_preferences where reminders_enabled = false`. Users with no row are never in this set, so they keep receiving reminders. The settings/unsubscribe writes are `upsert` on `user_id` so the first opt-out inserts the row and later flips update it.

## Phase 1: Data Model — user_preferences table

### Overview

Create the `user_preferences` table with per-user RLS and grants, then regenerate DB types so both clients see it.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_user_preferences.sql`

**Intent**: Add a per-user preferences table holding the reminders on/off flag, with RLS and grants matching the established core-domain convention, so a row is never live without its policies.

**Contract**:
- Table `user_preferences`: `user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade`, `reminders_enabled boolean not null default true`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`.
- `updated_at` maintained by the existing `set_updated_at()` trigger function (reuse — do not redefine): `create trigger user_preferences_set_updated_at before update on user_preferences for each row execute function set_updated_at();`.
- `alter table user_preferences enable row level security;`
- Four policies `to authenticated`, all keyed `(select auth.uid()) = user_id`: `user_preferences_select_own` (select/using), `user_preferences_insert_own` (insert/with check), `user_preferences_update_own` (update/using+with check), `user_preferences_delete_own` (delete/using). (Delete included for convention symmetry even though the app never deletes.)
- `grant select, insert, update, delete on table user_preferences to authenticated, service_role;` — `anon` excluded.
- No backfill.

#### 2. Regenerated DB types

**File**: `src/db/database.types.ts`

**Intent**: Make `user_preferences` visible to the typed Supabase clients so the cron, the routes, and the settings page type-check.

**Contract**: Add the `user_preferences` entry to `Database["public"]["Tables"]` (Row/Insert/Update) matching the migration columns. Prefer regenerating via the supabase CLI against a local stack (`npx supabase start` then `supabase gen types typescript --local > src/db/database.types.ts`); if a local stack is unavailable, hand-edit the file to add the table following the shape of the existing `plants`/`locations` entries.

### Success Criteria:

#### Automated Verification:

- [ ] Migration applies cleanly: `npx supabase db reset` (or `supabase migration up`)
- [ ] Type checking / sync passes: `npx astro sync`
- [ ] Linting passes: `npm run lint`
- [ ] Existing tests still pass: `npm run test:run`

#### Manual Verification:

- [ ] In Supabase Studio (or psql), a signed-in user can `select`/`upsert` only their own `user_preferences` row; another user's row is invisible (RLS sanity check)
- [ ] A brand-new user has no `user_preferences` row (default-by-absence confirmed)

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Cron Opt-Out Filter

### Overview

Teach `runScheduledTick` to skip users who have opted out, fetched once per tick, before the per-user email lookup/send loop. A failed preferences query skips the whole tick (consistent with the existing water/winter error handling).

### Changes Required:

#### 1. Opt-out lookup + filter

**File**: `src/lib/reminders/scheduled.ts`

**Intent**: After assembling the per-user bucket map (or before iterating it to send), query the set of opted-out user IDs and skip them, so opted-out users get no email and incur no `auth.admin.getUserById` call.

**Contract**:
- New query after the water/winter scans: `supabase.from("user_preferences").select("user_id").eq("reminders_enabled", false)`. On error: `console.error({ event: "scheduled.query_error", query: "preferences", err })` and `return` (skip the tick — fail closed, matching existing behavior).
- Build `const optedOut = new Set(prefRows.map(r => r.user_id))`.
- In the send loop (`for (const [userId, bucket] of byUser)`), `if (optedOut.has(userId)) continue;` before the email lookup.
- Extend the `scheduled.summary` log with an `opted_out` count for observability.

### Success Criteria:

#### Automated Verification:

- [ ] Linting passes: `npm run lint`
- [ ] `scheduled.test.ts` passes including a new case: a user with due plants but `reminders_enabled = false` receives no email (`sendDigest` not called for them), while a user with no preferences row still receives one
- [ ] `scheduled.fault.test.ts` passes including a new case: a failing `user_preferences` query causes the tick to send nothing
- [ ] Full suite passes: `npm run test:run`

#### Manual Verification:

- [ ] Local cron dry-run (or invoking `runScheduledTick` against seeded data) confirms an opted-out user is skipped and the summary log shows the `opted_out` count

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Email Unsubscribe Link

### Overview

Add a stateless HMAC token utility, surface an unsubscribe link + `List-Unsubscribe` headers in the digest (degrading when the secret is unset), and add the unsubscribe API route handling both human GET and one-click POST.

### Changes Required:

#### 1. Token utility

**File**: `src/lib/reminders/unsubscribe-token.ts`

**Intent**: Sign and verify a per-user unsubscribe token with Web Crypto HMAC-SHA256, usable from both the cron (sign) and the route (verify).

**Contract**:
- `signUnsubscribeToken(userId: string, secret: string): Promise<string>` → base64url of `HMAC-SHA256(userId, secret)`.
- `verifyUnsubscribeToken(userId: string, token: string, secret: string): Promise<boolean>` → constant-time verification via `crypto.subtle.verify`.
- Uses `crypto.subtle.importKey("raw", ...)` + `sign`/`verify`; no Node `crypto`. Snippet (token contract other code depends on):
  ```ts
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
  ```

#### 2. Env additions

**Files**: `astro.config.mjs`, `src/lib/reminders/service-client.ts`

**Intent**: Declare the new signing secret for both the route (astro:env) and the cron (Worker env).

**Contract**:
- `astro.config.mjs` `env.schema`: add `REMINDER_UNSUBSCRIBE_SECRET: envField.string({ context: "server", access: "secret", optional: true })`.
- `service-client.ts` `ReminderEnv`: add `REMINDER_UNSUBSCRIBE_SECRET: string | undefined;`.
- Document the new var in `.env.example` (and note `.dev.vars` for the local Worker runtime).

#### 3. Digest link + headers

**File**: `src/lib/reminders/email.ts`

**Intent**: Add a per-recipient unsubscribe link to the digest footer (html + text) and set the `List-Unsubscribe` / `List-Unsubscribe-Post` headers; degrade to no-link/no-header when the secret is unset.

**Contract**:
- `composeDigest` (or `sendDigest`) gains the unsubscribe URL. Cleanest: compute the URL in `scheduled.ts` (it has `userId`, `siteUrl`, and `env.REMINDER_UNSUBSCRIBE_SECRET`), pass it into `composeDigest`/`sendDigest` as an optional `unsubscribeUrl?: string`. When present, append a footer line ("Unsubscribe from these reminders: <url>" / `<a>` in html) and pass headers to Resend; when absent (secret unset, or no `siteUrl`), omit both.
- `sendDigest` passes `headers: { "List-Unsubscribe": "<url>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }` to `resend.emails.send` only when `unsubscribeUrl` is set. The `List-Unsubscribe` value must be the POST endpoint wrapped in angle brackets.
- `scheduled.ts`: when `env.REMINDER_UNSUBSCRIBE_SECRET` and `siteUrl` are set, `signUnsubscribeToken(userId, secret)` and build `${siteUrl}/api/reminders/unsubscribe?u=${userId}&t=${token}`; otherwise pass `undefined`.

#### 4. Unsubscribe route

**File**: `src/pages/api/reminders/unsubscribe.ts`

**Intent**: Flip `reminders_enabled = false` for the token-identified user without requiring a login; serve a confirmation page for human GETs and a silent 200 for one-click POSTs.

**Contract**:
- Reads `REMINDER_UNSUBSCRIBE_SECRET` + `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` via `astro:env/server`. If the secret is unset → respond `404`/`400` (degrade; no unsubscribe path when unconfigured).
- Parse `u` and `t` from the query (POST also accepts them from the query per the link). `verifyUnsubscribeToken(u, t, secret)`; on failure → `400`.
- Build a service-role client (reuse `createServiceClient` shape or `createClient` with the service key) and `upsert({ user_id: u, reminders_enabled: false })` on conflict `user_id`.
- `GET` → return a minimal HTML confirmation page ("You've been unsubscribed from plant reminders") with a link to `/settings` to manage/re-enable.
- `POST` → return `200` (empty/JSON) for RFC 8058 one-click; no session, no CSRF.
- Idempotent: a repeat unsubscribe is a no-op success.

#### 5. CSRF / `checkOrigin` handling (do this FIRST in Phase 3)

**Files**: `astro.config.mjs` (conditional), existing session-mutation routes (conditional)

**Intent**: Ensure Astro's default `checkOrigin` guard does not silently 403 the RFC 8058 one-click POST, without weakening CSRF protection on the existing mutation routes.

**Contract**:
- Before writing the route, verify behavior: with `npm run dev` running, `curl -X POST 'http://localhost:4321/api/reminders/unsubscribe?u=<id>&t=<token>' -H 'Content-Type: application/x-www-form-urlencoded' --data 'List-Unsubscribe=One-Click'` (no `Origin` header). A `403` confirms `checkOrigin` blocks it.
- If blocked: set `security: { checkOrigin: false }` in `astro.config.mjs`, and add an explicit same-origin check (compare `Origin` host to the request host; reject mismatch) to the existing session-mutation routes that relied on the global guard — `src/pages/api/plants/{water,snooze,winterize,water-undo,winterize-undo}.ts`, `src/pages/api/locations.ts`, `src/pages/api/locations/[id].ts`. The new unsubscribe route (token-authed) and `/api/preferences` (RLS-authed) intentionally skip this.
- If the curl shows the POST is **not** blocked (checkOrigin doesn't fire on this endpoint in Astro 6.3), no config change is needed — record the result and proceed.

### Success Criteria:

#### Automated Verification:

- [ ] Linting passes: `npm run lint`
- [ ] `astro sync` passes (env schema change): `npx astro sync`
- [ ] One-click POST is not 403'd by CSRF: `curl -X POST` with form content-type and no `Origin` reaches the handler (verified manually; if a config change was needed, existing mutation routes still reject cross-origin POSTs in their tests)
- [ ] New `unsubscribe-token.test.ts`: a token signed by `signUnsubscribeToken` verifies true; a tampered token/user verifies false
- [ ] New `email.test.ts` cases: digest includes the footer link + `List-Unsubscribe` headers when `unsubscribeUrl` is provided, and omits both when it is not
- [ ] New route test (`unsubscribe.test.ts`): valid token GET → 200 confirmation HTML + row flipped to `false`; valid token POST → 200 + row flipped; bad token → 400; secret unset → 404/400
- [ ] Full suite passes: `npm run test:run`

#### Manual Verification:

- [ ] A real (or Resend test-mode) digest email shows the unsubscribe link and the mail client surfaces a one-click unsubscribe affordance
- [ ] Clicking the link lands on the confirmation page and the user's `reminders_enabled` is now `false`; the next cron tick skips them

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 4.

---

## Phase 4: In-App Settings Toggle

### Overview

Add a protected `/settings` page with a reminders on/off toggle backed by a session-scoped API route. This is the canonical re-enable path.

### Changes Required:

#### 1. Protect the route

**File**: `src/middleware.ts`

**Intent**: Require sign-in for `/settings`.

**Contract**: Add `"/settings"` to `PROTECTED_ROUTES`.

#### 2. Preferences API route

**File**: `src/pages/api/preferences.ts`

**Intent**: Read and write the current user's `reminders_enabled` flag under RLS, driven by the settings island.

**Contract**:
- `POST` handler: `createClient(context.request.headers, context.cookies)`; null-check → `503`/redirect-style error consistent with existing routes. Read `{ remindersEnabled: boolean }` from JSON body.
- `upsert({ user_id: user.id, reminders_enabled })` on conflict `user_id` via the session client (RLS enforces ownership; `user_id` defaults to `auth.uid()` but pass it explicitly to satisfy upsert conflict target). Return `200` JSON `{ remindersEnabled }`.
- (Read path: the `/settings` page loads the current value server-side; a dedicated GET is optional — prefer loading in the page.)

#### 3. Settings page

**File**: `src/pages/settings.astro`

**Intent**: Server-render the current preference and mount the toggle island.

**Contract**: Use `createClient(Astro.request.headers, Astro.cookies)`; query the user's `user_preferences` row; derive `remindersEnabled` (default `true` when no row); render via `Layout.astro` and pass the value into the React toggle. Follow the null-Supabase degrade pattern used by `today.astro`.

#### 4. Toggle island

**File**: `src/components/settings/ReminderToggle.tsx`

**Intent**: Let the user flip reminders on/off with optimistic UI and a toast, matching the existing island conventions.

**Contract**: Props `{ remindersEnabled: boolean }`. Use the shadcn/ui `Switch` (add via `npx shadcn@latest add switch` if absent) + `sonner` toast. On change, optimistically set local state and `fetch("/api/preferences", { method: "POST", body: JSON.stringify({ remindersEnabled }) })`; on failure, revert and toast an error (mirror `TodayList.tsx`). Keep it compiler-safe (no prop mutation).

#### 5. Settings entry point (nav)

**File**: `src/components/Topbar.astro`

**Intent**: Make `/settings` reachable for signed-in users.

**Contract**: Add a "Settings" link in the authenticated nav area (only when `Astro.locals.user` is set), following the existing Topbar link pattern.

### Success Criteria:

#### Automated Verification:

- [ ] Linting passes: `npm run lint`
- [ ] `astro sync` passes: `npx astro sync`
- [ ] New `preferences.test.ts`: authenticated POST upserts the caller's flag and returns it; unauthenticated/unconfigured POST is rejected
- [ ] Full suite passes: `npm run test:run`
- [ ] Production build succeeds: `npm run build`

#### Manual Verification:

- [ ] Visiting `/settings` while signed out redirects to `/auth/signin`
- [ ] Signed in, the toggle reflects current state; turning it off then on round-trips and persists across reload
- [ ] After unsubscribing via email (Phase 3), `/settings` shows reminders off and toggling on restores them; next cron tick emails the user again

**Implementation Note**: After automated verification passes, pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `unsubscribe-token`: sign→verify round-trip; tampered user/token fails; constant-time path exercised.
- `email`: footer link + `List-Unsubscribe` headers present when URL provided, absent otherwise; existing escaping behavior unchanged.
- `scheduled`: opted-out user skipped; no-row user still emailed; `opted_out` count in summary.
- `scheduled.fault`: failing preferences query → tick sends nothing.
- `preferences` route: authed upsert returns flag; unauth/unconfigured rejected.
- `unsubscribe` route: valid GET/POST flips flag; bad token 400; secret unset 404/400; idempotent repeat.

### Integration Tests:

- End-to-end opt-out: write `reminders_enabled = false` (via route), run `runScheduledTick` against seeded due plants, assert the user gets no email and an enabled user does.

### Manual Testing Steps:

1. Seed a user with a due-for-watering plant; run the tick; confirm a digest with an unsubscribe link arrives.
2. Click the unsubscribe link → confirmation page; verify `user_preferences.reminders_enabled = false`.
3. Re-run the tick → no email for that user.
4. Sign in, open `/settings`, toggle reminders back on; re-run the tick → email arrives again.
5. Use a mail client's native "unsubscribe" (one-click POST) and confirm it flips the flag.

## Performance Considerations

The opt-out lookup is a single indexed primary-key-table scan per tick (small table, low QPS per the PRD scale) and removes per-user `auth.admin.getUserById` calls for opted-out users — net neutral-to-positive. Web Crypto HMAC is negligible.

## Migration Notes

Additive only — new table, no backfill, no changes to existing tables. Existing users default to enabled by absence of a row. Rollback is dropping the table and reverting the cron filter; opt-out state is lost on rollback (acceptable — it re-enables everyone).

## References

- Change identity: `context/changes/disable-reminders-opt-out/change.md`
- Cron tick: `src/lib/reminders/scheduled.ts`
- Digest: `src/lib/reminders/email.ts`
- Service client / `ReminderEnv`: `src/lib/reminders/service-client.ts`
- RLS + grants convention: `supabase/migrations/20260608171954_core_domain_schema.sql:158`
- API route pattern: `src/pages/api/plants/water.ts`, `src/pages/api/auth/signin.ts`
- Mutation island pattern: `src/components/today/TodayList.tsx`
- Middleware / protected routes: `src/middleware.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data Model — user_preferences table

#### Automated

- [x] 1.1 Migration applies cleanly (`npx supabase db reset`) — 1a6f57c
- [x] 1.2 `npx astro sync` passes — 1a6f57c
- [x] 1.3 `npm run lint` passes — 1a6f57c
- [x] 1.4 `npm run test:run` passes (existing suite) — 1a6f57c

#### Manual

- [x] 1.5 RLS sanity check — user sees only their own row — 1a6f57c
- [x] 1.6 New user has no preferences row (default-by-absence) — 1a6f57c

### Phase 2: Cron Opt-Out Filter

#### Automated

- [x] 2.1 `npm run lint` passes — a264c19
- [x] 2.2 `scheduled.test.ts` skips opted-out user, emails no-row user — a264c19
- [x] 2.3 `scheduled.fault.test.ts` skips tick on preferences-query error — a264c19
- [x] 2.4 `npm run test:run` passes — a264c19

#### Manual

- [x] 2.5 Local tick dry-run skips opted-out user; summary shows `opted_out` — a264c19

### Phase 3: Email Unsubscribe Link

#### Automated

- [x] 3.1 `npm run lint` passes
- [x] 3.2 `npx astro sync` passes
- [x] 3.3 One-click POST not 403'd by CSRF (curl verify; config + per-route origin checks applied if needed)
- [x] 3.4 `unsubscribe-token.test.ts` sign/verify + tamper cases pass
- [x] 3.5 `email.test.ts` link/header presence-and-absence cases pass
- [x] 3.6 `unsubscribe.test.ts` GET/POST/bad-token/secret-unset cases pass
- [x] 3.7 `npm run test:run` passes

#### Manual

- [ ] 3.8 Digest email shows unsubscribe link + native one-click affordance
- [ ] 3.9 Clicking link flips flag; next tick skips the user

### Phase 4: In-App Settings Toggle

#### Automated

- [ ] 4.1 `npm run lint` passes
- [ ] 4.2 `npx astro sync` passes
- [ ] 4.3 `preferences.test.ts` authed upsert + unauth-rejection cases pass
- [ ] 4.4 `npm run test:run` passes
- [ ] 4.5 `npm run build` succeeds

#### Manual

- [ ] 4.6 `/settings` redirects to sign-in when logged out
- [ ] 4.7 Toggle round-trips and persists across reload
- [ ] 4.8 Re-enable after email unsubscribe restores reminders next tick
