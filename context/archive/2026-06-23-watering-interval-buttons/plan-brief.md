# Watering Interval +/− Stepper Buttons — Plan Brief

> Full plan: `context/changes/watering-interval-buttons/plan.md`

## What & Why

Users set a plant's watering interval (in days) by typing into a bare number field. The ask (from `next-steps.md`, triaged as "pure UI") is to add +/− stepper buttons so the interval can be nudged up or down without typing — a small ergonomics win on a frequently-touched field.

## Starting Point

The interval is a native `<Input type="number" min={1}>` in two places: the add-plant form (`AddPlantForm.tsx:409-422`) and the editable field on the plant detail page (`EditableField.tsx:170-186`, the `kind === "number"` branch — used only for watering today). Both hold the value as a string in state and already validate integer ≥ 1 on save. No stepper component exists yet in `src/components/ui/`.

## Desired End State

Both fields show − / input / + on one row. + increments by 1, − decrements by 1, − is disabled at 1 (never below), and + from empty yields 1. No upper cap, no press-and-hold. Typing, Enter-to-save / Escape-to-cancel, and existing validation all keep working unchanged.

## Key Decisions Made

| Decision            | Choice                                  | Why (1 sentence)                                                       | Source |
| ------------------- | --------------------------------------- | --------------------------------------------------------------------- | ------ |
| Where to apply      | Both add form and edit field            | Consistent UX wherever the interval is set                            | Plan   |
| Code packaging      | One shared `NumberStepper` in `ui/`     | Single source of truth for clamp/empty logic; matches shadcn convention | Plan   |
| Empty + behavior    | Set to 1                                | Predictable — starts at the floor and climbs                          | Plan   |
| Lower bound         | Disable − at 1, never below             | Mirrors existing `min=1` validation; clear affordance                 | Plan   |
| Repeat / max        | Single-step, no hold, no hard max       | Simplest, accessible, matches "pure UI" scope                         | Plan   |

## Scope

**In scope:** A shared `NumberStepper` component + pure step helper; wiring it into the two watering-interval render sites; unit tests for the helper.

**Out of scope:** Auto-repeat, max cap, clear-via-stepper, API/schema/validation changes, generalizing the stepper to other numeric fields.

## Architecture / Approach

A controlled `NumberStepper` speaks the same string-valued contract the call sites already use (`value: string`, `onChange: (next) => void`), so it drops in without touching surrounding state, validation, or serialization. All arithmetic lives in a unit-tested pure helper (`stepValue`, `canDecrement`). Each site forwards its own `className` and keyboard handlers so styling and Enter/Escape behavior are preserved.

## Phases at a Glance

| Phase                          | What it delivers                                    | Key risk                                              |
| ------------------------------ | --------------------------------------------------- | ----------------------------------------------------- |
| 1. Build `NumberStepper`       | Component + tested pure step helper                 | Empty/clamp edge-case logic — covered by unit tests   |
| 2. Wire into both sites        | Steppers live in add form + detail edit field       | Buttons accidentally submitting the add form; styling/keyboard regressions |

**Prerequisites:** None — purely additive UI on existing fields.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Assumes the `number` `FieldKind` stays watering-only; if another numeric field adopts it later, the shared component already supports it via `min`.
- − / + buttons must be `type="button"` so they don't trigger the add-plant form's submit.

## Success Criteria (Summary)

- In both UIs, +/− adjust the interval, − disables at 1, + from empty yields 1.
- Typing, save (Enter / submit), and cancel (Escape) behave exactly as before; values persist.
- No regression in the read-only "Every N days" display or the "AI suggested" badge.
