<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Plant Management (S-03)

- **Plan**: context/changes/plant-management/plan.md
- **Scope**: All 4 phases
- **Date**: 2026-06-19
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success criteria verified independently: lint clean, production build succeeds, 79/79 unit tests pass (including both photo_path-cleanup branches and the ai_suggestion/user_id-ignored assertions).

## Findings

### F1 — PATCH photo_path skips the owner-prefix check the create endpoint enforces

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/plants/[id].ts:89-91
- **Detail**: The create endpoint enforces defense-in-depth: `index.ts:49` rejects any `photoPath` that doesn't start with `${user.id}/`. The PATCH handler accepts any string into `photo_path` via `emptyToNull` with no validation. RLS protects the row (a user can only PATCH their own plant) but does not validate the *contents* of `photo_path` — a user could point their own plant's `photo_path` at another tenant's object key. The detail page then mints a signed read URL for it; Storage read-RLS gates on the first path segment so the mint most likely fails and falls back to a placeholder, but that fallback is currently the only barrier and contradicts the sibling endpoint's own "never trust the client" guard.
- **Fix**: Mirror `index.ts:49` in the PATCH handler — when `photo_path` is present, reject a value that doesn't start with `${user.id}/` (400 `invalid_photo_path`) before building the update.
  - Strength: One-line change; restores parity with the create endpoint's explicit guard; stops relying on Storage RLS as the sole barrier.
  - Tradeoff: Minimal — the photo-replace client always PATCHes a minted path that already begins with the uid, so no legitimate flow breaks.
  - Confidence: HIGH — identical, proven pattern at index.ts:49.
  - Blind spot: Haven't confirmed Storage read-RLS actually denies a cross-prefix signed-URL mint; the fix makes that moot.
- **Decision**: FIXED

### F2 — winterization_cutoff isn't date-validated; a bad date 500s instead of 400

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/plants/[id].ts:77-79
- **Detail**: The plan specified "winterization_cutoff a date string or null; a present-but-invalid value → 400." The handler only runs `emptyToNull`, so a malformed date string reaches Postgres and surfaces as SQLSTATE 22007 (invalid_datetime_format), which is not in `CLIENT_ERROR_CODES` ({23514, 23503, 42501}) → the user gets a 500, not a 400. Reachable only via direct API calls; the island uses a native date input that constrains the value, so the UI path is unaffected.
- **Fix**: Add a lightweight ISO-date check (or add "22007" to CLIENT_ERROR_CODES) so an invalid winterization date maps to 400.
- **Decision**: FIXED

## Notes

- Plan adherence is exact — every Phase 1–4 requirement is MATCH with file:line evidence; no DRIFT / MISSING / EXTRA. Two intentional refinements (Enter-to-save only on text/number, not textarea/select; photo refresh swaps to the local blob preview) are correct, not drift.
- Scope is clean — every "What We're NOT Doing" boundary is respected (no reminder logic, soft-delete, gallery, journaling, ai_suggestion writes, new fields, or create-flow changes). Six changed source files, all in the plan; zero unplanned files.
