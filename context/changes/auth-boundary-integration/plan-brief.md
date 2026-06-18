# Isolation & auth-boundary integration tests (test-plan Phase 2) — Plan Brief

> Full plan: `context/changes/auth-boundary-integration/plan.md`
> Research: `context/changes/auth-boundary-integration/research.md`

## What & Why

Stand up the project's first **integration** test suite to lock in three protections that
research confirmed already hold: cross-user data isolation (RLS, **#2**), endpoint/route auth
gating after the magic-link conversion (**#3**), and signed-upload / storage path scoping
(IDOR, **#4**). The job is to **lock in** isolation and gating that already pass — not to chase
an open hole — so every assertion targets the _denied / zero-rows_ shape, never the happy path.

## Starting Point

One pure unit test exists (`src/lib/ai/suggest.test.ts`, Phase 1) under a deliberately minimal
Node Vitest config; there is **no** integration harness, no admin/session helper, no CI test
wiring. The app runs entirely on the JWT-scoped publishable Supabase client (**no service-role
anywhere**), so two real sessions _is_ the production path.

## Desired End State

`npm run test:integration` (opt-in, Docker-dependent) runs green against local Supabase + the
real SSR app: a second user gets zero rows / denied on every operation against the first user's
data and storage, and every protected route / `/api/**` endpoint rejects a no/invalid session
with its correct status. `npm test` (unit) stays hermetic and Docker-free.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Risk #3 seam | Real running SSR server + `fetch` (no cookie) | Only seam that validates the _configured_ boundary — that `/api/**` is outside `PROTECTED_ROUTES` | Plan |
| Risks #2/#4 seam | Direct local Supabase, two sessioned clients | Cheapest real signal; tests the exact production (JWT-scoped) path | Research |
| Session minting | Service-role for seed/teardown; anon sessions for assertions | Deterministic seed + cascade cleanup, yet assertions never bypass RLS | Plan |
| Local Supabase + keys | `globalSetup` checks `supabase status`, captures keys, fails fast | Deterministic, no committed secrets, doubles as the Docker gate | Plan |
| Suite separation | Separate `vitest.integration.config.ts` + `test:integration` | Keeps the fast unit gate green without Docker | Plan |
| Test isolation | Fresh unique users per file + explicit storage teardown | Parallel-safe & re-runnable; storage objects aren't FK-cascaded | Plan |
| RLS test layer | Vitest two-session only (no pgTAP) | One tool/harness; matches §4 stack + research | Plan |

## Scope

**In scope:** integration harness (config, preflight, session fixtures, cleanup); Risk #2
matrix + trigger child-scoping + cascade; Risk #4 storage cross-user denial; Risk #3 deny
contract via the real SSR app; test-plan §6.2/§6.4 cookbook + §3 status sync.

**Out of scope:** CI wiring (Phase 4); pgTAP SQL suite; AI-outage fallback (Risk #1);
unconfigured-Supabase path; authed-positive HTTP case; standalone unit tests of the upload
validators; any `src/` or CLAUDE.md edit (the stale doc lines are already fixed).

## Architecture / Approach

Three seams by risk. **#2/#4**: two anon-key sessioned clients hit PostgREST/Storage directly
and assert denial/zero-rows. **#3**: a spawned `astro dev` (wired to local Supabase) is fetched
with no/invalid cookie and `redirect: "manual"` to assert the heterogeneous contract (401 JSON
for `/api/plants/*`, 302 for `/api/locations` + pages, 200 for public). The local
**service-role key** (captured at runtime from `supabase status`) does only `createUser` /
`deleteUser`; assertions stay on the anon path. Files live in `tests/integration/` behind a
separate Vitest config; `vitest.config.ts` excludes that dir.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Harness foundation | Separate config + `test:integration`, `globalSetup` preflight, two-client session fixtures, cleanup, smoke test | Forgetting to exclude `tests/integration/**` from the unit config breaks the hermetic gate |
| 2. Risk #2 (RLS) | Table × operation denial matrix, `23514` child-scoping, anon denial, cascade | Under-testing the trigger-based child-scoping (RLS alone doesn't stop it) |
| 3. Risk #4 (IDOR) | Cross-user storage read/write/sign denial; owner path succeeds | Storage teardown (objects aren't FK-cascaded) leaking across runs |
| 4. Risk #3 (boundary) | SSR-server boot + per-route deny contract, suggest 401-before-spend, invalid-session case | Server lifecycle/cold-start + wiring local Supabase env into `astro dev` |
| 5. Cookbook + status sync | Fill test-plan §6.2/§6.4; advance §3 Phase 2 status | None (docs) |

**Prerequisites:** Docker + `npx supabase start`; no new npm dependencies (`@supabase/supabase-js`, `supabase` CLI, Node `child_process` suffice).
**Estimated effort:** ~3–4 sessions across 5 phases (Phase 4's server lifecycle is the heaviest).

## Open Risks & Assumptions

- `astro dev` (Cloudflare/workerd runtime) must resolve `SUPABASE_URL`/`SUPABASE_KEY` from the
  child-process env and/or a temp `.dev.vars`; exact mechanism confirmed at implementation.
- Per-file user minting must stay under local auth rate limits (`sign_in_sign_ups = 30`/5 min)
  — use timestamp-unique emails and a small user count.
- Reproducing an authed `@supabase/ssr` cookie over HTTP is deliberately skipped; authed access
  is proven by the #2/#4 sessioned clients instead.

## Success Criteria (Summary)

- A second user is provably denied / sees zero rows on every operation and storage path against
  the first user's data.
- Every protected route and `/api/**` endpoint rejects a no/invalid session with its correct
  status; the costly suggestion endpoint 401s before any AI call.
- `npm run test:integration` is green with local Supabase up and fails fast when it is down;
  the unit gate (`npm test`) stays hermetic.
