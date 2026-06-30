# Wire the Test Step into CI and Lock unit + integration as a Required Gate — Implementation Plan

## Overview

Turn the three already-built, locally-runnable test suites (unit, integration, e2e) into enforced CI quality gates. This is test-plan §3 **Phase 4 — Quality-gates wiring**: "Add the test step to CI and lock unit + integration as a required gate." The work is purely additive CI infrastructure — no production code changes — completing the rollout that the three prior phases each explicitly deferred to here.

Concretely: fold the hermetic unit suite into the existing `ci` job, add a Docker-backed `integration` job, gate the push-to-main deploy on both, add a **non-blocking** `e2e` job for client-rendered-fallback signal, and lock `main` with branch-protection required status checks so PRs can't merge red.

## Current State Analysis

- **No test step runs in CI today.** `.github/workflows/ci.yml` has two jobs: `ci` (`checkout → setup-node → npm ci → astro sync → lint → build → check-dist-config`, `ci.yml:13-28`) and `deploy` (`needs: ci`, `if: github.event_name == 'push'`, `ci.yml:30-48`). No `npm test*` invocation anywhere.
- **Triggers** (`ci.yml:3-10`): `push` to `main` carries `paths-ignore: ["**/*.md", "context/**"]`; `pull_request` to `main` carries **no** path filter — so every PR already runs the whole workflow regardless of which files changed.
- **Three suites exist and run locally** (test-plan §4, §6):
  - **unit** — `npm run test:run` (`vitest run`), Docker-free, hermetic, seconds. 22 `*.test.ts` files under `src/`. `vitest.config.ts:18` excludes `tests/integration/**` + `tests/e2e/**` (the load-bearing hermetic guarantee); `vitest.setup.ts` pins `TZ=UTC`.
  - **integration** — `npm run test:integration` (`vitest run --config vitest.integration.config.ts`). 5 `*.integration.test.ts` files. Needs **Docker + local Supabase + a booted `astro dev`**. `vitest.integration.config.ts` sets `fileParallelism: false` (shared port 4322 + repo-root `.dev.vars`). `globalSetup` shells `npx supabase status --output json`, captures `SUPABASE_TEST_*`, and fails fast with "run `npx supabase start` first" if the stack is down — it does **not** start Supabase.
  - **e2e** — `npm run test:e2e` (`playwright test`). Single project `channel: "chrome"` (`playwright.config.ts:43`) = **system Google Chrome**, not bundled Chromium. CI knobs already present: `forbidOnly: !!CI`, `retries: CI ? 2 : 0`, `workers: CI ? 1 : undefined`, `reuseExistingServer: !CI`, `trace: "on-first-retry"`. `webServer` runs `node tests/e2e/setup-dev-vars.ts && npm run dev -- --port 4323`, 120s boot budget.
- **"Required gate" is two distinct mechanisms, both missing:** (1) `deploy.needs` must include the test jobs to block the push-to-main deploy; (2) **branch protection** required status checks on `main` to block PR *merges* — `gh api …/branches/main/protection` returns 404 today, so PRs can merge with a red suite.
- **CLI tooling**: `supabase@^2.23.4` is a devDependency, so `npx supabase` resolves the local binary. `supabase/config.toml` is committed; no `supabase init` and no `seed.sql` needed — `supabase start` applies the 6 `supabase/migrations/` and blocks until healthy.

### Key Discoveries:

- The unit/integration split is **by design** so `npm run test:run` stays Docker-free (`vitest.config.ts:18`). CI must mirror it: unit folds into the fast `ci` job; integration is its own Docker job.
- The suites **self-provision** their test env — `globalSetup` discovers Supabase keys at runtime via `supabase status`, so the integration job needs *Supabase running* but **no external Supabase secrets** (`tests/integration/globalSetup.ts:21-43`). Test data is fully isolated from production.
- **Shared mutable `.dev.vars` is the cross-suite coupling.** Integration's `tests/integration/helpers/server.ts` and e2e's `tests/e2e/setup-dev-vars.ts` both clobber+restore the repo-root `.dev.vars`. Running them concurrently in one checkout corrupts it — they must be **separate jobs** (= separate runner VMs).
- **`channel: "chrome"` needs `npx playwright install --with-deps chrome`** — `npx playwright install chromium` is not sufficient (`playwright.config.ts:43`, warm-up at `tests/e2e/global-setup.ts`).
- The docs-only-PR / required-check **deadlock is already avoided**: `pull_request` has no `paths-ignore`, and the plan adds no job-level path filter — so the required checks (`ci`, `integration`) always run on every PR and can always resolve.
- GoTrue local sign-in limit is `30 / 5 min` per IP (`supabase/config.toml:191`); integration mints ~8 users/run, e2e ~1. Because integration and e2e run as **separate jobs on separate runner VMs (separate IPs)**, neither approaches the ceiling.

