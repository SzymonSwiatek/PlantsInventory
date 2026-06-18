# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-10

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic check that already catches the
   regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   builder is worried about X, and the failure would surface somewhere in
   `<area>`" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/`
(excluding `node_modules`, build output, `context/`, `src/components/ui/`).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                       | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The AI call hangs / errors / times out and the add-plant flow freezes or returns a 5xx instead of offering manual entry with the uploaded photo preserved                     | High   | High       | interview Q1; PRD Guardrail "catalog survives AI outage"; PRD US-01 AC "offered create-manually fallback, photo preserved"                                                                                                              |
| 2   | A user reads or writes another user's locations, plants, photos, or care-events because a per-operation RLS policy is missing or wrong                                        | High   | Medium     | PRD Guardrail "per-user data isolation"; PRD NFR "isolation enforced at the storage boundary, not the UI"; roadmap F-02 risk "RLS gaps are silent — a missed policy leaks data with no error"                                           |
| 3   | After the magic-link conversion, a domain or AI API endpoint (including the costly suggestion endpoint) or a protected page route is reachable with no / invalid session      | High   | Medium     | PRD Access Control "unauthenticated visits to any route redirect to sign-in"; interview Q4 (test the boundary, not the third party); hot-spot dirs `src/pages/auth/` (9 commits/30d), `src/middleware.ts` churn + magic-link conversion |
| 4   | The signed-upload endpoint issues a URL scoped to a path the caller doesn't own, or trusts a client-supplied path, letting a user write into another user's storage namespace | High   | Medium     | PRD NFR isolation + Guardrail "plant photos persist"; abuse lens (authorization / IDOR); hot-spot dir `src/lib/` (`storage.ts` churn)                                                                                                   |
| 5   | The suggestion normalizer throws, or emits a malformed / garbage care profile, when the provider returns missing, extra, or differently-typed fields                          | Medium | High       | interview Q3; hot-spot dir `src/lib/` (churn)                                                                                                                                                                                           |

**Impact × Likelihood rubric.** Score both axes on a coarse High / Medium /
Low scale so two readers agree on the same row. Do not invent finer
gradations — the goal is ordering, not false precision.

| Rating | Impact                                                          | Likelihood                                               |
| ------ | --------------------------------------------------------------- | -------------------------------------------------------- |
| High   | user loses access, data, or money; failure is publicly visible  | area changes weekly, or we have already been burned here |
| Medium | feature degrades, a workaround exists, only some users affected | touched occasionally, has been a source of bugs          |
| Low    | cosmetic, easily reverted, no data effect                       | stable code, rarely touched                              |

