---
date: 2026-06-17T21:33:42+02:00
researcher: Szymon Świątek
git_commit: 6c3c963bc42cf90ab6f918bb2e5be9ca3dcdd670
branch: main
repository: PlantsInventory
topic: "Isolation & auth-boundary integration tests (test-plan Phase 2) — where Risks #2/#3/#4 live in the codebase"
tags: [research, codebase, rls, auth-boundary, storage-idor, integration-tests, supabase]
status: complete
last_updated: 2026-06-17
last_updated_by: Szymon Świątek
---

# Research: Isolation & auth-boundary integration tests (test-plan Phase 2)

**Date**: 2026-06-17T21:33:42+02:00
**Researcher**: Szymon Świątek
**Git Commit**: 6c3c963bc42cf90ab6f918bb2e5be9ca3dcdd670
**Branch**: main
**Repository**: PlantsInventory

## Research Question

For Phase 2 of the test plan — *Isolation & auth-boundary integration tests*, covering
Risks **#2** (cross-user data isolation / RLS), **#3** (endpoint & route auth gating
after magic-link conversion), and **#4** (signed-upload path scoping / IDOR) — **where do
these failure scenarios actually live in the live codebase?** Per the test plan's §1
principle #3, this research is the ground truth for *where the failure lives*; the risk map
only documents *what could fail and why*.

## Summary

**The protections are present and, where examined, correct.** The job of the Phase-2
integration suite is to **lock in** isolation and gating that already hold — not to chase an
open hole. Concretely:

- **Risk #2 (RLS):** every domain table (`locations`, `plants`, `care_events`) has a
  complete, discrete per-operation policy set (`SELECT`/`INSERT`/`UPDATE`/`DELETE`), all
  `to authenticated`, predicate `(select auth.uid()) = user_id`. No `FOR ALL` shortcuts;
  every `UPDATE` carries both `USING` and `WITH CHECK`. **No policy gaps.** Two non-obvious
  enforcement layers must be tested explicitly: (a) **anon is denied by default** (no
  `to authenticated` policy applies), and (b) **`SECURITY INVOKER` BEFORE-triggers** close
  the child-scoping gap that RLS alone does *not*. **No service-role / RLS-bypass client
  exists** anywhere in `src/`.
- **Risk #3 (auth gating):** `/api/**` is **outside** the middleware's `PROTECTED_ROUTES`,
  so each endpoint **self-guards**. All four data endpoints do. The costly
  `/api/plants/suggest` returns **401 before any AI call**. The test-relevant subtlety:
  **no-session responses are heterogeneous** — JSON endpoints answer **401**, the form-POST
  `/api/locations` answers **302 redirect**, and protected pages answer **302**.
- **Risk #4 (storage IDOR):** the upload object key is **server-derived** from the session
  (`${user.id}/${plantId}/${sanitizeFilename(filename)}`); client inputs are UUID-validated
  and filename-sanitized; and `storage.objects` RLS independently re-pins the first folder
  segment to `auth.uid()` with `WITH CHECK` on writes. **No IDOR gap.** Defense-in-depth in
  three layers.

**Two CLAUDE.md staleness findings surfaced** (see Architecture Insights): the repo is *not*
"auth scaffold only" (the full domain is built), and auth is *not* "email/password" (it is
magic-link OTP). The Phase-2 plan must account for both.

## Detailed Findings

### Risk #2 — Cross-user data isolation (RLS)

**Migrations in scope** (the brief named two; there are three, and the third carries Storage
RLS that belongs in the isolation matrix):

- `supabase/migrations/20260608171954_core_domain_schema.sql` — `locations`, `plants`,
  `care_events` + RLS + same-user triggers
