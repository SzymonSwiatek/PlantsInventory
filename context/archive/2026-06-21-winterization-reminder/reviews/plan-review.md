<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Winterization Reminder Implementation Plan

- **Plan**: context/changes/winterization-reminder/plan.md
- **Mode**: Deep
- **Date**: 2026-06-22
- **Verdict**: REVISE → SOUND after fixes (all 3 findings fixed 2026-06-22)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

9/9 paths ✓, 4/4 symbols ✓ (`winterization_cutoff`, `winterized_at`, `'winterize'` enum, `care_events` FK-trigger), brief↔plan ✓, Progress↔Phase mechanically consistent (1.1–4.7 all map). The plan mirrors a real, shipped watering loop (`scheduled.ts`, `email.ts`, `water.ts`, `water-undo.ts`, `today.astro`, `TodayList.tsx` all confirmed).

## Findings

### F1 — Feb-29 cutoff makes make_date() abort the whole view query (cron-wide)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details (leap-day edge) + Phase 1 view
- **Detail**: The plan computes `make_date(year(now), month(cutoff), day(cutoff))` and accepts Feb-29 as a "documented out-of-scope edge … do not add clamping." But `make_date(2027, 2, 29)` doesn't mis-handle one row — it raises "date field value out of range" and aborts the entire SELECT. Blast radius is wider than the plan implies: (1) the cron (service-role) scans ALL users' rows in one query, so a single user with a Feb-29 cutoff throws → the winterization query errors → following the existing watering pattern (`scheduled.ts:25-28`, which `return`s on query error) winterization is killed for every user that tick; (2) the cutoff is AI-suggested (`suggest.ts`) and user-editable with no validation forcing an autumn date, so the value isn't guaranteed "impossible." Probability is low; the failure mode (cross-user, silent until someone notices no winter emails) is not.
- **Fix A ⭐ Recommended**: Build the date without make_date's throw
  - Strength: Compute `this_year_cutoff` via date arithmetic that can't raise — e.g. `make_date(yr, month, 1) + (day-1) * interval '1 day'`, cast back to date. Feb-29 in a non-leap year rolls to Mar 1 instead of aborting the query. No row can poison the cron-wide scan; stays entirely inside the view; zero new columns.
  - Tradeoff: A Feb-29 cutoff fires one day "late" (Mar 1) — acceptable vs. killing the whole tick.
  - Confidence: HIGH — make_date's throw-on-invalid is documented Postgres behavior; the interval form is a standard workaround.
  - Blind spot: None significant.
- **Fix B**: Exclude invalid month/day from the view + index predicate
  - Strength: Add `and not (extract(month from winterization_cutoff)=2 and extract(day from winterization_cutoff)=29)` so such rows never reach make_date. Trivially correct.
  - Tradeoff: A Feb-29 plant silently never reminds — invisible to the user, harder to debug than Fix A's roll-forward.
  - Confidence: HIGH.
  - Blind spot: Doesn't generalize if other invalid month/day pairs appear.
- **Decision**: FIXED via Fix A (interval-form date computation; updated Critical Implementation Details predicate + leap-day bullet in plan.md)

### F2 — View needs an explicit GRANT for the session client (first view in repo)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — view migration Contract
- **Detail**: This is the repo's first database view — `grep "create view"` and `grep "grant"` across `supabase/migrations/` both return nothing; every existing table relies on Supabase's default privileges for the authenticated/anon roles. The Phase 1 Contract lists "create view + index + document edges + regenerate types" but never grants SELECT on `winterization_due_plants`. Default privileges on TABLES *do* cover views, so it will likely work — but it's unverified for this project, and the failure mode is silent: `today.astro:10-18` reads `const { data } = …` and ignores `.error`, so a "permission denied for view" degrades to an empty winterization section with no error surfaced, not a visible break.
- **Fix**: Add `grant select on winterization_due_plants to authenticated;` (and `anon` for PostgREST schema completeness) to the migration as cheap insurance, and have the Phase 1 manual check (1.7) confirm the session client actually returns rows — not just that RLS scopes them.
- **Decision**: FIXED in plan (added GRANT SELECT to authenticated, anon in Phase 1 Contract; strengthened manual check 1.7 + Progress 1.7 to verify session-client read)

### F3 — "Run the repo's type-gen step" is underspecified

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1 + Migration Notes
- **Detail**: The plan says "regenerate `src/db/database.types.ts` (run the repo's type-gen step)" but there is no type-gen npm script in `package.json` — grep found none. The command lives only in archived research: `supabase gen types`. An implementer following the plan literally has no command to run; the view stays untyped and `.from("winterization_due_plants")` won't type-check.
- **Fix**: Name the exact command in the Contract, e.g. `npx supabase gen types typescript --local > src/db/database.types.ts` then `npx astro sync` (confirm flag against the archived flow).
- **Decision**: FIXED in plan (named `npx supabase gen types typescript --local > src/db/database.types.ts` + `npx astro sync`, requires `npx supabase start`, in Phase 1 Contract + Migration Notes; confirmed flag against archived domain-schema plan)
