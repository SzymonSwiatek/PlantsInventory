<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Domain Schema with RLS (F-02)

- **Plan**: context/changes/domain-schema-with-rls/plan.md
- **Scope**: Full plan — Phases 1–3 of 3
- **Date**: 2026-06-08
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 0 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Summary

Faithful, high-quality implementation of an already plan-reviewed plan. Every planned object exists and matches intent; no unplanned source files; all "What We're NOT Doing" boundaries respected. Two details came out _better_ than planned:

- The same-user FK guards use `is distinct from new.user_id`, comparing the parent's actual owner — so they reject cross-user attaches even if RLS were disabled on the parent, not only via RLS invisibility as the plan described (migration lines 127, 146).
- Trigger functions set `search_path = ''` and schema-qualify (`public.locations` / `public.plants`) — hardening the plan didn't specify.

### Success Criteria verification

- Live: `astro sync`, `npm run lint` (0 errors), `npm run build` all pass; generated `src/db/database.types.ts` excluded from both ESLint (flat-config `ignores`) and Prettier (`.prettierignore`).
- Static (not live `db reset`): the DB-introspection checks (1.2 RLS on all three tables, 1.3 ≥4 policies/table, 2.2 private bucket, 2.3 four storage policies) were verified by reading the migration DDL — the `supabase` CLI isn't on PATH and a reset needs a multi-minute Docker image pull. The SQL plainly satisfies each; the plan records them passing under commits `ee2f94b` / `d1d2b85`.

## Findings

### F1 — plants.name lacks the length/non-empty check locations.name has

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20260608171954_core_domain_schema.sql:31 (locations) vs :49 (plants)
- **Detail**: `locations.name` carries `check (char_length(btrim(name)) between 1 and 100)`, but `plants.name` is a bare `text not null` with no length or non-empty guard — an empty-string or oversized plant name is accepted at the DB layer. This matches the plan exactly (Phase 1 specifies the check only on locations.name), so it is NOT implementation drift — it's a plan design choice surfaced here so it's deliberate rather than an accidental gap. The slices that write plants (S-01 create, S-03 edit) will need to own this validation if the DB doesn't.
- **Fix**: Confirm the asymmetry is intentional. If plant names should be constrained too, add a parallel `check (char_length(btrim(name)) between 1 and 100)` to plants.name in a follow-up migration; otherwise note that plants.name validation lives at the S-01/S-03 app layer so it isn't silently dropped.
- **Decision**: FIXED — added follow-up migration `supabase/migrations/20260608182949_plants_name_check.sql` with a named `plants_name_check` constraint mirroring `locations.name`.
