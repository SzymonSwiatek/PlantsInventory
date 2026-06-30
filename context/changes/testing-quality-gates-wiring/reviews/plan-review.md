<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Wire the Test Step into CI and Lock unit + integration as a Required Gate

- **Plan**: context/changes/testing-quality-gates-wiring/plan.md
- **Mode**: Deep
- **Date**: 2026-06-30
- **Verdict**: REVISE → SOUND after triage (all 5 findings resolved 2026-06-30)
- **Findings**: 1 critical · 2 warnings · 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | FAIL |

## Grounding

9/9 paths ✓, symbols ✓ (scripts/check-dist-config.mjs, supabase@^2.23.4 devDep, @playwright/test@^1.61.0), live remote confirmed `SzymonSwiatek/PlantsInventory`, `branches/main/protection` returns 404 ✓, brief↔plan consistent. `docs/reference/contract-surfaces.md` absent (contract-surface check skipped). `lessons.md` prior (CSRF guards) not relevant to CI wiring.

## Findings

### F1 — Phase-body Success Criteria use `- [ ]` checkboxes (Progress-contract violation)

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phases 1–3, "Success Criteria" blocks (lines 107–118, 151–159, 185–191)
- **Detail**: The `#### Automated/Manual Verification:` lists in the phase bodies use `- [ ]` checkboxes — 18 lines outside the `## Progress` section. The Progress-format contract (and this skill's mechanical check) require phase blocks to hold plain `- ` bullets only: `## Progress` is the single source of execution state and `/10x-implement` derives "next pending step = first `- [ ]` in document order." Checkboxes in the phase bodies make that parse hit line 107 (a Success Criterion) instead of Progress step 1.1, so step tracking/SHA-suffixing target the wrong lines. Evidence: the successfully-implemented `context/archive/2026-06-18-ai-outage-resilience/plan.md` uses plain `- ` bullets in the same Success Criteria position (line 220) — zero `- [ ]` outside its Progress section. The `## Progress` block here (lines 235–276) is already correctly formed with `- [ ] N.M` mirrors.
- **Fix**: Convert the 18 phase-body `- [ ]` lines (107–118, 151–159, 185–191) to plain `- ` bullets. Leave the `## Progress` section untouched.
- **Decision**: FIXED — converted all 18 phase-body checkboxes to plain bullets; `## Progress` untouched.

### F2 — Branch-protection PUT payload underspecified (will 422 if minimal)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 3 + Migration Notes (lines 179, 217)
- **Detail**: Phase 3 defers the exact `gh api -X PUT …/branches/main/protection` payload to "implementation time" and only names `required_status_checks.contexts`. That endpoint requires ALL of `required_status_checks`, `enforce_admins`, `required_pull_request_reviews`, and `restrictions` to be present (each may be null) — a body with only `required_status_checks` returns 422. Array fields also don't encode cleanly via `gh api -f`; they need a piped JSON body (`--input -`). An implementer following the plan verbatim is likely to hit a 422 and iterate blind. `{owner}/{repo}` — flagged unconfirmed in the plan — is confirmed `SzymonSwiatek/PlantsInventory` (live remote); protection is 404 today.
- **Fix ⭐**: Capture the full verbatim command in Migration Notes now — `gh api --method PUT repos/SzymonSwiatek/PlantsInventory/branches/main/protection --input -` with a heredoc JSON body including `required_status_checks {strict, contexts:["ci","integration"]}`, `enforce_admins`, `required_pull_request_reviews`, `restrictions` (null where unused). Decide `strict` explicitly (see F5).
  - Strength: Implementer runs it once, no 422 round-trips; payload is auditable in the plan.
  - Tradeoff: Pins a payload that may need a tweak if GitHub's required keys shift — low risk, stable API.
  - Confidence: HIGH — the 4-required-keys rule is long-standing; remote + 404 verified this session.
  - Blind spot: None significant.
- **Decision**: FIXED — added verbatim `gh api --method PUT … --input -` heredoc with all four required keys to Migration Notes; updated Phase 3 Contract to warn against a minimal body. Also resolves F5 (strict: false chosen).

### F3 — No `timeout-minutes` on the Docker jobs

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 (integration job) + Phase 2 (e2e job)
- **Detail**: The new `integration` and `e2e` jobs cold-pull Supabase images and boot `astro dev` (90s/120s internal waits) but set no `timeout-minutes`. If `supabase start` hangs on a flaky pull or the dev server never reaches ready, the job rides GitHub's default 6-hour timeout — burning CI minutes and leaving a PR check spinning. The plan emphasizes cold-pull cost but doesn't bound a stuck run.
- **Fix**: Add `timeout-minutes:` to the `integration` (~20) and `e2e` (~25) jobs so a hung pull/boot fails fast and visibly.
- **Decision**: FIXED — added `timeout-minutes: 20` (integration) and `25` (e2e) to the job contracts.

### F4 — e2e re-runs on push-to-main yet gates nothing

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 2 — `e2e` job triggers
- **Detail**: The `e2e` job inherits the workflow triggers (every PR + non-docs push). It already ran on the PR; running it again on the subsequent push to `main` re-pays the slowest cost (Supabase cold-pull + Chrome install + serialized run with 2 retries) while gating neither deploy nor merge. `integration` legitimately must run on push (deploy depends on it); e2e does not.
- **Fix**: Optionally scope `e2e` to `if: github.event_name == 'pull_request'` so it gives PR signal without re-running on main. Keep no `paths` filter (deadlock rule).
- **Decision**: DISMISSED — keeping e2e on main pushes too; the main-branch UI-fallback signal is worth the cost.

### F5 — `strict` branch protection asserted "per preference" with no recorded decision

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 (line 179) — "with `strict` per preference"
- **Detail**: The plan sets `required_status_checks.strict` "per preference" but no decision in the brief's table records it. `strict: true` (require branch up to date before merge) forces a rebase + re-run on every PR when `main` moves — meaningful friction and extra CI cost for a solo-dev MVP, for little safety benefit at this team size.
- **Fix**: Decide explicitly — recommend `strict: false` for an MVP unless the up-to-date guarantee is wanted. Fold the choice into F2's verbatim payload.
- **Decision**: FIXED — `strict: false` confirmed and written into the F2 Migration Notes payload.
