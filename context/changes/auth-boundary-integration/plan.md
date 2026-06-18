# Isolation & auth-boundary integration tests (test-plan Phase 2) — Implementation Plan

## Overview

Stand up the project's first **integration** test suite — an opt-in, Docker-dependent
suite (separate Vitest config, `npm run test:integration`) that runs against a locally
running Supabase with **two real authenticated sessions**, and against the **real SSR app**
for the HTTP boundary. It locks in three protections that research confirmed already hold:

- **Risk #2** — cross-user data isolation (RLS) across `locations` / `plants` / `care_events`.
- **Risk #3** — endpoint & route auth gating after the magic-link conversion.
- **Risk #4** — signed-upload / storage path scoping (IDOR).

The goal is to **lock in** isolation and gating that already pass — not to chase an open
hole (research found zero true defects). The tests must therefore assert the _denied_ /
_zero-rows_ shapes, not the happy path.

## Current State Analysis

- **Only one test exists** — `src/lib/ai/suggest.test.ts` (Phase 1, Risk #5), a pure unit
  suite. Conventions to mirror: named imports from `"vitest"` (no `vitest/globals`), import
  under test via the `@` alias, `it.each` invariant tables, **oracle-from-sources**.
- **The unit runner is intentionally minimal** — `vitest.config.ts` is `environment: "node"`,
  `setupFiles: ["./vitest.setup.ts"]` (TZ=UTC only), `@`→`./src` alias. Its header comment
  notes it was kept minimal because Phase 1 units are pure / import-type-only; **Phase 2 is
  the gap it explicitly does not cover.**
- **No integration harness, no MSW, no admin/service helper, no CI test wiring.**
- **The protections are present and correct** (research):
  - Risk #2: every domain table has a complete per-operation policy set
    (`SELECT`/`INSERT`/`UPDATE`/`DELETE`), all `to authenticated`, predicate
    `(select auth.uid()) = user_id`. Child-scoping (a cross-user `location_id`/`plant_id`)
    is closed by `SECURITY INVOKER` BEFORE-triggers → `check_violation` (SQLSTATE `23514`),
    **not** by RLS. **No service-role / RLS-bypass client exists anywhere in `src/`.**
  - Risk #3: `/api/**` is **outside** `PROTECTED_ROUTES = ["/dashboard", "/locations"]`, so
    each endpoint self-guards. No-session responses are **heterogeneous**: JSON endpoints →
    **401**, the form-POST `/api/locations` → **302**, protected pages → **302**.
    `/api/plants/suggest` returns **401 before any AI call**.
  - Risk #4: the upload object key is **server-derived** (`${user.id}/${plantId}/${file}`);
    `storage.objects` RLS re-pins the first folder segment to `auth.uid()` with `WITH CHECK`
    on writes; the persist endpoint independently rejects a `photoPath` not under the
    caller's `${user.id}/`.
- **The harness cannot reuse `src/lib/supabase.ts`** — it reads `astro:env/server`, which does
  not exist in a Node/Vitest process. It needs its own clients.
- **Local auth is favorable** — `enable_confirmations = false` (autoconfirm ON), so a user
  minted via `auth.admin.createUser({ email_confirm: true })` is immediately usable. Local
  auth rate limits apply (`sign_in_sign_ups = 30`/5 min) — use unique timestamp email
  suffixes when seeding.
- **The two stale CLAUDE.md statements research flagged are already fixed** in the current
  `CLAUDE.md` (core domain is built; auth is magic-link OTP). No doc change is needed.

## Desired End State

A developer with Docker + a started local Supabase can run `npm run test:integration` and
watch a green suite that proves, against the real database / storage / SSR app:

1. A second user's session gets **zero rows / denied** on every operation against the first
   user's data, across all three tables; a cross-user parent attach is rejected with `23514`.
2. Every protected route and every `/api/**` endpoint **rejects a no/invalid session** with
   its correct status (401 vs 302), and the costly suggestion endpoint 401s before spend.
3. A second user **cannot read or write** under the first user's storage `<uid>/` prefix.

`npm test` / `npm run test:run` (the existing unit gate) stays **hermetic and Docker-free** —
it does not pick up the integration files. `test-plan.md` §6.2 / §6.4 cookbook entries are
filled in from what shipped, and §3 Phase 2 status reflects the rollout.

### Key Discoveries

- **No service-role anywhere in app code** — the entire app runs on the JWT-scoped publishable
  client, so the two-session approach **is** the production path
  (`src/lib/supabase.ts:6-25`, research "Service-role audit: clean").
- **The child-scoping gap is closed by triggers, not RLS** — a naive cross-user matrix would
  under-test this. `assert_plant_location_same_user()` / `assert_care_event_plant_same_user()`
  (`supabase/migrations/20260608171954_core_domain_schema.sql:121-157`); surfaces as `23514`
  at the SQL layer and **400 `invalid_request`** over HTTP (`src/pages/api/plants/index.ts:24-25,91-92`).
- **Heterogeneous no-session contract** — a test asserting a uniform 401 across `/api/**`
  false-fails on `/api/locations` (302). Assert per-endpoint
  (`src/lib/api.ts:25-31`; `src/pages/api/locations.ts:10-13`).
- **`/api/plants/suggest` guard runs first** — `requireUser` (`:18-22`) precedes the AI-key
  check and `requestSuggestion(...)` (`:47`). A 401 to an anonymous caller therefore proves
  the AI call was never reached.
- **Storage objects are NOT FK-cascaded** by `auth.admin.deleteUser` — they need explicit
  teardown under `<uid>/...` (research §"Cleanup").
- **`supabase status --output json`** emits `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY` — local
  keys are **not** in `config.toml` and rotate on every `supabase start` / db reset.

## What We're NOT Doing

- **No CI wiring.** The test-plan assigns CI integration of this suite to Phase 4. The suite
  runs locally only for now (`npm run test:integration`).
- **No pgTAP / `supabase test db` SQL-level suite.** Risk #2 is satisfied in Vitest via two
  real sessions (matches §4 stack + research). No second SQL-layer tool.
- **No AI-outage / fault-injection coverage (Risk #1).** That is Phase 3.
- **No unconfigured-Supabase degradation path** (no-env 401/302/503). The integration suite
  needs a configured local Supabase to run; that path is not exercisable here.
- **No authed-positive HTTP case in the auth-boundary suite.** Authenticated access is already
  proven by the Phase 2/3 sessioned clients; reproducing `@supabase/ssr`'s chunked auth-cookie
  format over HTTP is disproportionate. Phase 4 asserts the **deny** contract only.
- **No standalone unit test of the upload endpoint's input validators** (UUID regex,
  `sanitizeFilename`, `photoPath` `startsWith`). These are defense-in-depth backstopped by
  Storage RLS, which Phase 3 tests directly. (Could be a future unit change if the helpers are
  extracted.)
- **No edit to `src/`** beyond what tests require. No production behavior changes; this is a
  test-only change.
- **No CLAUDE.md edit** — the previously-stale statements are already corrected.

## Implementation Approach

Three seams, chosen per risk (research §"Pick the seam"):

- **Risks #2 & #4** → driven **directly against local Supabase** with two anon-key sessioned
  clients (the production path). Cheapest real signal; no SSR server needed.
- **Risk #3** → driven against the **real running SSR app** with `fetch` and **no cookie** —
  the only seam that validates the _configured_ boundary (that `/api/**` sits outside
  `PROTECTED_ROUTES`, exercised through real middleware + real handler).

Session lifecycle uses the **local service-role key for seed/teardown only**
(`admin.createUser` + cascade `admin.deleteUser`); every **assertion** runs through an
**anon-key sessioned client**, so the RLS path under test is never bypassed. Users are minted
**fresh and unique per test file** (timestamp-suffixed emails) and torn down in `afterAll`
(FK cascade + explicit storage-object deletion), keeping files parallel-safe and re-runnable.

The suite lives under `tests/integration/` behind its own `vitest.integration.config.ts`
(`include: tests/integration/**/*.integration.test.ts`, `globalSetup` for the local-Supabase
preflight). The existing `vitest.config.ts` gains an `exclude` for `tests/integration/**` so
the unit gate stays hermetic.

## Critical Implementation Details

- **Unit-config exclusion is load-bearing.** Vitest's default `include` matches
  `tests/integration/**/*.integration.test.ts`, so `vitest.config.ts` MUST add
  `test.exclude: [...configDefaults.exclude, "tests/integration/**"]` or `npm test` will try
  to run the Docker-dependent suite. This is the one change to an existing config that, if
  missed, breaks the hermetic unit gate.
- **Local keys must be captured at runtime, never committed.** `globalSetup` shells
  `supabase status --output json`, parses `API_URL` / `ANON_KEY` / `SERVICE_ROLE_KEY`, and
  exposes them to the suite (e.g. via `process.env.SUPABASE_TEST_*`). They rotate on every
  `supabase start` / db reset, so a pinned file would go stale.
- **The SSR-server lifecycle is scoped to the Risk #3 file**, not `globalSetup` — only that
  file needs it, and #2/#4 should not pay the boot cost. The server is spawned with the
  captured local `API_URL` + `ANON_KEY` wired as `SUPABASE_URL` / `SUPABASE_KEY` so middleware
  `createClient` is non-null and `getUser()` runs real validation (required for the
  _invalid_-session case to be meaningful, not just the _no_-session case). Astro's Cloudflare
  dev runtime reads `astro:env/server`; confirm the spawned `astro dev` resolves these (env on
  the child process and/or a temp `.dev.vars`).
- **`fetch` must use `redirect: "manual"`** in the Risk #3 suite, or a 302 to `/auth/signin`
  is silently followed to a 200 and the assertion is meaningless.
- **Storage cleanup is a distinct teardown step.** `admin.deleteUser` cascades the FK rows but
  leaves `<uid>/...` objects; the teardown helper must `remove()` them explicitly (or the
  bucket accumulates orphans across runs).

---

## Phase 1: Integration harness foundation

### Overview

Stand up the separate integration runner, the local-Supabase preflight, the two-client
session fixtures, and parallel-safe cleanup — everything Phases 2–4 depend on. Prove it with
one smoke test that mints two sessions and tears them down.

### Changes Required

#### 1. Separate integration Vitest config

**File**: `vitest.integration.config.ts` (new)

**Intent**: A Node-environment runner scoped to the integration files, with a `globalSetup`
preflight, so the Docker-dependent suite is opt-in and isolated from the unit suite.

**Contract**: `defineConfig` with `test.environment: "node"`,
`test.include: ["tests/integration/**/*.integration.test.ts"]`,
`test.globalSetup: ["./tests/integration/globalSetup.ts"]`, and the `@`→`./src`
`resolve.alias` mirrored from `vitest.config.ts`. Consider `test.fileParallelism`/pool
defaults; per-file fresh users make parallel files safe.

#### 2. Keep the unit gate hermetic

**File**: `vitest.config.ts`

**Intent**: Exclude the integration directory so `npm test` / `test:run` never tries to run
the Docker-dependent suite.

**Contract**: add `test.exclude: [...configDefaults.exclude, "tests/integration/**"]`
(import `configDefaults` from `"vitest/config"`).

#### 3. `test:integration` script

**File**: `package.json`

**Intent**: A dedicated command that runs only the integration config.

**Contract**: `"test:integration": "vitest run --config vitest.integration.config.ts"`
(one-shot; mirror `test:run` semantics). No new dependencies — `@supabase/supabase-js`,
`supabase` CLI, and Node's `child_process` already cover the harness.

#### 4. Local-Supabase preflight (globalSetup)

**File**: `tests/integration/globalSetup.ts` (new)

**Intent**: Before any test, confirm local Supabase is up and capture its (per-reset) URL and
keys; **fail fast** with an actionable message if it is not.

**Contract**: run `supabase status --output json`; on non-zero exit or parse failure, throw
with "run `npx supabase start` first"; on success, set `process.env.SUPABASE_TEST_URL`,
`SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_SERVICE_ROLE_KEY` from `API_URL` / `ANON_KEY` /
`SERVICE_ROLE_KEY`.

#### 5. Raw Supabase clients

**File**: `tests/integration/helpers/clients.ts` (new)

**Intent**: Build the two client kinds the suite needs directly from `@supabase/supabase-js`,
bypassing `src/lib/supabase.ts` (which needs `astro:env/server`).

**Contract**: `serviceRoleClient()` — service-role key, `auth.autoRefreshToken: false`,
`persistSession: false` (seed/teardown only). `anonClient()` — anon key (RLS-respecting).
`sessionedClient(session)` — anon-key client carrying a user's access token (the assertion
client). All read the `SUPABASE_TEST_*` env from globalSetup.

