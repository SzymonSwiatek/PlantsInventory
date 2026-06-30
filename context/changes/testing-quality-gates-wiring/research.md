---
date: 2026-06-25T17:19:21+0200
researcher: Szymon Świątek
git_commit: d7325f0b43ca4a56be4c781829188816f233ae16
branch: main
repository: 10xPlantsInventory
topic: "Wire the test step into CI and lock unit + integration as a required gate (test-plan Phase 4)"
tags: [research, codebase, ci, github-actions, vitest, playwright, supabase, quality-gates]
status: complete
last_updated: 2026-06-25
last_updated_by: Szymon Świątek
---

# Research: Wire the test step into CI and lock unit + integration as a required gate

**Date**: 2026-06-25T17:19:21+0200
**Researcher**: Szymon Świątek
**Git Commit**: d7325f0 (local; **not yet pushed** — `main` is ahead of `origin/main` by 1, so links below are local file refs, not GitHub permalinks)
**Branch**: main
**Repository**: 10xPlantsInventory (`SzymonSwiatek/PlantsInventory`)

## Research Question

Test-plan §3 **Phase 4 — Quality-gates wiring**: "Add the test step to CI and lock unit + integration as a required gate." Per §5, the `unit + integration` gate is "required after §3 Phase 4 (CI wiring); available locally after Phases 1–3." This research grounds *where the failure lives* before planning: what CI exists today, what the test suites need at runtime, how to run them in GitHub Actions, and what "required gate" actually means here. Scope confirmed with the user: **full Supabase-in-CI wiring** for integration, **and** an e2e-in-CI analysis (even though §5 leaves e2e optional).

## Summary

- **There is no test step in CI today.** `.github/workflows/ci.yml` runs `lint → build → check-dist-config`, then a `deploy` job (`needs: ci`, push-only). Phase 4's job is purely additive CI infrastructure — all three prior phases explicitly deferred CI wiring to *this* phase, and all three were characterization-only (no production code changes pending).
- **Unit tests are trivial to gate** (`npm run test:run` — Docker-free, hermetic, seconds). There are now **22 unit test files** under `src/` — far beyond the test-plan's original Risk #5 scope, because the reminders feature work added many. The unit config's `exclude` of `tests/integration/**` + `tests/e2e/**` is load-bearing and already in place.
- **Integration tests are the hard part** (`npm run test:integration`): they require **Docker + local Supabase + a booted `astro dev` server**. The vitest `globalSetup` shells `npx supabase status --output json` at runtime and fails fast if the stack is down. Wiring = `supabase/setup-cli@v2` → `supabase start` (applies migrations, no `init`/`seed` needed) → run vitest. The realistic cost/flake source is the Docker image cold-pull on `ubuntu-latest` (24.04 no longer pre-caches images).
- **e2e** needs everything integration needs **plus system Google Chrome** (`channel: "chrome"`, not bundled Chromium). It is consistent with §5 to leave it out of the required gate; if added, run it as a separate, likely non-blocking job.
- **"Required gate" needs two distinct mechanisms, and neither exists yet**: (1) `deploy.needs` must include the test jobs so a red suite blocks the push-to-main deploy; (2) **branch protection** required status checks on `main` to block PR *merges* (currently 404 — `main` is unprotected, PRs can merge red today).
- **Two hazards to design around**: integration and e2e both clobber/restore the repo-root `.dev.vars` (must not run concurrently in the same checkout), and GoTrue's local sign-in limit is `30 / 5 min` per IP (the suites mint ~8–9 users per run).

## Detailed Findings

### Current CI / deploy structure

`.github/workflows/ci.yml` — two jobs:

- **`ci` job** (`ci.yml:13-28`), `ubuntu-latest`: `checkout@v6` → `setup-node@v6` (node 22, `cache: npm`) → `npm ci` → `npx astro sync` → `npm run lint` → `npm run build` (with `SUPABASE_URL`/`SUPABASE_KEY` secrets) → `node scripts/check-dist-config.mjs`. **No test invocation anywhere.**
- **`deploy` job** (`ci.yml:30-48`): `needs: ci`, `if: github.event_name == 'push'`. Rebuilds and runs `cloudflare/wrangler-action@v3` (`command: deploy`). The build step here needs no `SUPABASE_*` env — the Worker keeps its secrets across `wrangler deploy` (per `context/changes/deployment/deployment-plan.md:289-290`).
- **Triggers** (`ci.yml:3-10`): `push` to `main` with `paths-ignore: ["**/*.md", "context/**"]`; `pull_request` to `main` (no path-ignore).
- `scripts/check-dist-config.mjs` validates that the Cloudflare adapter preserved `config.triggers.crons` in `dist/server/wrangler.json` (would otherwise silently drop the daily reminder cron).