## Desired End State

After this plan:

1. Every PR to `main` and every (non-docs) push runs `lint → unit → build → check-dist` in the `ci` job **plus** the full `integration` suite against a fresh local Supabase in its own job.
2. A red unit or integration run **blocks the push-to-main deploy** (`deploy.needs: [ci, integration]`).
3. `main` is **branch-protected**: `ci` and `integration` are **required status checks**, so a PR cannot merge while either is red.
4. A **non-blocking** `e2e` job runs the Playwright add-plant-outage spec against system Chrome, surfacing UI-fallback regressions without gating deploy or merge; on failure it uploads the Playwright trace as an artifact.

**Verification of end state**: open a throwaway PR that deliberately breaks a unit assertion → the `ci` check goes red and the PR's merge button is blocked. Revert → green, merge allowed. Push to `main` with a red integration suite → `deploy` does not run.

## What We're NOT Doing

- **No Docker image caching.** `supabase start` cold-pulls the Postgres/GoTrue/Storage images each run (~1–3+ min). Caching (`docker save`/`load` via `actions/cache`, keyed on CLI version) is the highest-leverage perf win but is deferred to a **follow-up optimization change** — it is not a gate-correctness requirement, and we want to measure the real cold-pull cost on a first green run before optimizing.
- **No blocking e2e gate.** e2e stays optional per test-plan §5 — it runs and reports but is never in `deploy.needs` and never a required status check.
- **No production code changes.** This phase touches only `.github/workflows/ci.yml` and GitHub repo settings (branch protection).
- **No new test files.** The suites already exist; this wires the existing `npm run` scripts.
- **No changes to the test configs** (`vitest.config.ts`, `vitest.integration.config.ts`, `playwright.config.ts`) — they already carry the correct CI knobs and exclude globs.
- **No automation of branch protection.** It is applied once by a human with admin rights, via documented `gh` commands.

## Implementation Approach

Mirror the suites' cost/isolation structure in CI job topology:

- **Fast, Docker-free `ci` job** absorbs unit (one extra step) — keeps the quickest red signal on the cheapest path.
- **`integration` job** is the only job that brings up Docker + Supabase; it's the real "lock the gate" work.
- **`e2e` job** is a third, independent job (own runner) that additionally installs system Chrome; non-blocking.
- **Deploy gating** is one edit: `deploy.needs` grows to include `integration` (`ci` already covers unit once folded in).
- **Branch protection** is the out-of-YAML half, applied via `gh api` and documented for human execution.

Each phase is independently verifiable and leaves CI green.

## Critical Implementation Details

- **`.dev.vars` collision (ordering/isolation).** Integration and e2e both clobber+restore the repo-root `.dev.vars`. They MUST be separate jobs — never steps in the same job/checkout — or they corrupt each other's secrets file. GitHub gives each job its own fresh runner VM automatically, which satisfies this.
- **Supabase CLI version lockstep.** Use `supabase/setup-cli@v2` with the `version:` omitted so it reads the CLI version from `package-lock.json` — this keeps `setup-cli` and the `npx supabase` invoked by `globalSetup` on the same `^2.23.4`. (Verify the exact `v2.x` action tag at wiring time.)
- **Chrome channel, not Chromium.** The e2e job must run `npx playwright install --with-deps chrome` (system Chrome + OS libs). `install chromium` will not satisfy `channel: "chrome"`.
- **Required-check deadlock avoidance.** Do NOT add a job-level `paths` filter to the test jobs. `pull_request` already has no `paths-ignore`, so `ci` and `integration` run on every PR and the required checks can always resolve — including docs-only PRs.
- **Deploy build needs no Supabase env.** The existing `deploy` job's `build` step intentionally has no `SUPABASE_*` (the Worker keeps its secrets across `wrangler deploy`, per `context/changes/deployment/deployment-plan.md:289-290`). Only the `needs:` line changes.

