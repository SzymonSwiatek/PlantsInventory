<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Wire Test Step into CI / Lock unit+integration Gate

- **Plan**: context/changes/testing-quality-gates-wiring/plan.md
- **Scope**: Phases 1–3 of 3 (all complete)
- **Date**: 2026-06-30
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Verification performed

- **Unit** (`ci` job step `npm run test:run`): 23 files, 230 tests pass.
- **Integration** (`integration` job `npm run test:integration`): 5 files, 35 tests pass against live local Supabase. The `[vite] Invalid hook call` log lines are a pre-existing SSR warning from an error-path test rendering `SignInForm` server-side; all tests pass and it is unrelated to this change.
- **Branch protection**: `GET …/branches/main/protection` returns 200 with `required_status_checks.contexts = ["ci","integration"]`, `strict:false`, `enforce_admins:false`; `e2e` correctly excluded.
- **Gate exercised for real**: intentional break/revert commits `ce40cd7` → `a1e5b7c` net to zero, evidencing a genuine red→green gate test.
- **`ci.yml` diff** matches the plan contract step-for-step; the `deploy` job changed only its `needs:` line (`ci` → `[ci, integration]`).
- **No production-code changes**: the only source-tree edit is the documented e2e locator fix (F1).

## Findings

### F1 — e2e spec locator edited (outside "No new test files" guardrail)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; nothing to fix
- **Dimension**: Scope Discipline
- **Location**: tests/e2e/add-plant-ai-outage.spec.ts:33 (commit 428f285)
- **Detail**: The plan's "What We're NOT Doing" says "No new test files... this wires the existing npm run scripts." Phase 2 also edited an existing spec: `getByLabel("Photo")` → `getByLabel("Photo", { exact: true })`. The commit message documents why — the form now has a second input labeled "Take photo", so the non-exact locator hit a Playwright strict-mode collision and the spec could not go green (criterion 2.2). This is a modification (not a new file), necessary to satisfy the phase's own green-suite criterion, well-documented, and `{ exact: true }` is exactly the disambiguation CLAUDE.md's E2E locator guidance prescribes. Benign and correct.
- **Fix**: None needed — accept as a justified, documented deviation.
- **Decision**: ACCEPTED (no action — justified deviation)

### F2 — upload-artifact gained `retention-days: 7` beyond the contract

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; nothing to fix
- **Dimension**: Scope Discipline
- **Location**: .github/workflows/ci.yml:66
- **Detail**: The Phase 2 contract specified `actions/upload-artifact@v4` with `if: failure()` uploading `playwright-report/` + `test-results/`. The implementation adds `retention-days: 7`, which the contract did not mention. This is a sensible, cost-conscious default (traces expire instead of accruing storage) and changes nothing about gate behavior.
- **Fix**: None needed — benign improvement; keep as-is.
- **Decision**: ACCEPTED (no action — benign improvement)

## Notes on items deliberately not flagged

- **`supabase/setup-cli@v2` left unpinned (no `version:`)** — matches the plan's intent. CLI-version lockstep holds regardless, because in CI `npx supabase` resolves the `npm ci`-installed `supabase@^2.23.4` from `node_modules` ahead of anything `setup-cli` puts on PATH. The integration job is verified green.
- **`deploy` build step has no `SUPABASE_*`** — intentional per the plan (Worker keeps secrets across `wrangler deploy`); only the `needs:` line changed, as specified.
