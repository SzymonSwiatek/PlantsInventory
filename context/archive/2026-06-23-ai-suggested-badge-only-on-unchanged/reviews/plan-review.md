<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Show the AI-Suggested Indicator Only on Unchanged Fields

- **Plan**: context/changes/ai-suggested-badge-only-on-unchanged/plan.md
- **Mode**: Deep
- **Date**: 2026-06-23
- **Verdict**: SOUND
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | PASS |

## Grounding

5/5 paths ✓ (`EditableField.tsx`, `PlantDetail.tsx`, `types.ts` exist; `src/lib/ai-suggestion.ts` + `.test.ts` new as expected). 5/5 symbols ✓ (`FieldKind`@`EditableField.tsx:11`, unconditional hint render @`:257`, `localValue`@`:44` / `setLocalValue`@`:102`, `AiSuggestion`@`types.ts:52-58`, `aiWateringHint`@`PlantDetail.tsx:54-57`). brief↔plan ✓. Progress block well-formed (one `## Progress`, both phases mirrored, all success-criteria bullets mapped to 1.1–1.2 / 2.1–2.8).

Deep check — normalization-divergence regression risk: **CLEAN**. The strongest failure mode (a never-touched field whose stored value differs from the snapshot, wrongly hiding the indicator) does not occur: `AddPlantForm.applySuggestion` (`AddPlantForm.tsx:179-186`) seeds the fields from the same suggestion object posted as `aiSuggestion` (`:244`); fields are posted `.trim()`'d and the snapshot re-normalized idempotently (`api/plants/index.ts:64,71-75`). `asIsoDate` (`src/lib/ai/suggest.ts`) stores `winterization_cutoff` date-only as `YYYY-MM-DD`, validating the plan's date assumption. Live-value comparison against `localValue` is correct because `onSaved` is only wired for `location_id` (`PlantDetail.tsx:253-255`).

## Findings

### F1 — Pin date normalization to string-slice, not Date parsing

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 / Critical Implementation Details
- **Detail**: The plan says date normalization is "slice/String" — which is correct. The risk is purely that an implementer reaches for `new Date(x).toISOString().slice(0,10)`, which can shift a date-only string across a TZ boundary. Harmless here (vitest pins TZ=UTC, workerd runs UTC) but a latent trap.
- **Fix**: State explicitly in the helper contract that dates normalize by taking the leading `YYYY-MM-DD` via string slice, never via `new Date(...)`. Add a unit case asserting a bare `"2026-11-01"` round-trips unchanged.
- **Decision**: FIXED — pinned string-slice contract (Phase 1 §1) + round-trip unit case (Phase 1 §2)

### F2 — `select` → always-false branch is unreachable

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 1 §1 (helper contract)
- **Detail**: The gate is `aiHint && aiValueUnchanged(...)`. The only select field (`location_id`) never receives an `aiHint` (`PlantDetail.tsx:246-256`), so the `select → false` branch can never execute via the real call site. It is defensive, documents intent, and costs one line — fine to keep. Noted so it's a deliberate choice, not an accident.
- **Fix**: Keep as a documented defensive default (recommended), or drop the branch and let the shared `FieldKind` carry the intent.
- **Decision**: ACCEPTED — keep the documented `select → false` branch as deliberate defensive intent (no plan change; already specified in Phase 1 §1 contract).