---

## Phase 1: Unit + integration gate

### Overview

Fold the hermetic unit suite into the existing `ci` job, add a Docker-backed `integration` job that boots local Supabase, and grow `deploy.needs` so a red unit or integration run blocks the push-to-main deploy. This is the load-bearing phase — it makes "required gate" real for production deploys.

### Changes Required:

#### 1. Fold unit tests into the `ci` job

**File**: `.github/workflows/ci.yml`

**Intent**: Run the fast, Docker-free unit suite as part of the existing `ci` job so unit failures gate alongside lint/build with no extra runner overhead.

**Contract**: Add a `- run: npm run test:run` step to the `ci` job, placed after `npm run lint` (`ci.yml:23`) and before `npm run build`. No new env. The job name `ci` is unchanged (it becomes a required check in Phase 3).

#### 2. Add the `integration` job

**File**: `.github/workflows/ci.yml`

**Intent**: Stand up local Supabase on a fresh runner and run the integration suite against it, with no external Supabase secrets (the suite discovers keys at runtime via `supabase status`).

**Contract**: New top-level job `integration` (`runs-on: ubuntu-latest`, `timeout-minutes: 20` so a hung Docker image pull or `astro dev` boot fails fast instead of riding GitHub's 6-hour default), no `paths` filter so it inherits the workflow triggers (every PR + non-docs push). Steps: `actions/checkout@v6` → `actions/setup-node@v6` (node 22, `cache: npm`) → `npm ci` → `supabase/setup-cli@v2` (no `version:` — read from lockfile) → `npx supabase start` → `npm run test:integration`. No `astro sync` needed (integration doesn't build). The job must NOT also run e2e (see Critical Implementation Details: `.dev.vars` collision).

#### 3. Gate the deploy on the test jobs

**File**: `.github/workflows/ci.yml`

**Intent**: Make a red suite block the production deploy.

