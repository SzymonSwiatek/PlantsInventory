<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Location Management (S-02)

- **Plan**: context/changes/location-management/plan.md
- **Scope**: All 3 phases (full plan)
- **Date**: 2026-06-19
- **Verdict**: APPROVED (with one minor warning)
- **Findings**: 0 critical, 1 warning, 2 observations
- **Automated gates**: build ✅ · lint ✅ · tests 61/61 ✅

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — DELETE swallows the photo-path select error → silent orphans

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/pages/api/locations/[id].ts:66
- **Detail**: The path-collection query destructures only `data`, not `error` (`const { data: plants } = await supabase.from("plants").select("photo_path").eq("location_id", id)`). If that select fails transiently, `plants` is null → `paths` becomes `[]` → the location is deleted anyway → every plant photo is orphaned in Storage with no trace (paths are unrecoverable after the cascade). The collect→delete→remove ordering is otherwise correct, and the delete error IS checked (lines 70-77) — only the *collect* step fails silently. Orphans are a cleanup nuisance, not a correctness bug, but the plan's best-effort cleanup guarantee is silently lost.
- **Fix**: Destructure the select `error` and at minimum log it (matching the `console.error` style at line 75) so the orphan is traceable; optionally bail with 500 before the delete to preserve retry.
- **Decision**: FIXED — destructure plantsError and log via console.error (matching line 75 style)

### F2 — Foreign / missing id returns 200, not 404

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/locations/[id].ts:36-44, 69-81
- **Detail**: Under RLS, update/delete on an id the user doesn't own report success with zero rows affected, so the endpoint returns `200 {id}`. No data leak and no cross-user write — this is the documented design and matches `upload-url.ts`'s stance — but a 200 on a no-op is slightly misleading. The plan explicitly accepts this ("an update affecting zero rows is not an error"), so it's noted, not flagged.
- **Fix**: None required — accepted by plan. If stricter semantics are wanted later, check the affected-row count and return 404 when zero.
- **Decision**: SKIPPED

### F3 — Plant count rendered as plain text span, not a styled badge

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Adherence
- **Location**: src/pages/dashboard.astro:71
- **Detail**: The plan's prose says "render the number ... as a badge"; the implementation uses a plain text span ("N plants"). The contract line itself only required rendering the number, which is met. Purely cosmetic — noted for completeness.
- **Fix**: None required. Wrap the count span in a badge style if visual emphasis is desired.
- **Decision**: SKIPPED

## Notes

- Post-plan fix 24744e5 ("make full row clickable") only added `flex-1 self-stretch` to the existing anchor — the actions island stays a SIBLING of the `<a>`. No `<button>`-in-`<a>` regression; the Phase 3 accessibility constraint holds.
- Phase 2 §1 refactor (`UUID_RE` / `CLIENT_ERROR_CODES` → `@/lib/api`) is a clean move; both consumers import the shared source.
- `removePhotos` is genuinely best-effort (never throws); DELETE correctly bails before photo removal if the row delete fails.
- All planned changes verified MATCH — no DRIFT, MISSING, or EXTRA source files.