**Insertion points**: unit step after `npm run lint` (`ci.yml:23`); integration must be its **own job** (Docker). To gate deploys, `deploy.needs` (`ci.yml:31`) must grow to include the test job(s).

### Test tooling & inventory

- Scripts (`package.json:10-13`): `test` (watch), `test:run` = `vitest run` (unit), `test:integration` = `vitest run --config vitest.integration.config.ts`, `test:e2e` = `playwright test`.
- Versions: `vitest@^3.2.6`, `@playwright/test@^1.61.0`, `supabase@^2.23.4` (devDependency → `npx supabase` resolves the local binary; no global install). No MSW; fault tests use `undici` `MockAgent`.
- `vitest.config.ts`: `environment: "node"`, `setupFiles: ["./vitest.setup.ts"]`, `@` alias to `./src`, and `exclude: [...configDefaults.exclude, "tests/integration/**", "tests/e2e/**"]` (`:18`) — the hermetic-unit guarantee. `vitest.setup.ts` pins `process.env.TZ = "UTC"`.
- `vitest.integration.config.ts`: `include: ["tests/integration/**/*.integration.test.ts"]`, `globalSetup: ["./tests/integration/globalSetup.ts"]`, and **`fileParallelism: false`** (`:23`) because the server-booting suites share port 4322 and the repo-root `.dev.vars`.
- `playwright.config.ts`: single project "Google Chrome" with `channel: "chrome"` (`:43`), `storageState: "playwright/.auth/user.json"`, `webServer` boots `node tests/e2e/setup-dev-vars.ts && npm run dev -- --port 4323` (timeout 120s, `reuseExistingServer: !CI`), `globalSetup`/`globalTeardown` wired, CI knobs `forbidOnly` / `retries: 2` / `workers: 1`.
- **Inventory**: 22 `*.test.ts` under `src/`; 5 `*.integration.test.ts` (`smoke`, `isolation`, `storage`, `auth-boundary`, `ai-outage`); 1 `*.spec.ts` (`add-plant-ai-outage`).
- Husky pre-commit (`.husky/pre-commit`) runs `lint-staged` (`package.json:74-81`): `eslint --fix` on `*.{ts,tsx,astro}`, `prettier --write` on `*.{json,css,md}`. No tests at commit time.

### Integration suite runtime dependencies

- **`tests/integration/globalSetup.ts`**: `execSync("npx supabase status --output json")` (`:21`), parses `API_URL`/`ANON_KEY`/`SERVICE_ROLE_KEY`, sets `SUPABASE_TEST_URL` / `SUPABASE_TEST_ANON_KEY` / `SUPABASE_TEST_SERVICE_ROLE_KEY` (`:41-43`). If the stack is down (or keys missing) it throws **"Local Supabase is not running. Run `npx supabase start` first (Docker required)."** (`:16,26`). It does **not** start Supabase — CI must start it first.
- **`helpers/clients.ts`**: `serviceRoleClient()` (seed/teardown, bypasses RLS), `sessionedClient(session)` (anon key + `Authorization: Bearer`, RLS-respecting assertions), built on raw `@supabase/supabase-js` (the app factory needs `astro:env/server`).
- **`helpers/sessions.ts`**: `createTestUser()` = admin `createUser({email_confirm:true})` + real `signInWithPassword`; emails `test-${Date.now()}-${random}@example.com`. Rate-limit ceiling `sign_in_sign_ups = 30 / 5 min` (`supabase/config.toml:191`). `deleteTestUser` removes `${uid}/` Storage objects first (not FK-cascaded), then `admin.deleteUser`.
- **`helpers/server.ts`**: spawns `npx astro dev --port 4322`, writes repo-root `.dev.vars` = `SUPABASE_URL/KEY` (from `SUPABASE_TEST_*`) + empty `AI_API_KEY=` (outage lever; workerd reads `.dev.vars` before `.env`), polls `/auth/signin` for 200 (90s budget), restores/deletes `.dev.vars` in `stop()`.
- **Which files boot the server**: only `auth-boundary` and `ai-outage` call `startServer()` (each pays one ~up-to-90s cold boot, `beforeAll` timeout 120s); `smoke`, `isolation`, `storage` are network-only against Supabase. ~8 test users minted per full run.
- **Docker**: required (the local stack runs in Docker) — surfaced in the `globalSetup` error and `test-plan.md:108`.

