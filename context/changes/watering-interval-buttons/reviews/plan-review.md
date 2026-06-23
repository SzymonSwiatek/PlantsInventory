<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Watering Interval +/− Stepper Buttons

- **Plan**: context/changes/watering-interval-buttons/plan.md
- **Mode**: Deep
- **Date**: 2026-06-23
- **Verdict**: SOUND
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

6/6 paths ✓ (input.tsx, button.tsx, utils.ts, ai-suggestion.ts, PlantDetail.tsx exist; number-stepper.ts/.tsx correctly absent as new files), symbols ✓ (`number` FieldKind confirmed watering-only — used only at EditableField and PlantDetail.tsx:255; AddPlantForm validation :222-224 and serialization :241 verified), brief↔plan ✓, Progress↔Phase mechanical contract ✓.

## Findings

### F1 — Native number-input spinners doubled with custom +/− buttons

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §2 (component contract) / Phase 2 manual verify
- **Detail**: The component contract keeps `Input type="number" min inputMode="numeric"`. Browsers render native up/down spinner arrows on `type="number"` inputs, and there is no spinner suppression anywhere in the project (grep of src/styles/ and ui/input.tsx → none). So each field will show the native spinner AND the new − / + buttons — a doubled stepper affordance. The plan's only guard is the manual "both sites visually correct" check (2.6), which catches this after build, not before. On the dark-glass detail field the native arrows also won't match the glass styling.
- **Fix**: Suppress native spinners on the NumberStepper's inner Input. Add a utility class to the component (default + `inputClassName`), e.g. `[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`, and bake it into the Phase 1 component contract so it's not left to the implementer.
  - Strength: Eliminates the redundancy at the source; one class, no JS; keeps type=number's mobile numeric keypad + min semantics.
  - Tradeoff: One more styling concern in the shared component.
  - Confidence: HIGH — verified no existing suppression; standard Tailwind arbitrary-variant approach for this exact problem.
  - Blind spot: Firefox uses `-moz-appearance`; `[appearance:textfield]` base covers it, but worth a cross-browser glance in 2.6.
- **Decision**: FIXED — spinner-suppression class added to Phase 1 component contract

### F2 — Icon-only −/+ buttons have no accessible name

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §2 — NumberStepper UI component
- **Detail**: The contract specifies two icon `Button`s (Minus/Plus) with no accessible name. A screen reader announces them as just "button". This also matters for the project's stated E2E locator policy (getByRole/getByLabel first, per CLAUDE.md) — an unnamed button isn't reliably reachable by role+name.
- **Fix**: Add `aria-label="Decrease watering interval"` / `"Increase watering interval"` (or generic "Decrease"/"Increase") to the two buttons in the component contract.
- **Decision**: FIXED — aria-labels added to Phase 1 component contract

## Notes (not findings)

- Button density in the detail edit field: the plan already flagged (line 104) that the −/+ row sits "distinct from" the Check/X save/cancel row at :226-247. Keep an eye during manual check 2.6 that − isn't confused with X (cancel). Acknowledged by plan — no finding.
- Decimal typed values (e.g. `2.5` → `+` → `3.5`) flow through `stepValue`'s `parsed + delta`; this matches the existing input's behavior (save-time `Number.isInteger` is the real gate), so it's preserved, not regressed.