- `supabase/migrations/20260608174754_plant_photos_storage.sql` — `storage.objects` RLS for
  the `plant-photos` bucket (covered under Risk #4)
- `supabase/migrations/20260608182949_plants_name_check.sql` — adds a CHECK constraint only
  (no RLS impact)

**Policy matrix (domain tables × operation × role).** All `to authenticated`; anon/public
implicitly denied (no policy = no access once RLS is on).

| Table | SELECT | INSERT | UPDATE (USING+CHECK) | DELETE | Role |
|---|---|---|---|---|---|
| `locations` | ✅ `locations_select_own` | ✅ `locations_insert_own` | ✅ `locations_update_own` | ✅ `locations_delete_own` | authenticated |
| `plants` | ✅ `plants_select_own` | ✅ `plants_insert_own` | ✅ `plants_update_own` | ✅ `plants_delete_own` | authenticated |
| `care_events` | ✅ `care_events_select_own` | ✅ `care_events_insert_own` | ✅ `care_events_update_own` | ✅ `care_events_delete_own` | authenticated |

**Gaps found: none.** Predicate everywhere is `(select auth.uid()) = user_id`
(`supabase/migrations/20260608171954_core_domain_schema.sql:173-215`). `auth.uid()` is
wrapped in a scalar subquery as an initplan-cache performance pattern, semantically
equivalent to `auth.uid() = user_id`
(`supabase/migrations/20260608171954_core_domain_schema.sql:164-166`).

- Owner column on each table: `user_id uuid not null default auth.uid() references auth.users (id) on delete cascade`
  (`...:30`, `...:47`, `...:79`).
- RLS enabled in the **same migration** as table creation — a deliberate decision to avoid a
  silent leak window (`...:168-170`, header note `...:5-7`).

**The child-scoping gap is closed by triggers, not RLS.** Because `user_id` defaults to
`auth.uid()`, an `INSERT`'s `WITH CHECK` passes even if `location_id` / `plant_id` points at
**another user's** parent. Two `SECURITY INVOKER` BEFORE-triggers close this — they run as
the caller, so the parent lookup is itself RLS-filtered; a cross-user parent is invisible,
the subquery returns `NULL`, `is distinct from` is true, and the row is rejected with
`errcode = 'check_violation'` (SQLSTATE `23514`):

- `assert_plant_location_same_user()` → trigger `plants_location_same_user`
  (`supabase/migrations/20260608171954_core_domain_schema.sql:121-138`)
- `assert_care_event_plant_same_user()` → trigger `care_events_plant_same_user`
  (`...:140-157`)

At the API layer, `src/pages/api/plants/index.ts:24-25` maps `23514` to HTTP **400
`invalid_request`** — so the cross-user-parent attack surfaces as 400 over HTTP and as
`check_violation` at the PostgREST/SQL layer (two distinct test cases).

**Service-role / RLS-bypass audit: clean.** `src/lib/supabase.ts:6-25` is the **only** client
factory; it builds a `@supabase/ssr` cookie-session client with `SUPABASE_KEY`
(`astro.config.mjs:20`, `access: "secret", optional: true`). The local key is
`sb_publishable_...` — the new-format publishable (anon-equivalent), **RLS-respecting**.
There is **no** `SUPABASE_SERVICE_ROLE_KEY` declared anywhere and **no** privileged-client
construction in `src/`. Every page/endpoint uses the one cookie-bound client
(`src/middleware.ts:7`, `src/pages/api/locations.ts:22`, `src/pages/api/plants/index.ts:65`,
`src/pages/api/plants/upload-url.ts:55`, etc.). Writes never set `user_id` from the client —
they rely on the `default auth.uid()`.

**Implication for tests:** assert isolation through the publishable/anon key with **two real
authenticated sessions** (the real production path); there is no service-role bypass to
separately defend against.

### Risk #3 — Auth boundary (endpoints & routes)

**Middleware** (`src/middleware.ts`):

- `PROTECTED_ROUTES = ["/dashboard", "/locations"]` (`:4`), matched by **`startsWith`**
  (`:18-22`). This covers `/dashboard`, `/locations/[id]`, `/locations/[id]/plants/new` —
  but **not** any `/api/**` path.
- User resolution: `supabase.auth.getUser()` (a real server-side session validation, not a
  local decode) → `context.locals.user` (`:7-16`, typed in `src/env.d.ts:3`).
- Unconfigured Supabase (`createClient` returns `null`): middleware sets
  `context.locals.user = null` and **falls through** to the `PROTECTED_ROUTES` check; its
  only enforcement action is `context.redirect("/auth/signin")` — it never issues a 401.

**Route × guard matrix (behavior on NO session):**

| Route / Endpoint | In `PROTECTED_ROUTES`? | Self-guards? | No-session behavior |
|---|---|---|---|
| `/dashboard` (page) | ✅ `/dashboard` | no | **302 → `/auth/signin`** |
| `/locations/[id]` (page) | ✅ `/locations` prefix | no | **302 → `/auth/signin`** |
| `/locations/[id]/plants/new` (page) | ✅ `/locations` prefix | no | **302 → `/auth/signin`** |
| `POST /api/plants` | ❌ | ✅ `requireUser` | **401 JSON** |
| `POST /api/plants/suggest` (costly) | ❌ | ✅ `requireUser` | **401 JSON — AI call NOT reached** |
| `POST /api/plants/upload-url` | ❌ | ✅ `requireUser` | **401 JSON** |
| `POST /api/locations` | ❌ | ✅ manual `locals.user` check | **302 → `/auth/signin`** |
| `POST /api/auth/signin` | ❌ | n/a (public) | 302 (intended) |
| `POST /api/auth/signout` | ❌ | n/a (public) | 302 → `/` (intended) |
| `GET /auth/confirm` (magic-link) | ❌ | n/a (establishes session) | 302 (intended) |
| `/auth/{signin,signup,check-email}`, `/` | ❌ | n/a (public) | 200 (intended) |

**Self-guard convention:** `requireUser(context)` returns a **401 JSON**
`{error:"unauthorized"}` when `context.locals.user` is falsy (`src/lib/api.ts:25-31`);
endpoints do `const user = requireUser(context); if (user instanceof Response) return user;`.
Used by `src/pages/api/plants/suggest.ts:18-22`, `src/pages/api/plants/index.ts:27-31`,
`src/pages/api/plants/upload-url.ts:26-29`. The form-POST `/api/locations` instead
**redirects** (302) when unauthenticated (`src/pages/api/locations.ts:10-13`).

**Costly endpoint is gated before spend:** in `src/pages/api/plants/suggest.ts`, the
`requireUser` guard (`:18-22`) runs **before** the AI-key check, the body parse, and
`requestSuggestion(...)` (`:47`). An anonymous caller gets a 401 and never reaches the
provider. (Post-auth provider failure returns `{status:"ai_unavailable"}` HTTP 200 — that's
Risk #1 / Phase 3 territory, not Phase 2.)

**Gap analysis: zero true defects.** All four data endpoints are outside `PROTECTED_ROUTES`
*and* self-guard correctly. The findings that matter for test design:

1. **Heterogeneous no-session contract** — JSON endpoints → **401**; `/api/locations` →
   **302**; protected pages → **302**. A test asserting a uniform 401 across `/api/**` will
   false-fail on `/api/locations`. Assert per-endpoint expected behavior.
2. **Guards read `context.locals.user`, populated only by middleware.** An integration test
   that calls a handler directly (bypassing middleware) must set/unset `locals.user`
   itself — endpoints do **not** independently call `supabase.auth.getUser()`.
3. **Unconfigured path:** with no Supabase env, pages redirect, JSON endpoints 401,
   `/api/locations` redirects; the `/api/plants/*` 503 `supabase_unavailable`
   (`index.ts:66-68`, `upload-url.ts:56-58`) is unreachable anonymously because the 401
   fires first.

**Magic-link conversion** (`src/pages/auth/confirm.ts`): session established by
`supabase.auth.verifyOtp({ type, token_hash })` (`:34`); on success the `@supabase/ssr`
client writes session cookies via `setAll` (`src/lib/supabase.ts:18-22`) carried on the
redirect to `next`. **No partial-session window** — cookies are written only on the success
path; missing/expired token → redirect to signin with no cookies. Open-redirect is closed by
`safeNext` (`:12-17`).

### Risk #4 — Signed-upload path scoping (IDOR)

**Verdict: path is server-derived; not exploitable as IDOR.** Defense-in-depth in three
layers.

1. **Server-derived object key** — `src/pages/api/plants/upload-url.ts:72`:
   `const path = ` `` `${user.id}/${plantId}/${sanitizeFilename(filename)}`; `` where
   `user.id` comes from `requireUser(context)` → `context.locals.user` (not the request
   body). The only client-controlled path inputs are:
   - `plantId` (`:71`, `suppliedPlantId ?? crypto.randomUUID()`), shape-validated as a bare
     UUID with an anchored regex before use (`:23`, `:51-53`) → cannot smuggle `/` or `..`.
   - `filename`, reduced to one safe segment by `sanitizeFilename` (`:100-104`): strips
     directory parts, leading dots, whitelists `[A-Za-z0-9._-]`.
2. **`storage.objects` RLS** re-pins the first folder segment to the owner on every
   operation (`supabase/migrations/20260608174754_plant_photos_storage.sql:38-68`):

   | Operation | Policy | Role | Confines to owner prefix? |
   |---|---|---|---|
   | SELECT | `plant_photos_select_own` | authenticated | ✅ (USING) |
   | INSERT | `plant_photos_insert_own` | authenticated | ✅ (WITH CHECK) |
   | UPDATE | `plant_photos_update_own` | authenticated | ✅ (USING + WITH CHECK) |
   | DELETE | `plant_photos_delete_own` | authenticated | ✅ (USING) |
   | any | — | anon | denied (no policy) |

   Predicate (identical across all four), e.g. INSERT (`...:45-50`):
   `bucket_id = 'plant-photos' and (storage.foldername(name))[1] = (select auth.uid())::text`.
   Bucket `plant-photos` is **private** (`public = false`), 10 MiB, png/jpeg/webp
   (`...:18-26`). Because writes carry a `WITH CHECK`, even a forged/stolen upload token
   cannot write outside the caller's `<uid>/` prefix.
3. **Persist-time validation** — `src/pages/api/plants/index.ts:54-58` rejects any
   client-supplied `photoPath` not starting with `${user.id}/` (400 `invalid_photo_path`),
   even though Storage RLS already enforces it.

**What the signed URL grants:** `createSignedUploadUrl(path, { upsert: true })`
(`src/pages/api/plants/upload-url.ts:77`) → a single-use, short-lived PUT to **one specific
object key** (not a prefix); `upsert:true` allows a retake to overwrite the same key. Client
PUTs the raw file directly to the returned `signedUrl`
(`src/components/plants/AddPlantForm.tsx:125-130`), bypassing the Worker — a deliberate
choice because decoding a ~10 MB image would trip the CF free-tier 10 ms CPU limit
(migration header `...:3-6`). Auth guard present on the mint endpoint (`requireUser`,
`:26-29`); location ownership re-checked via RLS before minting (`:60-68`).

**Low-severity, non-IDOR caveat:** the `startsWith` persist check doesn't verify the object
exists, so a client could persist a `photo_path` under its **own** uid pointing at a
non-existent/different object — a self-namespace integrity edge, never a cross-user read.

### Test harness — what exists vs. what Phase 2 needs

**Exists** (Phase 1 / Risk #5):

- `vitest.config.ts` — `environment: "node"`, `setupFiles: ["./vitest.setup.ts"]`, `@`→`./src`
  via `resolve.alias` (Vitest ignores tsconfig `paths`). Header comment notes the config was
  kept minimal because Phase 1 units are pure / import-type-only (**this is the gap Phase 2
  fills**).
- `vitest.setup.ts` — sole job `process.env.TZ = "UTC"`.
- `src/lib/ai/suggest.test.ts` — the only test; conventions to mirror: named imports from
  `"vitest"` (no `vitest/globals`), import under test via `@` alias, `it.each` invariant
  tables, **oracle-from-sources** (not snapshots), characterize-don't-encode known gaps,
  co-located next to the unit.
- Scripts: `npm test` (watch), `npm run test:run` (CI/one-shot). **No CI wiring yet** (that's
  test-plan §3 Phase 4).
- Versions: `vitest ^3.2.6`, `@supabase/supabase-js ^2.99.1`, `@supabase/ssr ^0.10.3`,
  `supabase` CLI `^2.23.4`. No MSW, no admin/service helper, no integration harness.

**Phase 2 must add (none exists today):**

1. **Its own Supabase client(s) for tests.** Production code reaches Supabase only through
   `src/lib/supabase.ts`, which reads `astro:env/server` and returns `null` when unset — in a
   Node/Vitest process there is no `astro:env/server` module and no env, so the harness
   **cannot reuse `src/lib/supabase.ts` as-is**. Either stub `astro:env/server` (Vitest
   `resolve.alias` / `vi.mock`) or build raw `@supabase/supabase-js` clients from the local
   URL + keys directly (simpler).
2. **Local Supabase running** (`npx supabase start`, needs Docker). From
   `supabase/config.toml`: API `http://127.0.0.1:54321`, DB `54322`, Studio `54323`,
   Inbucket `54324`, Storage enabled. Local anon/service keys are **not** in `config.toml` —
   they're emitted by `supabase start` / `supabase status` and must be captured by the
   harness.
3. **Two real authenticated sessions.** Local auth is favorable:
   `enable_confirmations = false` (`config.toml:210`) → **email autoconfirm is ON**, so
   `signUp` / `signInWithOtp({ should_create_user: true })` immediately yields a usable
   session with no email step. `enable_signup = true`, `minimum_password_length = 6`. Mint
   two sessions via either service-role admin `auth.admin.createUser({ email_confirm: true })`
   or anon-key `signUp`/`signInWithPassword`. **Production auth is magic-link OTP only** —
   the harness should mint sessions against local GoTrue directly, not drive the app's auth
   UI. Watch local rate limits (`[auth.rate_limit]`: `sign_in_sign_ups = 30`/5 min,
   `email_sent = 2`/hr) when seeding many users; use unique timestamp email suffixes.
4. **Cleanup.** `auth.admin.deleteUser` cascades a user's rows (FK `on delete cascade`) — but
   **storage objects under `<uid>/...` are NOT FK-cascaded** and need explicit deletion.
5. **Pick the seam** (Phase-2 plan decision):
   - **Risks #2 & #4 (RLS / IDOR)** are cleanest driven **directly against local Supabase**
     with two sessioned clients (matches the archived manual harness).
   - **Risk #3 (auth boundary)** needs **HTTP endpoints** — either boot the SSR app or call
     route handlers with a faked `APIContext` whose `locals.user` / `cookies` / `headers`
     are set (endpoints trust `locals`, populated by middleware).

## Code References

- `supabase/migrations/20260608171954_core_domain_schema.sql:30,47,79` — `user_id default auth.uid()` owner columns
- `supabase/migrations/20260608171954_core_domain_schema.sql:168-215` — RLS enable + per-operation policies (all tables)
- `supabase/migrations/20260608171954_core_domain_schema.sql:121-157` — same-user BEFORE-triggers (child-scoping guard)
- `supabase/migrations/20260608174754_plant_photos_storage.sql:18-68` — private bucket + owner-scoped `storage.objects` policies
- `src/lib/supabase.ts:6-25` — the only Supabase client factory (cookie-session, RLS-respecting); returns `null` unconfigured
- `src/middleware.ts:4,7-22` — `PROTECTED_ROUTES`, `startsWith` matching, `getUser()` resolution
- `src/lib/api.ts:25-31` — `requireUser` (401 JSON guard)
- `src/pages/api/plants/suggest.ts:18-22,47` — auth guard before the AI call
- `src/pages/api/plants/index.ts:24-25,27-31,54-58` — `23514`→400 mapping, self-guard, `photoPath` namespace check
- `src/pages/api/plants/upload-url.ts:23,51-53,72,77,100-104` — UUID validation, server-derived key, signed-upload mint, filename sanitizer
- `src/pages/api/locations.ts:10-13` — redirect (302) self-guard outlier
- `src/pages/auth/confirm.ts:12-17,34` — `safeNext`, `verifyOtp` session establishment
- `src/components/plants/AddPlantForm.tsx:125-130,236` — client mint→PUT flow, `photoPath` post-back
- `vitest.config.ts`, `vitest.setup.ts`, `src/lib/ai/suggest.test.ts` — existing harness + conventions
- `supabase/config.toml:117,170,176,205,210` — local bucket, signup/password/autoconfirm/rate-limit settings

## Architecture Insights

- **Defense-in-depth is the consistent pattern.** Both isolation risks are guarded at ≥2
  independent layers: RLS *and* same-user triggers (#2); server-derived key *and* input
  validation *and* `storage.objects` RLS *and* persist-time namespace check (#4). Tests
  should target each layer's distinct failure, not just the aggregate happy path.
- **`/api/**` is deliberately outside middleware**; JSON endpoints self-guard via
  `requireUser`. The mixed 401-vs-302 contract is intentional (JSON vs native form-POST), not
  a bug — but it shapes the assertions.
- **`auth.uid()` defaults make the cross-user-parent attack possible at the RLS layer** — the
  triggers, not RLS, are what stop it. This is the single most likely place a naive matrix
  would under-test.
- **No service-role anywhere** — the entire app runs on the JWT-scoped publishable client, so
  the integration suite's two-session approach *is* the production path.

### ⚠️ CLAUDE.md staleness (flag for the Phase-2 plan and a doc fix)

1. **"auth scaffold only"** — CLAUDE.md says the plant/location/reminder/AI features are "not
   yet built." **They are built**: 3 migrations, 4 domain endpoints (`locations`,
   `plants/index`, `plants/suggest`, `plants/upload-url`), `src/lib/storage.ts`, and the
   `AddPlantForm` island all exist.
2. **"email/password sign-in"** — CLAUDE.md (and the auth-flow section) describes
   email/password. The code uses **magic-link OTP** (`signInWithOtp` in
   `src/pages/api/auth/signin.ts`); there is **no password sign-in endpoint**. `/auth/signup`
   is a 308 redirect to `/auth/signin`. This matters for the harness: mint sessions against
   local GoTrue directly (autoconfirm-on), don't drive the app's auth UI.

## Historical Context (from prior changes)

- **The cross-user RLS regression test was explicitly deferred to "a later test-plan
  rollout" — i.e. this Phase 2.** `context/archive/2026-06-04-domain-schema-with-rls/plan.md:236`:
  the automated cross-user RLS regression test (pgTAP / `supabase test db`) is out of scope
  there and "owned by a later test-plan rollout change."
- **A prior two-user manual harness template exists** —
  `context/archive/2026-06-04-domain-schema-with-rls/plan.md:243-260`: create two users,
  impersonate via `set local request.jwt.claims`, assert **zero rows returned / zero rows
  affected** on B accessing A's data for every operation, plus CASCADE and same-user-guard
  checks. Its plan-review hardened this into a transaction-scoped-GUC seeding + cross-user
  deny + both same-user-guard checks + CASCADE + "Storage needs a real authenticated session,
  not raw SQL" (`.../reviews/plan-review.md:52`, `.../plan.md:260`).
- **Impl-review confirmed the same-user triggers reject cross-user attaches** even if RLS were
  disabled (`context/archive/2026-06-04-domain-schema-with-rls/reviews/impl-review.md:25`).
- **No service-role in the first-plant flow** —
  `context/archive/2026-06-08-first-plant-from-photo/reviews/impl-review.md:13` and
  `.../research.md:180`: the endpoint inherits all isolation "as long as it uses the
  JWT-scoped client and does not pass an explicit foreign `user_id`."
- **Local autoconfirm is the session-creation lever** —
  `context/archive/2026-05-29-magic-link-auth/plan.md:21`: "Locally `enable_confirmations =
  false` auto-confirms new users."
- **PRD anchors** — `context/foundation/prd.md:170-174`: "unauthenticated visits to any route
  redirect to the sign-in screen"; isolation "enforced at the storage boundary, not the UI."

## Related Research

- `context/changes/ai-parse-unit/research.md` — Phase 1 (Risk #5) research; established the
  oracle-from-sources doctrine and the `it.each` invariant-table pattern Phase 2 inherits.
- `context/archive/2026-06-04-domain-schema-with-rls/research.md` — original RLS design.
- `context/archive/2026-06-08-first-plant-from-photo/research.md` — upload/storage flow design.
- `context/foundation/test-plan.md` §2 (Risk Response Guidance), §3 (Phase 2 row), §6.2/§6.4
  (integration & endpoint cookbook entries this phase will fill in).

## Open Questions

1. **Seam for Risk #3.** Boot the real SSR app (`astro dev` / a fetch against a running
   server) vs. unit-invoke route handlers with a faked `APIContext`? The former tests
   middleware + endpoint together (truer to the boundary); the latter is faster but must
   simulate `locals.user`. Plan decision.
2. **How to source local Supabase keys in the harness** — capture from `supabase status`
   output, a `.env.test`, or `globalSetup`? Needs an `astro:env/server` strategy too (stub vs.
   raw client).
3. **Whether to add a service-role var for test seeding** (`auth.admin.createUser`) vs.
   anon-key `signUp` under autoconfirm. Anon-key path needs no new secret and matches
   production posture; admin path is more deterministic for cleanup. (No service-role var
   exists today — adding one is a test-only concession.)
4. **Storage cleanup** — confirm a teardown that removes `<uid>/...` objects (not FK-cascaded)
   without flaking parallel runs.
5. **Should this change also fix the two stale CLAUDE.md statements** (auth-scaffold-only;
   email/password), or is that a separate docs change? (Recommend a one-line note here +
   separate fix.)
