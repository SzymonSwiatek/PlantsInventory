<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Watering Interval +/− Stepper Buttons

- **Plan**: context/changes/watering-interval-buttons/plan.md
- **Scope**: Full plan (Phase 1 & 2 of 2)
- **Date**: 2026-06-23
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Automated checks (re-run during review)

- `npm run test:run` (number-stepper.test.ts) — 15/15 pass
- `npx astro sync && npm run lint` — 0 errors (8 pre-existing warnings in `reminders/scheduled.ts` + `worker.ts`, unrelated)
- `npm run build` — Complete (6.64s)
- Manual checks 2.4–2.7 marked `[x]` in Progress against commit cb4634a.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — NumberStepper deviates from shadcn-ui sibling conventions

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/ui/number-stepper.tsx:10-34
- **Detail**: Sibling ui components (button.tsx:47, input.tsx:9) extend `React.ComponentProps<"…">`, spread `{...props}`, and set `data-slot="…"` on their root. NumberStepper instead declares a closed bespoke interface forwarding only a hand-picked prop subset (id/placeholder/autoFocus/disabled/onKeyDown) and its root `<div>` has no `data-slot`. The closed interface is defensible for a composite component, but it can't accept native attrs (name, aria-describedby, onBlur) without code changes, and the missing data-slot makes it invisible to any slot-keyed styling/tests.
- **Fix**: Add `data-slot="number-stepper"` to the root `<div>` for parity; optionally widen the prop interface to spread remaining native input attributes. Both low-risk, additive.
- **Decision**: FIXED — added `data-slot="number-stepper"` to root div (skipped optional prop-widening; no call site needs it).

### F2 — Domain-specific aria-labels on a generically-named component

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/ui/number-stepper.tsx:41,71
- **Detail**: aria-labels are hardcoded "Decrease/Increase watering interval" while the component is otherwise generic (generic name, min, placeholder props). Accurate today (single consumer pair), but a future reuse on another numeric field would announce the wrong label. The plan explicitly scoped this to watering-only, so this is consistent with intent.
- **Fix**: If generalized later, accept decrementLabel/incrementLabel (or a unit prop) instead of hardcoding. Fine to defer.
- **Decision**: SKIPPED — scoped watering-only today; labels accurate as-is.

### F3 — Free-typed non-integer input silently resets on increment

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/ui/number-stepper.tsx:49-57
- **Detail**: The inner Input forwards `e.target.value` verbatim, but the helper only treats `/^\d+$/` as numeric. If a user types "7.5"/"-3"/"1e3", the + button resets to min (discarding the typed value) and − is disabled. Internally consistent, and both call sites re-validate before persisting (AddPlantForm.tsx:223-227, EditableField.tsx:87-92), so no bad value reaches the API. Acceptable for MVP — matches the plan's clamp rules.
- **Fix**: None needed. Could note the reset behavior in a code comment.
- **Decision**: SKIPPED — behavior correct and guarded downstream (also documented via F4's JSDoc).

### F4 — Missing JSDoc relative to sibling helper

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/number-stepper.ts:1-11
- **Detail**: Sibling src/lib/ai-suggestion.ts documents its normalization rules with a JSDoc block. number-stepper.ts has none, despite the non-obvious "non-numeric input → min on increment" rule.
- **Fix**: Add a short doc comment on `stepValue` describing the empty / non-numeric / clamp behavior.
- **Decision**: FIXED — added JSDoc on `stepValue` covering empty / non-numeric / clamp rules.
