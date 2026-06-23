<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Winterization Reminder

- **Plan**: context/changes/winterization-reminder/plan.md
- **Scope**: All 4 phases (full plan)
- **Date**: 2026-06-23
- **Verdict**: APPROVED (with 2 minor warnings)
- **Findings**: 0 critical, 2 warnings, 2 observations

## Automated criteria

- `npm run test:run` — 158 passed (16 files)
- `npm run lint` — 0 errors (8 pre-existing `no-console` warnings in scheduled.ts/worker.ts)
- `npx astro sync` — clean
- `npm run build` — complete
- `npx supabase db reset` — not re-run (no local Docker stack here); type generation succeeded, which requires the migration to have applied locally during dev. Manual Progress items all checked `[x]` with commit shas.

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

### F1 — `anon` grant on the view contradicts the sign-in-only model

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260622000000_winterization_due.sql:60
- **Detail**: `grant select on winterization_due_plants to authenticated, anon, service_role;`. The grants-fix commit (693c127) that landed alongside this work explicitly excludes `anon` from base-table grants ("anon is intentionally excluded — every route requires sign-in") and that same commit edited this grant line to add `service_role`, yet left `anon`. Not currently exploitable (security_invoker view + anon has no grant on underlying plants/locations, so a direct anon call fails the table-privilege check), but dead/misleading and inconsistent with the deliberate model.
- **Fix**: Drop `anon`: `grant select on winterization_due_plants to authenticated, service_role;`
- **Decision**: FIXED (2026-06-23) — removed `anon` from the grant; added a comment matching the base-table rationale.

### F2 — `today.astro` swallows query `.error` → failure shows as "all caught up"

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/today.astro:10-25
- **Detail**: Both the watering and the new winter query destructure only `{ data }` and never inspect `error`. On a transient DB failure (or the view erroring), `data` is null, both lists fall back to `[]`, and the page silently renders the empty state — a false "nothing due." The cron path (scheduled.ts:30) checks and bails; this page does not. Pre-existing watering-query pattern inherited by the winter query; the plan itself (line 71) flagged it as a known swallow.
- **Fix A ⭐ Recommended**: Capture `error` on each query and render a distinct degraded/error state (or at least log it) instead of conflating failure with "nothing due."
  - Strength: Closes a silent-failure gap on a care-reminder page where a false "all caught up" has real user cost.
  - Tradeoff: Touches the watering query too (consistent fix); adds an error UI state not currently in the island.
  - Confidence: HIGH — failure mode confirmed by reading the source.
  - Blind spot: Whether product wants a visible error vs. a silent log.
- **Fix B**: Leave as-is, accept as known pre-existing behavior.
  - Strength: Zero churn; matches the watering pattern and the plan's documented expectation.
  - Tradeoff: Silent-failure gap persists across both lists.
  - Confidence: MED — depends on tolerance for the false-empty state.
  - Blind spot: No observability signal exists today when it fails.
- **Decision**: FIXED via Fix A (2026-06-23) — captured `error` on both queries (`waterError`/`winterError`), and render a degraded amber `role="alert"` banner above the list when either fails, so a failed query is no longer shown as "all caught up."

### F3 — `.order("this_year_cutoff" as never)` cast defeats type-checking

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/today.astro:24
- **Detail**: The order key is cast `as never` because `this_year_cutoff` is used for ordering but not in the `.select(...)` projection. Works (column exists on the view) but suppresses type safety on the key.
- **Fix**: Add `this_year_cutoff` to the select list (or order on `winterization_cutoff`) to drop the cast.
- **Decision**: FIXED (2026-06-23) — added `this_year_cutoff` to the `.select(...)` projection and dropped the `as never` cast, ordering on the now-typed key with `{ ascending: true }`; `WinterPlantRow` gains the field. `tsc --noEmit` clean.

### F4 — Two-table writes are non-atomic; undo loops up to 200 round-trips

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/plants/winterize.ts:38-58 · src/pages/api/plants/winterize-undo.ts:78-94
- **Detail**: `winterize` inserts care_events then updates plants in two statements (no transaction — Supabase JS has none); `winterize-undo` deletes events then updates plants per-row in an unbounded loop (up to MAX_BULK=200 serial queries on workerd). Both mirror water.ts / water-undo.ts exactly — consistent with the codebase, target scale small (PRD), so not a regression. Noted only because the inconsistency window and serial-undo latency are real if scale grows.
- **Fix**: None required now. If revisited, prefer an RPC for atomicity and group same-`priorDoneAt` plants into `.in()` batch updates — but apply to the water endpoints too, out of this slice's scope.
- **Decision**: SKIPPED (2026-06-23) — accepted as-is: mirrors water.ts/water-undo.ts, small PRD scale, and the fix belongs to the water endpoints too (out of this slice's scope).

## Plan adherence notes

All 4 phases MATCH the plan (verified by sub-agent reading each file against the "Changes Required"). No MISSING items. Deviations from literal plan text are beneficial and self-justified:

- `service_role` added to the view grant (required for the cron's service-role query).
- `winterize.ts` correctly omits the `water_snooze_until: null` reset (no winter-snooze concept).
- New `src/components/today/sort.ts` is the "sibling sort" the plan anticipated; pure, non-mutating.