#### 6. Session fixtures + cleanup

**File**: `tests/integration/helpers/sessions.ts` (new)

**Intent**: Mint fresh unique users for a test file and tear them down completely, including
non-cascaded storage objects.

**Contract**:

- `createTestUser()` → `{ id, email, password, session, client }`: service-role
  `admin.createUser({ email, password, email_confirm: true })` with a timestamp-unique email,
  then `signInWithPassword` (anon client) to obtain a real session → returns a
  `sessionedClient`.
- `deleteTestUser(user)`: `storage.from("plant-photos").remove([...])` for every object under
  `${user.id}/` (list then remove), then `admin.deleteUser(user.id)` (cascades FK rows).
- Used from each suite's `beforeAll` / `afterAll`.

#### 7. Foundation smoke test

**File**: `tests/integration/smoke.integration.test.ts` (new)

**Intent**: Prove the fixtures work end-to-end before the risk suites rely on them.

**Contract**: in `beforeAll` mint two users; assert each `sessionedClient` resolves its own
`auth.getUser()` to its own id and the two ids differ; `afterAll` tears both down.

### Success Criteria

#### Automated Verification

- [ ] Unit gate stays hermetic (no Docker): `npm run test:run` passes and does **not** execute any `tests/integration/**` file
- [ ] Lint passes: `npm run lint`
- [ ] With local Supabase running, the smoke test passes: `npm run test:integration`
- [ ] With local Supabase stopped, `npm run test:integration` fails fast with the "run `npx supabase start`" message (not an opaque connection error)