### e2e suite runtime dependencies

- **`tests/e2e/setup-dev-vars.ts`** (runs in the `webServer` command before `astro dev`): backs up `.dev.vars` → `.dev.vars.e2e-bak`, `execSync("npx supabase status …")`, writes `.dev.vars` with `AI_API_KEY=` empty (same outage lever).
- **`tests/e2e/global-setup.ts`**: talks to Supabase directly (admin + RLS), `captureSupabaseEnv()` sets `SUPABASE_TEST_*`, mints a user + seeds a location, writes `playwright/.auth/user.json` (storageState via `@supabase/ssr` cookie capture) and `playwright/.auth/context.json` (`{userId, locationId}`). **Warms the dev server** by launching a throwaway `chromium.launch({channel:"chrome"})` and loading the new-plant page twice (`networkidle`) so a mid-test Vite reload doesn't wipe the selected photo.
- **`tests/e2e/global-teardown.ts`**: restores `.dev.vars`, `deleteTestUserById`, removes context file.
- **`channel: "chrome"`** (`playwright.config.ts:43` + warm-up at `global-setup.ts`) needs **system Google Chrome**. `npx playwright install chromium` is **not** sufficient — CI needs `npx playwright install --with-deps chrome` (or switch the project to bundled Chromium).

### Supabase-in-CI wiring mechanics

- **Official action `supabase/setup-cli@v2`** installs the CLI only (you run `start` yourself). Omitting `version:` lets it read the CLI version from `package-lock.json` — cleanest here since `supabase@^2.23.4` is already a devDep, keeping `setup-cli` and the `npx supabase` invoked by `globalSetup` in lockstep. *(Verify the exact `v2.x` tag at wiring time.)*
- **Docker on `ubuntu-latest`** (= Ubuntu 24.04): daemon preinstalled and running, so `supabase start` works with no extra setup. **But 24.04 no longer pre-caches Docker images**, so Supabase's Postgres/GoTrue/Storage images pull fresh each run (~1–3+ min cold start — *verify on a real run*). Caching images (`docker save`/`load` via `actions/cache`, keyed on CLI version) is the highest-leverage time/flake fix; treat as optimization, not correctness.
- **No `supabase init`** (config.toml committed) and **no `seed.sql`** present — `supabase start` applies the 6 `supabase/migrations/` on the fresh DB and blocks until healthy, so no explicit migrate/`db reset`/`pg_isready` step is needed.
- **Key capture**: because `globalSetup` re-shells `supabase status` itself, the integration job needs nothing exported beyond having the stack up. (`supabase status -o env` is only needed if you want `SUPABASE_URL`/`SUPABASE_KEY` for *other* steps.)

### What "required gate" means here (two mechanisms, both missing)

1. **Job ordering (`needs:`)** — gates the **deploy**. `deploy` (`ci.yml:31`, push-to-main only) currently `needs: ci`; to make tests block production it must become e.g. `needs: [ci, unit, integration]`. This is the load-bearing edit.
2. **Branch-protection required status checks** on `main` — gates PR **merges**. `gh api …/branches/main/protection` → **404 "Branch not protected"** today, so PRs can merge with a red suite. Set required checks naming the test jobs (repo Settings → Branches, or `gh api -X PUT`).
   - **Gotcha**: `ci.yml` triggers ignore `**/*.md` + `context/**` (`ci.yml:6-8`). A required check that never runs on a docs-only PR can block merge indefinitely. Either don't path-filter the test jobs, or use a sentinel/always-pass job. Flag for the plan.

## Code References

- `.github/workflows/ci.yml:13-28` — `ci` job (lint/build/check-dist; no tests). `:30-48` — `deploy` job (`needs: ci`, push-only). `:6-8` — `paths-ignore`.
- `scripts/check-dist-config.mjs` — asserts cron triggers survived the build.
- `package.json:10-13` — test scripts; `:65` — `supabase` devDep; `:74-81` — lint-staged.
- `vitest.config.ts:18` — integration/e2e exclude (hermetic unit gate). `vitest.setup.ts` — `TZ=UTC`.
- `vitest.integration.config.ts:21-23` — include glob, `globalSetup`, `fileParallelism: false`.
- `playwright.config.ts:43` — `channel: "chrome"`; `:60-63` — webServer boot; `:19-26` — CI knobs.
- `tests/integration/globalSetup.ts:16,21-43` — Supabase preflight + `SUPABASE_TEST_*` contract.
- `tests/integration/helpers/server.ts:13,49,102-119` — astro dev boot, `.dev.vars` write, readiness poll.
- `tests/integration/helpers/sessions.ts:21-33` — `createTestUser`, rate-limit note.
- `supabase/config.toml:191` — `sign_in_sign_ups = 30` / 5 min.
- `tests/e2e/setup-dev-vars.ts:28-38`, `tests/e2e/global-setup.ts:48-64,128-181` — `.dev.vars` lever, env capture, storageState, warm-up.