**Contract**: Change `deploy.needs` (`ci.yml:31`) from `ci` to `[ci, integration]`. `ci` already covers unit (change #1); `integration` is the new dependency. The `if: github.event_name == 'push'` guard is unchanged.

### Success Criteria:

#### Automated Verification:

- Workflow YAML is valid and parses (e.g. `actionlint .github/workflows/ci.yml`, or GitHub accepts the push without a workflow-syntax error)
- `npm run test:run` passes locally (confirms the unit step will be green)
- `npm run test:integration` passes locally against a running `npx supabase start` (confirms the integration step will be green)
- On a test PR, the `ci` job runs the unit step and the `integration` job runs the suite — both report status checks

#### Manual Verification:

- On a test PR that deliberately breaks a unit assertion, the `ci` check goes red
- On a test PR that deliberately breaks an integration assertion, the `integration` check goes red
- The `integration` job successfully cold-starts Supabase (Docker images pull, migrations apply, suite connects) within an acceptable wall-clock time (note the cold-pull duration for the caching follow-up)
- A push to `main` with a red integration run does NOT trigger the `deploy` job

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Non-blocking e2e job

### Overview

Add a separate, independent `e2e` job that installs system Chrome and runs the Playwright add-plant-outage spec against a fresh local Supabase. It runs and reports but is never in `deploy.needs` and never a required check, so its flakiness can't block shipping (test-plan §5: e2e optional).

### Changes Required:

#### 1. Add the `e2e` job

**File**: `.github/workflows/ci.yml`

**Intent**: Surface client-rendered add-plant-fallback regressions (Risk #1's UI path, unreachable from integration) in CI without gating deploy or merge.

**Contract**: New top-level job `e2e` (`runs-on: ubuntu-latest`, `timeout-minutes: 25` — it additionally pays the Chrome install + dev-server warm-up, so it gets a slightly larger bound than `integration`; still well under the 6-hour default), no `paths` filter. Steps: `actions/checkout@v6` → `actions/setup-node@v6` (node 22, `cache: npm`) → `npm ci` → `supabase/setup-cli@v2` (no `version:`) → `npx supabase start` → `npx playwright install --with-deps chrome` → `npm run test:e2e`. The job is its own runner (separate from `integration`) so the `.dev.vars` clobber doesn't collide. It is NOT added to `deploy.needs` and NOT made a required check.

#### 2. Upload the Playwright trace on failure

**File**: `.github/workflows/ci.yml`

**Intent**: Make a red e2e run debuggable (the config already emits `trace: "on-first-retry"`).

**Contract**: Add a final `actions/upload-artifact@v4` step to the `e2e` job with `if: failure()`, uploading the Playwright report/trace output (`playwright-report/` and/or `test-results/`).

### Success Criteria:

#### Automated Verification:

- Workflow YAML still parses with the new `e2e` job (`actionlint` / GitHub accepts the push)
- `npm run test:e2e` passes locally against `npx supabase start` (confirms the spec is green)
- On a test PR, the `e2e` job runs and reports a status check distinct from `ci` and `integration`

#### Manual Verification:

- The `e2e` job installs system Chrome (`--with-deps chrome`) and the Playwright spec runs to completion in CI
- A red `e2e` run does NOT block the PR merge button (confirmed after Phase 3 branch protection is applied) and does NOT prevent `deploy`
- On an induced e2e failure, the trace artifact is uploaded and downloadable from the run

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Branch protection on `main`

### Overview

Apply the out-of-YAML half of "required gate": enable branch protection on `main` with `ci` and `integration` as required status checks, so a PR cannot merge while either is red. Applied once by a human with admin rights, via documented `gh` commands; e2e is deliberately excluded (non-blocking).

### Changes Required:

#### 1. Document and apply required status checks on `main`

**File**: `context/changes/testing-quality-gates-wiring/plan.md` (this plan documents the command; the change is applied to GitHub repo settings, not a file in the repo)

**Intent**: Block PR merges to `main` when the required checks are red, completing the "required gate."

**Contract**: A `gh api --method PUT repos/{owner}/{repo}/branches/main/protection` call (or repo Settings → Branches) that sets `required_status_checks.contexts` to exactly `["ci", "integration"]` (NOT `e2e`). The check context names MUST match the job names emitted in Phases 1–2 (`ci`, `integration`). The **full verbatim command** (all four required top-level keys — see Migration Notes) is captured in Migration Notes below so the human can run it as-is; do not hand-build a minimal body (the API 422s unless `required_status_checks`, `enforce_admins`, `required_pull_request_reviews`, and `restrictions` are all present).

### Success Criteria:

#### Automated Verification:

- `gh api repos/{owner}/{repo}/branches/main/protection` returns 200 (no longer 404) and lists `ci` + `integration` under `required_status_checks.contexts`

#### Manual Verification:

- A PR with a red `ci` or `integration` check shows a blocked merge button
- A PR with all required checks green (and a red, non-required `e2e`) CAN be merged
- A docs-only PR (only `**/*.md` / `context/**` changed) still runs `ci` + `integration` and is mergeable (confirms no required-check deadlock)

**Implementation Note**: This phase requires repo-admin rights and is applied by the human. After applying, confirm the manual verification above before marking the phase complete.

---

## Testing Strategy

This change has no unit/integration tests of its own — it *is* the test-wiring. Verification is the behavior of CI itself.

### Manual Testing Steps:

1. Open a throwaway branch + PR with a trivial change; confirm `ci`, `integration`, and `e2e` jobs all appear and run.
2. Push a commit that breaks a unit assertion; confirm `ci` goes red and (after Phase 3) the merge button is blocked.
3. Push a commit that breaks an integration assertion; confirm `integration` goes red and blocks merge.
4. Push a commit that breaks the e2e spec; confirm `e2e` goes red, a trace artifact uploads, but merge/deploy are NOT blocked.
5. Open a docs-only PR; confirm the required checks still run and the PR is mergeable (no deadlock).
6. Merge to `main` and confirm `deploy` runs only when `ci` + `integration` are green.

## Performance Considerations

- The `integration` and `e2e` jobs each cold-pull Supabase Docker images (~1–3+ min) every run because `ubuntu-latest` (24.04) no longer pre-caches them. This is the known long pole. **Image caching is deferred** (see "What We're NOT Doing") — record the actual cold-pull wall-clock during Phase 1/2 manual verification to size the follow-up.
- `e2e` additionally pays the `playwright install --with-deps chrome` download each run and is serialized (`workers: 1` in CI) with 2 retries — the slowest job by design, which is why it's non-blocking.

## Migration Notes

- Branch protection (Phase 3) is a one-time, human-applied repo-settings change requiring admin rights. Repo confirmed `SzymonSwiatek/PlantsInventory` (live `git remote -v`; `wrangler.jsonc`/`package.json` still carry the starter name, so do not derive the slug from them). The `PUT /branches/{branch}/protection` endpoint requires **all four** top-level keys present in the body (each nullable) — a body with only `required_status_checks` returns 422 — and array fields don't encode via `gh api -f`, so pass the JSON on stdin with `--input -`. Run verbatim:

  ```bash
  gh api --method PUT \
    -H "Accept: application/vnd.github+json" \
    repos/SzymonSwiatek/PlantsInventory/branches/main/protection \
    --input - <<'JSON'
  {
    "required_status_checks": { "strict": false, "contexts": ["ci", "integration"] },
    "enforce_admins": false,
    "required_pull_request_reviews": null,
    "restrictions": null
  }
  JSON
  ```

  `strict: false` is chosen for the solo-dev MVP (no forced rebase/re-run when `main` moves; see plan-review F5). Flip to `true` if you later want "branch up to date before merge". `e2e` is deliberately omitted from `contexts` (non-blocking).
- No data migration. No rollback complexity beyond reverting the `ci.yml` edits and removing branch protection.

## References

- Related research: `context/changes/testing-quality-gates-wiring/research.md`
- Seed: `context/foundation/test-plan.md` §3 Phase 4, §5 Quality Gates, §6.1–§6.3 cookbook
- Current CI: `.github/workflows/ci.yml:13-48`
- Integration runtime contract: `tests/integration/globalSetup.ts:16,21-43`
- e2e Chrome channel + warm-up: `playwright.config.ts:43`, `tests/e2e/global-setup.ts`
- GoTrue rate limit: `supabase/config.toml:191`
- Deploy keeps Worker secrets: `context/changes/deployment/deployment-plan.md:289-290`
- Prior deferrals to this phase: `context/archive/2026-06-14-ai-parse-unit/plan.md:84,414`, `context/archive/2026-06-17-auth-boundary-integration/plan.md:88-89`, `context/archive/2026-06-18-ai-outage-resilience/plan.md:91-92`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Unit + integration gate

#### Automated

- [x] 1.1 Workflow YAML is valid and parses (actionlint / GitHub accepts the push)
- [x] 1.2 `npm run test:run` passes locally
- [x] 1.3 `npm run test:integration` passes locally against running Supabase
- [ ] 1.4 On a test PR, `ci` runs the unit step and `integration` runs the suite — both report status checks

#### Manual

- [ ] 1.5 A test PR breaking a unit assertion turns the `ci` check red
- [ ] 1.6 A test PR breaking an integration assertion turns the `integration` check red
- [ ] 1.7 The `integration` job cold-starts Supabase within acceptable wall-clock (note cold-pull duration)
- [ ] 1.8 A push to `main` with a red integration run does NOT trigger `deploy`

### Phase 2: Non-blocking e2e job

#### Automated

- [ ] 2.1 Workflow YAML still parses with the new `e2e` job
- [ ] 2.2 `npm run test:e2e` passes locally against running Supabase
- [ ] 2.3 On a test PR, the `e2e` job runs and reports a distinct status check

#### Manual

- [ ] 2.4 The `e2e` job installs system Chrome and the spec runs to completion in CI
- [ ] 2.5 A red `e2e` run does NOT block the merge button or `deploy`
- [ ] 2.6 On an induced e2e failure, the trace artifact is uploaded and downloadable

### Phase 3: Branch protection on `main`

#### Automated

- [ ] 3.1 `gh api …/branches/main/protection` returns 200 and lists `ci` + `integration` as required checks

#### Manual

- [ ] 3.2 A PR with a red `ci` or `integration` check shows a blocked merge button
- [ ] 3.3 A PR with required checks green and a red non-required `e2e` CAN be merged
- [ ] 3.4 A docs-only PR still runs `ci` + `integration` and is mergeable (no deadlock)
