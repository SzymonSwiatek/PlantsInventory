<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Watering Reminder Loop

- **Plan**: context/changes/watering-reminder-loop/plan.md
- **Scope**: All 5 phases
- **Date**: 2026-06-21
- **Verdict**: NEEDS ATTENTION → resolved (both warnings fixed; observations skipped per plan)
- **Findings**: 0 critical, 2 warnings, 2 observations
- **Triage (2026-06-21)**: F1 FIXED · F2 FIXED (Fix A) · F3 SKIPPED · F4 SKIPPED

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated criteria re-run clean: `npx astro sync` ✅ · `npm run lint` ✅ (0 errors, 7 intentional `console` warnings in cron logging) · `npm run test:run` ✅ 126 passed (14 files) · `npm run build` ✅. (`npx supabase db reset` not re-run — needs Docker; plan marks its manual checks done.)

## Findings

### F1 — Unescaped user input in digest email HTML (XSS)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/reminders/email.ts:31
- **Detail**: `composeDigest` interpolates user-controlled `p.name` and `p.locationName` raw into the HTML body (`` `<li><strong>${p.name}</strong> &mdash; ${p.locationName}…` ``). Plant/location names are free-text user input (created via /api/plants, /api/locations) and are not sanitized. A plant named `<img src=x onerror=...>` renders as live HTML in the recipient's inbox. The `text` branch (line 19) and numeric `daysOverdue` are safe; only the HTML branch is exposed. Self-targeted today, but cross-user once a location/account is ever shared. `today.astro` / `dashboard.astro` render the same names safely via Astro auto-escaping — email is the one raw-HTML sink.
- **Fix**: Add a small `escapeHtml()` helper in email.ts and wrap `p.name` / `p.locationName` before interpolation into the HTML string; leave the text branch as-is. Add a composeDigest test asserting entities are escaped.
  - Strength: Removes the injection class at the only HTML sink; few-line, self-contained, no API impact.
  - Tradeoff: Minor — one helper + two call sites + a test.
  - Confidence: HIGH — names are confirmed free-text user input; sink is a raw template literal.
  - Blind spot: None significant.
- **Decision**: FIXED — added escapeHtml() helper, wrapped p.name/p.locationName, added escaping test (7/7 pass)

### F2 — ESLint reminder boundary narrower than planned contract

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence (architectural enforcement)
- **Location**: eslint.config.js:71-88
- **Detail**: Plan (Phase 2 §2 / Critical Details) specified the lint zone forbid importing `@/lib/reminders/**` from ANY path outside `src/lib/reminders/**`. The shipped `reminderBoundaryConfig` is narrower on two axes: (a) it restricts only `service-client*`, not all `reminders/**` modules; (b) it applies only to files matching `src/pages/**` and `src/middleware.ts`. The dangerous case is covered — the RLS-bypassing service client cannot be imported from a request handler today, and worker.ts only imports `type ReminderEnv` (erased). Gap: a future request-reachable module added elsewhere (e.g. a new `src/lib/*` helper imported by an endpoint) could import the service client without lint catching it. Intent met today; durable guardrail weaker than designed.
- **Fix A ⭐ Recommended**: Broaden the restricted zone to all of `src/**` with an exception for `src/lib/reminders/**`, keeping/widening the pattern to `@/lib/reminders/service-client*`.
  - Strength: Restores the plan's "boundary everywhere outside reminders/" intent; catches the future-leak case the current globs miss.
  - Tradeoff: Slightly broader rule; verify no false-positive on reminders/-internal imports (the exception handles this).
  - Confidence: HIGH — no-restricted-imports supports this; the dangerous module is well-identified.
  - Blind spot: Haven't confirmed any non-page/non-middleware file legitimately needs the service client (none found).
- **Fix B**: Document the narrowing as an accepted deviation in the plan.
  - Strength: Zero code churn; the truly dangerous path is already protected.
  - Tradeoff: Leaves the weaker guardrail; relies on review to catch a future cross-boundary import.
  - Confidence: MEDIUM — depends on future contributors not adding a request-reachable importer.
  - Blind spot: Stakeholders expecting the planned full boundary.
- **Decision**: FIXED via Fix A — broadened restricted zone to src/** with a src/lib/reminders/** exception; added allowTypeImports so worker.ts's type-only ReminderEnv import stays legal. Lint clean (0 errors).

### F3 — Unbounded due-plants query in cron

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Performance
- **Location**: src/lib/reminders/scheduled.ts:17-23
- **Detail**: The tick loads every due-and-not-snoozed plant in one query with no `.limit()`/cursor, then groups in memory. The plan's Performance section explicitly accepts small scale, so this matches intent — flagged only so the unbounded-fetch assumption is conscious.
- **Fix**: None required now. Add `.limit()` + cursor pagination if the table grows toward Worker memory/time limits.
- **Decision**: SKIPPED — matches plan's accepted small-scale assumption.

### F4 — Undo does a per-plant UPDATE loop

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Performance
- **Location**: src/pages/api/plants/water-undo.ts:77-94
- **Detail**: Undo issues one UPDATE per plant (up to MAX_BULK=200 round-trips) because each plant's restored `last_watered_at` differs. Correct and commented; an N-query pattern not seen elsewhere (other endpoints use single bulk statements). Acceptable given per-row values differ.
- **Fix**: None required. Could collapse to one CASE/UPSERT statement later if 200 round-trips becomes a concern.
- **Decision**: SKIPPED — correct and acceptable; per-row restored values differ.
