# Wire the Test Step into CI and Lock unit + integration as a Required Gate — Plan Brief

> Full plan: `context/changes/testing-quality-gates-wiring/plan.md`
> Research: `context/changes/testing-quality-gates-wiring/research.md`

## What & Why

Turn the three already-built, locally-runnable test suites (unit, integration, e2e) into enforced CI quality gates. This is test-plan §3 **Phase 4 — Quality-gates wiring**: "Add the test step to CI and lock unit + integration as a required gate." Today CI runs only `lint → build → check-dist`; the suites the prior three phases shipped are never run in CI and PRs can merge red. This phase closes that gap.

## Starting Point

`.github/workflows/ci.yml` has a `ci` job (lint/build/check-dist, no tests) and a push-only `deploy` job (`needs: ci`). The suites run locally only: unit (`npm run test:run`, Docker-free, 22 files), integration (`npm run test:integration`, needs Docker + Supabase + booted `astro dev`, 5 files), e2e (`npm run test:e2e`, needs system Chrome). `main` is unprotected — `branches/main/protection` returns 404.

## Desired End State

Every PR and non-docs push runs unit (in `ci`) + the full integration suite (own Docker job); a red unit/integration run blocks the push-to-main deploy; `main` is branch-protected with `ci` + `integration` as required checks so PRs can't merge red; a separate **non-blocking** e2e job surfaces add-plant UI-fallback regressions and uploads a trace on failure.

## Key Decisions Made

| Decision           | Choice                                          | Why (1 sentence)                                                              | Source   |
| ------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------- | -------- |
| Unit placement     | Fold `npm run test:run` into the `ci` job       | Cheapest path; unit is hermetic so no extra runner needed                    | Plan     |
| Integration job    | Own Docker job, every PR + push, no path filter | Docker isolation required; no path filter avoids the docs-only deadlock      | Plan     |
| Deploy gating      | `deploy.needs: [ci, integration]`               | Load-bearing edit that makes the gate real for production                    | Plan     |
| e2e                | Separate **non-blocking** job                   | Gives UI-fallback signal without letting Chrome/warm-up flake block shipping | Plan     |
| Branch protection  | Document `gh` commands; human applies           | Needs admin rights; human-in-the-loop is safest and auditable               | Plan     |
| Image caching      | Defer to a follow-up                            | Not a gate requirement; measure real cold-pull cost first                    | Research |
| Supabase CLI in CI | Lockfile-driven `setup-cli@v2` (no `version:`)  | Keeps `setup-cli` in lockstep with the `supabase` devDep                     | Research |

## Scope

**In scope:** unit folded into `ci`; new `integration` Docker job; `deploy.needs` gating; non-blocking `e2e` job + trace artifact; branch-protection required checks on `main`.

**Out of scope:** Docker image caching (follow-up); blocking e2e gate; any production code or test-config changes; automating branch protection.

## Architecture / Approach

Mirror the suites' cost/isolation structure in job topology. The fast Docker-free `ci` job absorbs unit. A dedicated `integration` job is the only one that brings up Docker + Supabase (`setup-cli@v2` → `supabase start` → `test:integration`). A third `e2e` job (own runner) additionally installs system Chrome. Integration and e2e **must be separate jobs** because both clobber the repo-root `.dev.vars`. Deploy gating is one `needs:` edit; branch protection is the out-of-YAML half applied via `gh api`.

## Phases at a Glance

| Phase                          | What it delivers                                        | Key risk                                                              |
| ------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------- |
| 1. Unit + integration gate     | Unit in `ci` + Docker `integration` job + deploy gating | Supabase Docker cold-pull time/flake on `ubuntu-latest`              |
| 2. Non-blocking e2e job        | Separate Chrome e2e job + trace-on-failure artifact     | Chrome install + dev-server warm-up flake (mitigated by non-blocking) |
| 3. Branch protection on `main` | Required status checks (`ci`, `integration`)            | Wrong check-context names; needs repo-admin rights                   |

**Prerequisites:** repo-admin rights for Phase 3; Docker locally to verify integration/e2e; confirm the live GitHub remote (`wrangler.jsonc`/`package.json` still carry the starter name).
**Estimated effort:** ~1–2 sessions across 3 phases — mostly YAML plus one manual settings change and several CI verification round-trips.

## Open Risks & Assumptions

- Supabase Docker cold-pull (~1–3+ min/run) is tolerated until the caching follow-up; assumes the wall-clock is acceptable for now.
- Branch-protection check-context names must exactly match the emitted job names (`ci`, `integration`); e2e is deliberately excluded.
- Assumes `pull_request` keeps no `paths-ignore` and the test jobs add none — the basis for avoiding the required-check deadlock on docs-only PRs.

## Success Criteria (Summary)

- A PR that breaks a unit or integration assertion goes red and cannot be merged.
- A push to `main` with a red suite does not deploy.
- A red e2e run reports (with a downloadable trace) but blocks nothing; a docs-only PR still runs the required checks and stays mergeable.