## Architecture Insights

- **Two-tier test gate by design**: the unit config deliberately excludes Docker-bound suites so `npm run test:run` stays hermetic and fast; integration/e2e are quarantined behind their own configs and `npm run` scripts. CI should mirror this split — a fast Docker-free `unit` job (or fold into `ci`) and a separate `integration` job.
- **Self-provisioning test env**: the suites discover Supabase keys at runtime via `supabase status` rather than reading CI secrets, so the integration job needs *Supabase running* but **no external Supabase secrets**. This keeps CI test data fully isolated from production.
- **Shared mutable `.dev.vars`** is the cross-suite coupling: integration `server.ts` and e2e `setup-dev-vars.ts` both clobber+restore it. Running integration and e2e concurrently in one checkout corrupts it — they must be serialized or run in separate jobs/checkouts.
- **The outage lever (`AI_API_KEY=` empty)** is reused across integration's booted server and e2e's webServer — the same degrade path Risk #1 protects, exercised without a stub.

## Historical Context (from prior changes)

CI wiring was **explicitly and repeatedly deferred to this phase**, and every prior phase shipped tests as characterization only (no production changes pending):

- `context/archive/2026-06-14-ai-parse-unit/plan.md:84,414` — "**Not wiring** the suite into CI as a required gate — that is rollout Phase 4." / "CI wiring is deferred to rollout Phase 4 (`npm run test:run` is the command that phase will adopt)."
- `context/archive/2026-06-17-auth-boundary-integration/plan.md:88-89` — "**No CI wiring.** The test-plan assigns CI integration of this suite to Phase 4. The suite runs locally only for now (`npm run test:integration`)." Also `:127-145` — the unit-config exclude is "load-bearing"; local keys must be captured at runtime (they rotate per `supabase start`).
- `context/archive/2026-06-18-ai-outage-resilience/plan.md:91-92` — "**CI wiring** — locking unit+integration (and optionally e2e) as required gates is test-plan Phase 4." `:87` — "**No production code changes.**"
- `context/foundation/test-plan.md:87,131-132` — Phase 4 goal + the binding gate semantics: unit+integration "required after §3 Phase 4"; e2e "optional — only if §3 Phase 3 introduces it."
- `context/changes/deployment/deployment-plan.md:251-303` — original CI design (lint+build only; `SUPABASE_*` as Actions secrets used at build); `:289-290` — deploy keeps Worker secrets across `wrangler deploy`.
- `context/foundation/lessons.md` — CSRF guard rule (unrelated to CI, but the binding "every new mutation route opts into `requireSameOrigin`" lesson stands).

## Related Research

- `context/foundation/test-plan.md` §3–§6 — the authoritative rollout spec; §6.1/§6.2/§6.3 cookbook patterns describe the suites being gated.
- Archived phase research/plans listed above (`context/archive/2026-06-1{4,7,8}-*`).

## Open Questions

These are **plan-time decisions**, surfaced by the research but not resolved by it:

1. **Job topology**: fold unit into the existing `ci` job (simplest) vs. a separate fast `unit` job (fastest red signal). Integration must be its own Docker job regardless.
2. **Triggers for the integration/e2e jobs**: every PR + push, or push-only (like deploy)? Note the `paths-ignore` interaction with required checks (docs-only PR gotcha).
3. **Deploy gating**: confirm `deploy.needs` should include `unit` + `integration` (and whether a failing integration run should block production deploys, or only fail the check).
4. **Branch protection**: enable required status checks on `main` (currently none). Which job names become required? This is the half of "required gate" that lives outside the YAML.
5. **e2e**: include now as a separate (non-blocking?) job, or keep local-only per §5's "optional"? Requires `playwright install --with-deps chrome`.
6. **Image caching**: implement Supabase Docker-image caching now (best time/flake win) or defer as a follow-up optimization.
7. **CLI version**: rely on lockfile-driven `setup-cli` (auto-match `^2.23.4`) vs. an explicit pin.