Abuse lens applied: the product has magic-link auth, accepts user input, and
accepts photo uploads, so the map carries authorization/isolation scenarios
(#2, #3, #4). A rate-limit-bypass / AI-cost-abuse risk was considered and
reframed into #3 (authn on the costly suggestion endpoint): no rate limit
exists yet, so "bypass" would test code that isn't there; the real testable
defect is an anonymous caller reaching the expensive endpoint.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                                         | Must challenge                                                                                                                       | Context `/10x-research` must ground                                                                                                                                 | Likely cheapest layer                                                 | Anti-pattern to avoid                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| #1   | On AI error / timeout / hang, the flow surfaces a clean "create manually" path and preserves the uploaded photo — no infinite spinner, no photo-losing 5xx                                                          | "200 on the happy path means the timeout works"; "AI down means the whole flow is down"                                              | where the timeout/abort is enforced (endpoint vs client); how the fallback is triggered; where the photo reference is held when AI fails                            | integration with a stubbed slow / erroring provider (fault injection) | mocking the provider so totally the test only exercises the mock; asserting the success shape instead of the degraded shape |
| #2   | A second user's session gets zero rows / permission-denied on SELECT/INSERT/UPDATE/DELETE of the first user's rows — every table, every operation                                                                   | "logged-in implies scoped"; "RLS enabled implies RLS correct"                                                                        | per-table per-operation policies; how `auth.uid()` binds in the session; whether any service-role path bypasses RLS                                                 | integration against local Supabase with two real user sessions        | owner-only happy path; asserting "no error" instead of "zero rows / denied"                                                 |
| #3   | Every protected route redirects an anonymous request to sign-in, and every domain/AI endpoint rejects no / invalid session (401 or redirect), including the suggestion, plants, locations, and upload-url endpoints | "it's in the protected-routes list so it's covered" (API routes may be outside that list); "magic-link works so the boundary works"  | how middleware computes protected paths; whether API routes sit inside that list; how each endpoint independently checks the session                                | integration hitting each endpoint / route with no session             | testing one route and assuming the rest; authed-happy-path-only                                                             |
| #4   | The endpoint only issues URLs scoped to the caller's own namespace; a cross-user or client-supplied path is rejected                                                                                                | "a signed URL is therefore safe"; "the client sends the right path"                                                                  | how the storage path is derived (server-side from session vs client-supplied); the bucket/storage policy; what the signed URL actually grants                       | integration against Storage with two sessions                         | a fixture that supplies a client-chosen path (mirrors the bug); owner-only happy path                                       |
| #5   | Returns a valid, fully-formed care profile (or a defined default) for missing / extra / wrong-type / null fields, and never throws                                                                                  | the oracle problem — expected values must come from the PRD care-profile contract, not from re-reading the function's current output | the intended output schema (the editable form's fields: species, watering interval, sunlight, winterization cutoff, description); the provider shapes actually seen | unit (the normalizer is pure — confirmed in the S-01 plan)            | snapshot of current output (tautological); testing only the happy shape the provider "usually" returns                      |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                            | Goal (one line)                                                                                                                     | Risks covered | Test types                                                                                       | Status      | Change folder                              |
| --- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------ | ----------- | ------------------------------------------ |
| 1   | Bootstrap + AI-parse unit suite       | Stand up the runner; prove the suggestion normalizer never throws and emits a contract-valid profile across provider shape variants | #5            | unit                                                                                             | complete    | context/changes/ai-parse-unit/             |
| 2   | Isolation & auth-boundary integration | One two-session harness vs local Supabase proves cross-user denial, storage-path scoping, and endpoint auth gating                  | #2, #3, #4    | integration                                                                                      | complete    | context/changes/auth-boundary-integration/ |
| 3   | AI-outage resilience                  | Fault-inject the provider; prove the add-plant flow degrades to manual entry with the photo preserved                               | #1            | integration (fault injection) + thin e2e only if the UI fallback is unreachable from integration | not started | —                                          |
| 4   | Quality-gates wiring                  | Add the test step to CI and lock unit + integration as a required gate                                                              | cross-cutting | gates                                                                                            | not started | —                                          |

**Status vocabulary** (fixed — parser literals):

| Value           | Meaning                                                             |
| --------------- | ------------------------------------------------------------------- |
| `not started`   | No change folder for this rollout phase yet.                        |
| `change opened` | `context/changes/<id>/` exists with `change.md`; research not done. |
| `researched`    | `research.md` exists in the change folder.                          |
| `planned`       | `plan.md` exists with a `## Progress` section.                      |
| `implementing`  | Progress section has at least one `[x]` and at least one `[ ]`.     |
| `complete`      | Progress section is fully `[x]`.                                    |

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer                          | Tool                                                               | Version                                   | Notes                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit + integration             | Vitest                                                             | `^3.2.6` (installed; checked: 2026-06-14) | Vite-native, matches the Astro/Vite 7 toolchain; runs unit suite at `environment: "node"`, `@/*` alias replicated in `vitest.config.ts`, `TZ=UTC` in `vitest.setup.ts` |
| integration env (DB + Storage) | local Supabase (`npx supabase start`)                              | CLI 2.23 (installed)                      | two real user sessions for RLS / IDOR / auth-boundary tests; needs Docker                                                                                              |
| API / provider mocking         | network-edge stub (e.g. MSW) or `vi.mock` at the provider boundary | none yet — see §3 Phase 3                 | mock the AI provider HTTP edge only, never internal modules; pick at plan time                                                                                         |
| e2e                            | Playwright (only if needed)                                        | none yet — see §3 Phase 3                 | introduced only if the AI-outage UI fallback is unreachable from integration                                                                                           |
| accessibility                  | none                                                               | n/a                                       | WCAG floor deferred per PRD Open Question 5; not in this rollout                                                                                                       |
| (optional) AI-native           | considered, deferred — see §7                                      | n/a                                       | not used: the feared bugs are deterministic (parsing, fallback, isolation)                                                                                             |

**Stack grounding tools (current session):**

- Docs: Context7 / framework docs MCP — not available in current session; Cloudflare doc-backed skills (`wrangler`, `workers-best-practices`) available; checked: 2026-06-10
- Search: Exa.ai — not available in current session; `WebSearch` / `WebFetch` available for current-status checks; checked: 2026-06-10
- Runtime/browser: Playwright MCP — not present; Playwright would be installed by §3 Phase 3 only if an e2e layer is warranted; checked: 2026-06-10
- Provider/platform: Cloudflare + Supabase skills available (read-only docs grounding for Workers `scheduled()`, wrangler config, Supabase RLS/Storage); checked: 2026-06-10

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase `<N>`" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                                   | Where                | Required?                                                                 | Catches                                                                            |
| -------------------------------------- | -------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| lint + typecheck                       | local + CI           | required (already wired)                                                  | syntactic / type drift; CLAUDE.md strict type-aware lint                           |
| build (`astro sync` + `npm run build`) | local + CI           | required (already wired)                                                  | SSR / adapter build breakage                                                       |
| unit + integration                     | local + CI           | required after §3 Phase 4 (CI wiring); available locally after Phases 1–3 | logic regressions, RLS / auth-boundary / IDOR gaps, AI-outage fallback             |
| e2e on critical flows                  | CI on PR             | optional — only if §3 Phase 3 introduces it                               | broken add-plant UI fallback path                                                  |
| post-edit hook                         | local (agent loop)   | recommended local                                                         | regressions at edit time (configured in a later Module 3 lesson, not this rollout) |
| visual diff (deterministic)            | CI on PR             | optional — not currently planned                                          | rendering regressions                                                              |
| multimodal visual review               | CI on PR             | optional — not currently planned                                          | visual issues classic diff misses                                                  |
| pre-prod smoke                         | between merge + prod | optional                                                                  | environment-specific failures (e.g. unconfigured Supabase env)                     |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase `<N>`."

### 6.1 Adding a unit test

Pattern proven by `src/lib/ai/suggest.test.ts` (the `normalizeSuggestion`
contract suite, Risk #5). Use it for any pure function whose job is to massage
untrusted input into a typed contract.

- **Runner & env.** Vitest 3.x (§4). For a pure function with a type-only import
  graph, `environment: "node"` is enough — **no `astro:env/server` stub and no
  workerd shim**. (Confirm the unit's import graph is type-only first; if it pulls
  `astro:env`/network at module top, this pattern does not apply.) Import
  `{ describe, it, expect }` explicitly from `"vitest"` (no `vitest/globals`) to
  stay clean under the strict `projectService` lint. Import the unit through the
  `@/*` alias — `vitest.config.ts` replicates it via `resolve.alias`; `tsconfig`
  paths are not consulted at runtime.
- **Oracle from sources, never a snapshot.** Derive every expected value from the
  PRD care-profile contract, the output type (`AiSuggestion`), and the DB CHECK
  constraints — **not** from re-reading the function's current output (that
  mirrors the implementation and passes against its bugs).
- **Invariant tables via `it.each`.** Assert the cross-domain invariants over a
  single hostile-input table so each row catches a distinct regression: (a) never
  throws, (b) exactly the contract keys, (c) each value is its declared type or
  `null`. Read the result through a `Record<string, unknown>` so the runtime
  type checks are meaningful (a type-narrowed read would make them tautological).
  Cover non-object roots (`null`, `undefined`, primitives, arrays).
- **Numeric coercion: property + pinned split.** Assert the DB-derived _property_
  across the input domain (e.g. `out === null || (Number.isInteger(out) && out >= 1)`)
  — this catches the real regression without over-pinning — **then** pin the
  decided coercions as separate named cases (`"7" → 7`, `7.5 → 8`).
- **Date assertions: deterministic + `TZ=UTC` for the engine fallback.** Assert
  only deterministic cases (leading `YYYY-MM-DD` passthrough; ISO datetime
  truncation; `"none"`/garbage → `null`) plus the output-shape invariant
  (`null` or `/^\d{4}-\d{2}-\d{2}$/`, never `"none"`). A `new Date()` fallback for
  non-ISO strings is timezone-dependent — pin the runner TZ to UTC in
  `vitest.setup.ts` and comment such cases as Node+UTC-scoped (not guaranteed on
  workerd).
- **Empty → `null` at the normalizer layer.** Assert `""`/whitespace strings
  become `null` (so the form never pre-fills a blank) and non-empty strings are
  trimmed.
- **Characterize known gaps, don't silently encode them.** A test that pins
  current-but-wrong behavior must be clearly labeled as a characterization of a
  known gap (not the desired contract) and cross-referenced to its §6.6 escalation
  note — see the calendar-invalid date case.

### 6.2 Adding an integration test

Pattern proven by `tests/integration/` (Risk #2 / #3 / #4 suites).
Use it for any test that must run against a real Supabase DB, Storage, or
a running SSR server — where mocks would undercut the signal.

- **Separate runner.** Integration tests live under `tests/integration/` and
  use `vitest.integration.config.ts` (not `vitest.config.ts`). Run them with
  `npm run test:integration`. `vitest.config.ts` excludes `tests/integration/**`
  so `npm run test:run` stays Docker-free. New integration files must match
  `*.integration.test.ts`.
- **Preflight via `globalSetup`.** `tests/integration/globalSetup.ts` shells
  `supabase status --output json`, captures `API_URL` / `ANON_KEY` /
  `SERVICE_ROLE_KEY` into `process.env.SUPABASE_TEST_*`, and fails fast with
  "run `npx supabase start` first" if Supabase is not up. Every test file
  relies on these env vars — never hardcode keys.
- **Two-client split: service-role for seed/teardown, anon-sessioned for
  assertions.** Use `serviceRoleClient()` (from `tests/integration/helpers/clients.ts`)
  only in `beforeAll`/`afterAll` to mint and delete users via `admin.*`. Every
  assertion runs through a `sessionedClient(session)` — the anon-key client
  carrying the user's access token — so RLS is never bypassed during the test.
- **Fresh unique users per file.** Call `createTestUser()` (from
  `tests/integration/helpers/sessions.ts`) in `beforeAll`. It mints a
  timestamp-suffixed email + password, immediately signs in, and returns
  `{ id, email, session, client }`. Unique emails prevent collisions on parallel
  runs and re-runs (local rate limit: 30 sign-ins / 5 min).
- **Assert denied / zero-rows shapes, not "no error".** For RLS scenarios:
  - SELECT → `data` is an empty array, no error object.
  - UPDATE / DELETE of a row you don't own → zero rows affected (row is
    invisible to RLS; use `count` or check `data` length, not `error`).
  - INSERT with a cross-user parent FK → `error.code === "23514"` (trigger
    `check_violation` from the app's `SECURITY INVOKER` BEFORE-triggers).
  - Storage cross-user write → denied (RLS `WITH CHECK`); read → denied / not found.
- **Storage teardown is explicit.** `admin.deleteUser` cascades FK rows but
  leaves `storage.objects`. Call `deleteTestUser(user)` (the helper lists then
  removes objects under `${user.id}/` before calling `admin.deleteUser`) to keep
  the bucket clean across runs.
- **Reference files:** `tests/integration/globalSetup.ts`,
  `tests/integration/helpers/clients.ts`,
  `tests/integration/helpers/sessions.ts`,
  `tests/integration/smoke.integration.test.ts` (session-fixture smoke),
  `tests/integration/isolation.integration.test.ts` (RLS matrix),
  `tests/integration/storage.integration.test.ts` (IDOR / Storage RLS).

### 6.3 Adding an e2e test

- TBD — see §3 Phase 3 (only if the AI-outage UI fallback is unreachable from integration).

### 6.4 Adding a test for a new API endpoint

Pattern proven by `tests/integration/auth-boundary.integration.test.ts` (Risk #3).
Use it for any new `src/pages/api/` route to lock in its no-session and
invalid-session behavior before it ships.

- **Boot the real SSR app.** The auth-boundary suite uses
  `tests/integration/helpers/server.ts` — `startServer()` spawns `astro dev` on
  a test port with `SUPABASE_URL` / `SUPABASE_KEY` set to the captured local
  `API_URL` / `ANON_KEY` (wired via env on the child process and/or a temp
  `.dev.vars`). Call `startServer()` in `beforeAll` and `stop()` in `afterAll`.
  Scope the server lifecycle to the file that needs it — other suites (RLS,
  Storage) should not pay the boot cost.
- **`redirect: "manual"` is required.** Every `fetch` in the auth-boundary suite
  must pass `{ redirect: "manual" }` — otherwise a 302 to `/auth/signin` is
  silently followed to a 200 and the denial is invisible.
- **Assert the heterogeneous deny contract, not a uniform 401.** API routes are
  outside `PROTECTED_ROUTES` and self-guard; their no-session responses differ:
  - JSON `POST` endpoints (e.g. `/api/plants`, `/api/plants/upload-url`) → **401 JSON** `{error:"unauthorized"}`.
  - Form-POST endpoints (e.g. `/api/locations`) → **302** to `/auth/signin`.
  - Protected page routes (`/dashboard`, `/locations/*`) → **302** to `/auth/signin`.
  - Public routes (`/`, `/auth/signin`, `/auth/check-email`) → **200**.
    Use `it.each` over a `[route, method, expectedStatus]` table — one row per
    endpoint — rather than a shared `expect(status).toBe(401)` loop.
- **Test the costly endpoint first.** For `POST /api/plants/suggest`: assert the
  response is 401 JSON with the `unauthorized` shape. A 401 proves the
  `requireUser` guard fired before the AI call (a 200 with `ai_unavailable`
  would mean the guard was bypassed).
- **Add an invalid-session case.** Repeat one JSON endpoint and one protected
  page with a garbage `sb-...-auth-token` cookie value → same deny status as
  no-session. This proves `getUser()` actually validates the token (not just
  checks presence).
- **Reference files:** `tests/integration/helpers/server.ts`,
  `tests/integration/auth-boundary.integration.test.ts`.

### 6.5 Adding a fault-injection test for an external provider

- TBD — see §3 Phase 3 (slow / erroring AI-provider stub; assert the degraded "create manually" shape and photo preservation, not the success shape).

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note
here capturing anything surprising the rollout phase taught.)

**Phase 1 (ai-parse-unit) — calendar-invalid date passthrough (Lesson-5 candidate).**
`asIsoDate`'s leading-regex branch emits a regex-matching but calendar-invalid
`YYYY-MM-DD` (e.g. `2024-02-30`) **verbatim** — JS `Date` rolls the day over, so
the `T00:00:00Z` validity check passes — yet the DB `winterization_cutoff date`
column would reject that value. This is the latent second face of Risk #5
("emits a malformed care profile"). A characterization test in
`src/lib/ai/suggest.test.ts` documents the current behavior; it is **not** fixed
here. Escalate to a bug→fix→regression change (Lesson 5).

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Supabase Auth internals / magic-link email delivery** — third party; we test only _our_ boundary around it (#3). Re-evaluate if we wrap auth in custom logic beyond the middleware. (Source: Phase 2 interview Q5.)
- **shadcn/ui primitives (`src/components/ui/`)** — vendored; the library is the test. Re-evaluate only if we fork a primitive.
- **AI suggestion quality / accuracy** (is the species guess correct?) — evaluates the third-party model; the ≥75% acceptance criterion is measured from production accept/edit behavior, not a test. This is also where an AI-native LLM-as-judge layer was considered and **deliberately deferred** — _when NOT to use:_ do not put a judge over deterministic parsing or fallback; the bug the builder fears lives in our massaging code (#5), not the model's output quality. Re-evaluate if acceptance drops and the cause is suspected to be our prompt/parsing rather than the model.
- **Reminder loops (S-04 watering, S-05 winterization) and winterization seasonal timing** — not built yet; testing waits until the slices ship, then `--refresh` adds a phase (winterization needs fake-clock infra). (Source: roadmap status `proposed`.)
- **Visual / pixel snapshots of auth and marketing pages** — brittle, low signal for a personal-use MVP.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-10
- Stack versions last verified: 2026-06-10
- AI-native tool references last verified: 2026-06-10

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive (e.g. the reminder loops S-04/S-05 ship),
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
