<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Show the AI-Suggested Indicator Only on Unchanged Fields

- **Plan**: context/changes/ai-suggested-badge-only-on-unchanged/plan.md
- **Scope**: Phases 1–2 of 2
- **Date**: 2026-06-23
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated success criteria verified at review time: `npm run test:run` (168/168 passing),
`npm run lint` (0 errors; 8 warnings, all pre-existing in `reminders/scheduled.ts` and
`worker.ts`, untouched by this change), `npm run build` (succeeds). Manual items 2.4–2.8
checked in the plan's Progress section.

## Findings

### F1 — Indicator was redesigned into a pill badge and dropped the value text

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence / Scope Discipline
- **Location**: src/components/plants/EditableField.tsx:267-270
- **Detail**: The plan's "What We're NOT Doing" explicitly said: "No visual redesign — we keep the existing italic `AI suggested: {value}` text line; no shadcn Badge component is introduced." The Phase 2 contract repeated this ("gate the existing hint line"). The implementation instead replaced `<p class="...italic">AI suggested: {aiHint}</p>` with a styled pill `<span class="...rounded-full border bg-blue-300/10 px-2 py-0.5...">AI suggested</span>` — a visual redesign into a badge — and dropped the `{aiHint}` value so the suggested value is no longer shown. The gating logic matches the plan exactly (live `localValue`, the pure helper, all five fields wired); only the presentation drifted. In practice no information is lost: the badge only renders when the field value still equals the AI value, so the field already shows that value. The change-id ("...badge...") suggests a badge may have been the intent, but it crosses an explicit written guardrail and deserves a conscious decision.
- **Fix A ⭐ Recommended**: Keep the badge; reconcile the plan via an addendum.
  - Strength: Preserves a defensible UX improvement the gating makes possible (value would be redundant); updates the source of truth before it's reused as ground truth.
  - Tradeoff: Plan's "NOT Doing" section becomes a moving target; worth a one-line note explaining the adopted redesign.
  - Confidence: HIGH — behavior verified (build/tests pass, manual items checked); only the doc is out of sync.
  - Blind spot: Whether a stakeholder specifically wanted the value text retained for at-a-glance reference.
- **Fix B**: Revert to the planned italic "AI suggested: {value}" line.
  - Strength: Restores strict plan adherence; no scope argument.
  - Tradeoff: Discards a cleaner presentation; re-introduces value text redundant with the field's own value.
  - Confidence: HIGH — prior markup is in git history.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — addendum added to plan.md documenting the badge redesign.

### F2 — `aiHint` is now only a truthiness gate; its formatted value is vestigial

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/plants/EditableField.tsx:267, src/components/plants/PlantDetail.tsx (aiWateringHint)
- **Detail**: Since the badge no longer prints `{aiHint}`, the prop's string value is never rendered — it survives only as the `aiHint &&` truthiness gate, which is largely redundant with `aiValueUnchanged()`'s own null/empty guard on `aiValue`. Consequently the pre-formatted `aiWateringHint` ("every N days") computed in PlantDetail is display-dead: passed in but never shown. Not a bug — leftover wiring from the pre-redesign shape that a future reader will find puzzling.
- **Fix**: If F1 lands as Fix A, consider gating on `aiValue != null && aiValueUnchanged(kind, localValue, aiValue)` and dropping the unused `aiWateringHint` formatting — or leave as-is and note it. Low stakes either way.
- **Decision**: SKIPPED — harmless leftover; not worth the churn now.