#### Manual Verification

- [ ] After a smoke run, the `plant-photos` bucket and `auth.users` contain no leftover test users/objects (teardown verified)
- [ ] A second consecutive `npm run test:integration` run is green (re-runnable; no unique-id collisions)

**Implementation Note**: After this phase and all automated verification passes, pause for
human confirmation of the manual checks before proceeding.

---

## Phase 2: Risk #2 — cross-user isolation (RLS)

### Overview

With two sessioned clients from Phase 1, prove user B is denied / sees zero rows on every
operation against user A's `locations` / `plants` / `care_events`, plus the trigger-based
child-scoping guard and the delete-user cascade.

### Changes Required

#### 1. Cross-user isolation suite

**File**: `tests/integration/isolation.integration.test.ts` (new)

**Intent**: Assert the denied / zero-rows shapes (never "no error") across the full
table × operation matrix, then the two non-obvious enforcement layers.

**Contract**:

- `beforeAll`: mint users A and B; A seeds one `location`, one `plant`, one `care_event`
  (via A's sessioned client; `user_id` defaults to `auth.uid()`).
- **Matrix (B against A's rows)** via `it.each` over `{locations, plants, care_events} × {select, insert, update, delete}`:
  - SELECT → **zero rows** (`data` empty, no error).
  - UPDATE / DELETE of A's row id → **zero rows affected** (RLS makes the row invisible; assert count, not error).
  - INSERT targeting A's parent id → rejected (see child-scoping below) or RLS denial.
- **Child-scoping (trigger, SQLSTATE `23514`)**: B inserts a `plant` with `location_id` = A's
  location → error `code === "23514"`; B inserts a `care_event` with `plant_id` = A's plant →
  `code === "23514"`.
- **Anon denial**: an `anonClient` (no session) SELECT on each table → zero rows / denied.
- **Cascade**: after `admin.deleteUser(A)`, a service-role count of A's rows in all three
  tables is `0`.

### Success Criteria

#### Automated Verification

- [ ] All matrix + child-scoping + anon + cascade cases pass: `npm run test:integration`
- [ ] Lint passes: `npm run lint`

#### Manual Verification

- [ ] Spot-check that an isolation assertion **fails** if RLS is conceptually removed (e.g. temporarily reason through a policy drop) — confirms the test asserts denial, not "no error"
- [ ] No leftover A/B users or rows after the run

**Implementation Note**: Pause for human confirmation of the manual checks before proceeding.

---

## Phase 3: Risk #4 — storage path-scoping (IDOR)

### Overview

Prove, with two real sessions, that user B cannot read or write under user A's storage
`<uid>/` prefix, and that the server-derived key + `storage.objects` RLS confine every
operation to the owner.

### Changes Required

#### 1. Storage IDOR suite

**File**: `tests/integration/storage.integration.test.ts` (new)

**Intent**: Drive the `storage.objects` boundary directly (real sessions, not raw SQL — RLS
binds to the session JWT), asserting cross-user denial on every operation.

**Contract**:

- `beforeAll`: mint A and B; A uploads a small object to `${A.id}/<plantId>/photo.png`
  (A's sessioned client) → succeeds.
- B's sessioned client, against A's prefix:
  - upload/`createSignedUploadUrl` under `${A.id}/...` → **denied** (RLS `WITH CHECK`).
  - download/`list`/`createSignedUrl` of A's object → **denied / not found** (RLS `USING`).
- A under its own prefix: upload + read → **succeed** (the owner path works; private bucket).
- `afterAll`: explicit storage teardown (Phase 1 helper) then `deleteTestUser`.

### Success Criteria

#### Automated Verification

- [ ] All cross-user storage cases pass: `npm run test:integration`
- [ ] Lint passes: `npm run lint`

#### Manual Verification

- [ ] Confirm the `plant-photos` bucket is empty of test objects after the run (storage teardown verified for this suite specifically)

**Implementation Note**: Pause for human confirmation of the manual checks before proceeding.

---

## Phase 4: Risk #3 — auth-boundary (real SSR server)

### Overview

Boot the real SSR app with local Supabase wired, then `fetch` each route/endpoint with **no
cookie** and with an **invalid cookie**, asserting the heterogeneous deny contract — including
that the costly suggestion endpoint 401s before any AI call.

### Changes Required

#### 1. SSR-server lifecycle helper

**File**: `tests/integration/helpers/server.ts` (new)

**Intent**: Spawn the app for the duration of the auth-boundary file and expose its base URL;
tear it down after.

**Contract**: `startServer()` spawns `astro dev` (via `child_process`) on a test port with
`SUPABASE_URL` / `SUPABASE_KEY` set to the captured local `API_URL` / `ANON_KEY` (and/or a
temp `.dev.vars` if the Cloudflare dev runtime requires it); polls a known route until ready;
returns `{ baseUrl, stop() }`. `stop()` kills the child cleanly.

#### 2. Auth-boundary suite

**File**: `tests/integration/auth-boundary.integration.test.ts` (new)

**Intent**: Assert each route's no-session and invalid-session behavior with its **correct**
status — encoding the heterogeneous contract, not a uniform 401.

**Contract**: `beforeAll` `startServer()`; `afterAll` `stop()`. All `fetch` use
`redirect: "manual"`. Cases (`it.each` over a route × expected-status table):

- `GET /dashboard`, `/locations/<id>`, `/locations/<id>/plants/new` (no cookie) → **302** with `Location: /auth/signin`.
- `POST /api/plants`, `POST /api/plants/upload-url` (no cookie) → **401 JSON** `{error:"unauthorized"}`.
- `POST /api/plants/suggest` (no cookie) → **401 JSON**, and the body is the unauthorized shape — proving the guard fired before any AI call (not a 200/`ai_unavailable`).
- `POST /api/locations` (no cookie) → **302** → `/auth/signin` (the form-POST outlier).
- `GET /`, `/auth/signin`, `/auth/check-email` (no cookie) → **200** (public).
- **Invalid session**: repeat one JSON endpoint and one protected page with a garbage
  `sb-...-auth-token` cookie → same deny behavior (proves `getUser()` validates, not just
  presence-checks).

### Success Criteria

#### Automated Verification

- [ ] All deny-contract + invalid-session cases pass against the booted server: `npm run test:integration`
- [ ] The suite tears the server down (no orphaned `astro dev` process after the run)
- [ ] Lint passes: `npm run lint`

#### Manual Verification

- [ ] Confirm the server boots with local Supabase wired (the invalid-session case is meaningful — `getUser()` actually runs, vs. an unconfigured no-op)
- [ ] Total `npm run test:integration` time is acceptable for local use (server cold-start noted)

**Implementation Note**: Pause for human confirmation of the manual checks before proceeding.

---

## Phase 5: Test-plan cookbook + status sync

### Overview

Capture what shipped so the test-plan stays the single source of truth for future test
authors, and advance the rollout status.

### Changes Required

#### 1. Fill in the integration cookbook

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.2 and §6.4 "TBD — see §3 Phase 2" stubs with the proven patterns.

**Contract**:

- §6.2 (integration test): the two-session local-Supabase harness — separate config +
  `test:integration`, `globalSetup` preflight, service-role-seed/anon-assert split, fresh
  unique users + storage teardown, assert denied/zero-rows shapes.
- §6.4 (new API endpoint): the auth-gating pattern — boot the SSR app, assert the
  heterogeneous no-session contract (401 JSON vs 302) **before** the authed shape;
  `redirect: "manual"`.

#### 2. Advance rollout status

**File**: `context/foundation/test-plan.md`

**Intent**: Reflect that Phase 2 is implemented.

**Contract**: §3 Phase 2 `Status` → `implementing` / `complete` per the Progress section, and
fill its `Change folder` cell with `context/changes/auth-boundary-integration/`.

### Success Criteria

#### Automated Verification

- [ ] Markdown lint/format passes (lint-staged `prettier --write` on `*.md`): `npm run format`

#### Manual Verification

- [ ] §6.2 / §6.4 read as actionable cookbook entries (a future author could follow them without re-reading this plan)
- [ ] §3 Phase 2 status + change-folder cell are correct

**Implementation Note**: Final phase — confirm the whole suite is green and the docs are
synced.

---

## Testing Strategy

### Integration Tests (this change is the tests)

- **Risk #2**: table × operation denial matrix (zero rows / zero affected / denied), the two
  `23514` child-scoping cases, anon denial, delete-user cascade.
- **Risk #4**: cross-user storage read/write/sign denial under another user's prefix; owner
  path succeeds.
- **Risk #3**: per-route no-session contract (401 vs 302 vs 200), suggestion endpoint 401
  before spend, one invalid-session case.

### What proves protection (not just "no error")

Assert the **denied / zero-rows / correct-status** shape every time — per the test-plan's
Risk-Response anti-patterns ("owner-only happy path", "asserting no error instead of
zero rows / denied", "testing one route and assuming the rest").

### Manual Testing Steps

1. `npx supabase start` (Docker), then `npm run test:integration` → green.
2. `npx supabase stop`, then `npm run test:integration` → fast, actionable failure.
3. `npm run test:run` (unit) → green and untouched by the integration files.
4. Inspect Studio / bucket after a run → no leftover test users or objects.

## Performance Considerations

- The Risk #3 SSR-server cold-start (workerd dev) is the dominant cost; it is scoped to the
  one file that needs it. Per-file fresh users add auth calls — stay under the local
  `sign_in_sign_ups = 30`/5 min rate limit with unique emails and a small user count.

## Migration Notes

None — test-only change, no schema or production-code changes.

## References

- Research: `context/changes/auth-boundary-integration/research.md`
- Test plan: `context/foundation/test-plan.md` §2 (Risk Response), §3 (Phase 2), §4 (stack), §6.1/§6.2/§6.4
- Unit-suite conventions to mirror: `src/lib/ai/suggest.test.ts`, `vitest.config.ts`, `vitest.setup.ts`
- Risk #2: `supabase/migrations/20260608171954_core_domain_schema.sql:121-157,168-215`
- Risk #3: `src/middleware.ts:4,18-22`, `src/lib/api.ts:25-31`, `src/pages/api/plants/suggest.ts:18-22,47`, `src/pages/api/locations.ts:10-13`
- Risk #4: `supabase/migrations/20260608174754_plant_photos_storage.sql:18-68`, `src/pages/api/plants/upload-url.ts:72,77`
- Prior two-user harness template: `context/archive/2026-06-04-domain-schema-with-rls/plan.md:243-260`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Integration harness foundation

#### Automated

- [x] 1.1 Unit gate stays hermetic (no Docker): `npm run test:run` passes and does not execute any `tests/integration/**` file — acfeee0
- [x] 1.2 Lint passes: `npm run lint` — acfeee0
- [x] 1.3 With local Supabase running, the smoke test passes: `npm run test:integration` — acfeee0
- [x] 1.4 With local Supabase stopped, `npm run test:integration` fails fast with the "run `npx supabase start`" message — acfeee0

#### Manual

- [x] 1.5 No leftover test users/objects after a smoke run (teardown verified) — acfeee0
- [x] 1.6 A second consecutive `npm run test:integration` run is green (re-runnable) — acfeee0

### Phase 2: Risk #2 — cross-user isolation (RLS)

#### Automated

- [x] 2.1 All matrix + child-scoping + anon + cascade cases pass: `npm run test:integration` — 55bd9e7
- [x] 2.2 Lint passes: `npm run lint` — 55bd9e7

#### Manual

- [x] 2.3 Spot-check that an isolation assertion asserts denial, not "no error" — 55bd9e7
- [x] 2.4 No leftover A/B users or rows after the run — 55bd9e7

### Phase 3: Risk #4 — storage path-scoping (IDOR)

#### Automated

- [x] 3.1 All cross-user storage cases pass: `npm run test:integration` — 592c230
- [x] 3.2 Lint passes: `npm run lint` — 592c230

#### Manual

- [x] 3.3 `plant-photos` bucket is empty of test objects after the run — 592c230

### Phase 4: Risk #3 — auth-boundary (real SSR server)

#### Automated

- [x] 4.1 All deny-contract + invalid-session cases pass against the booted server: `npm run test:integration` — 0b3026d
- [x] 4.2 The suite tears the server down (no orphaned `astro dev` process) — 0b3026d
- [x] 4.3 Lint passes: `npm run lint` — 0b3026d

#### Manual

- [x] 4.4 Server boots with local Supabase wired (invalid-session case is meaningful) — 0b3026d
- [x] 4.5 Total `npm run test:integration` time is acceptable for local use — 0b3026d

### Phase 5: Test-plan cookbook + status sync

#### Automated

- [x] 5.1 Markdown lint/format passes: `npm run format`

#### Manual

- [ ] 5.2 §6.2 / §6.4 read as actionable cookbook entries
- [ ] 5.3 §3 Phase 2 status + change-folder cell are correct
