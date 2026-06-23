# Watering Interval +/− Stepper Buttons Implementation Plan

## Overview

Add +/− stepper buttons to the watering-interval numeric field so users can adjust the interval without typing. The interval is entered in two places — the add-plant form and the editable field on the plant detail page — both currently bare native number inputs. We introduce one shared `NumberStepper` UI component that owns the increment/decrement, clamp, and empty-state rules, and wire it into both sites.

## Current State Analysis

The watering interval is rendered as a native `<Input type="number" min={1} inputMode="numeric">` in two locations, each holding its value as a **string** in React state (`""` means empty/null):

- **`src/components/plants/AddPlantForm.tsx:409-422`** — "Watering interval (days)" in the add-plant flow. State: `wateringDays` (`AddPlantForm.tsx:65`). Validated on submit at `AddPlantForm.tsx:222-224` (`/^\d+$/`), serialized at `:241` (`watering === "" ? null : Number(watering)`).
- **`src/components/plants/EditableField.tsx:170-186`** — the `kind === "number"` branch of the generic editable field, used on the plant detail page (`PlantDetail.tsx:251-259`). State: `draft` string. Validated on save at `EditableField.tsx:81-92` (integer ≥ 1, or empty → null). Enter saves, Escape cancels (`:180-183`).

The `number` `FieldKind` (`src/lib/ai-suggestion.ts:1`) is currently used **only** for the watering interval, so changing the number branch in `EditableField` affects only this field.

There is **no existing stepper** in `src/components/ui/` (only `button`, `input`, `label`, `checkbox`, etc.). The project uses shadcn "new-york" components, `cn()` from `@/lib/utils` for class merging, and `lucide-react` icons (`Plus`, `Minus` available).

### Key Discoveries:

- Both inputs already enforce `min={1}` and reject non-integers / `< 1` on save — the stepper's clamp rules must mirror this, not contradict it.
- Values live as **strings** in state; the stepper must parse → clamp → re-stringify so existing validation/serialization keeps working unchanged.
- `EditableField` relies on `draft` being a string and on Enter/Escape key handling — the shared component must preserve string in/out and forward keyboard behavior.
- `EditableField` number input carries dark-glass styling (`border-white/20 bg-white/10 text-white placeholder:text-blue-100/40`); `AddPlantForm` uses default Input styling. The component must accept a `className` so each site keeps its look.

## Desired End State

The watering-interval field in both the add-plant form and the plant detail editable field shows a − button, the number input, and a + button on one row. Clicking + increments by 1; clicking − decrements by 1. From empty, + sets the value to 1. − is disabled when the value is 1 (never goes below 1 or to 0). There is no upper cap and no press-and-hold auto-repeat. Typing still works exactly as before, as do Enter-to-save / Escape-to-cancel in the detail field and submit validation in the add form. Verified by: stepping up/down in both UIs, confirming − disables at 1, confirming + from empty yields 1, and confirming a saved value persists through the existing PATCH/POST path.

## What We're NOT Doing

- No press-and-hold / auto-repeat acceleration.
- No upper bound / max cap.
- No change to the API payload, validation rules, schema, or `care_events` scheduling.
- No "clear to empty via stepper" — clearing remains a manual text deletion.
- No application of the stepper to any other numeric field (the `number` kind is watering-only today; we do not generalize beyond it).
- No change to the read-only display formatting (`Every N days`).

## Implementation Approach

Build a single controlled `NumberStepper` component that speaks the same **string-valued** contract the two call sites already use (`value: string`, `onChange: (next: string) => void`), so it drops in without touching surrounding state, validation, or serialization. All numeric logic (parse, increment, decrement, clamp to ≥ 1, empty → 1 on increment) lives in a small pure helper that is unit-tested in isolation. Then replace the two bare `<Input>` usages with `<NumberStepper>`, forwarding each site's existing `className`, keyboard handlers, and attributes.

## Phase 1: Build the `NumberStepper` component

### Overview

Create a reusable, controlled stepper component and a pure step helper encoding the agreed rules, with unit tests for the helper.

### Changes Required:

#### 1. Pure step helper

**File**: `src/lib/number-stepper.ts` (new)

**Intent**: Isolate the parse/clamp/empty arithmetic from React so it can be unit-tested directly. Increment of an empty value yields the minimum (1); decrement clamps at the minimum and never produces 0 or empty.

**Contract**: Export `stepValue(current: string, delta: 1 | -1, min = 1): string`. Empty/non-numeric `current` with `delta === 1` → `String(min)`; empty with `delta === -1` → unchanged (`""`). Otherwise compute `clamp(parsed + delta, min)` and return as string. Also export a `canDecrement(current: string, min = 1): boolean` (false when empty or at/below min) to drive the − button's disabled state.

#### 2. NumberStepper UI component

**File**: `src/components/ui/number-stepper.tsx` (new)

**Intent**: Render − / Input / + on one row as a controlled component matching the existing string-valued contract, delegating arithmetic to the helper and matching shadcn styling conventions.

**Contract**: Props mirror the inputs they replace — `value: string`, `onChange: (next: string) => void`, plus optional `id`, `min` (default 1), `className`, `inputClassName`, `placeholder`, `autoFocus`, `disabled`, and `onKeyDown` forwarded to the inner `Input`. Renders two `Button` (`variant="ghost"`/icon, `lucide-react` `Minus`/`Plus`) and the existing `Input type="number" min inputMode="numeric"`. Suppress the browser's native spinner arrows on the inner `Input` (so the custom −/+ buttons aren't doubled by native ones — the project has no existing spinner suppression) via a default utility class merged through `cn()`: `[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`. − button `disabled` driven by `canDecrement`; both buttons `type="button"` to avoid submitting the add-plant form. Each icon button carries an `aria-label` so it has an accessible name (`"Decrease watering interval"` on −, `"Increase watering interval"` on +) — icon-only buttons are otherwise announced as just "button" and aren't reachable by the project's `getByRole`/`getByLabel` E2E locator policy. Buttons call `onChange(stepValue(value, ±1, min))`. Keep components compiler-safe (no prop/state mutation; handlers defined inline or via `useCallback` consistent with the file's style).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npm run lint`
- Unit tests pass: `npm run test:run`
- New helper unit tests cover: empty `+` → "1", empty `−` → "", at-min `−` stays "1", normal `+`/`−`, non-numeric input guarded.

#### Manual Verification:

- N/A for this phase (component not yet mounted) — verified in Phase 2.

**Implementation Note**: After completing this phase and all automated verification passes, proceed to Phase 2 (no manual UI to confirm yet).

---

## Phase 2: Wire `NumberStepper` into both sites

### Overview

Replace the bare number `Input` in the add-plant form and the `kind === "number"` branch of `EditableField` with `NumberStepper`, preserving each site's styling, keyboard behavior, and validation.

### Changes Required:

#### 1. Add-plant form

**File**: `src/components/plants/AddPlantForm.tsx`

**Intent**: Swap the watering `Input` (`:411-421`) for `NumberStepper`, keeping `id="watering"`, the `wateringDays` state, placeholder, and the existing submit-time validation/serialization untouched.

**Contract**: `<NumberStepper id="watering" value={wateringDays} onChange={setWateringDays} placeholder="e.g. 7" />`. No change to `:222-224` validation or `:241` serialization. Default (non-dark) styling.

#### 2. Editable detail field

**File**: `src/components/plants/EditableField.tsx`

**Intent**: Replace the `kind === "number"` `Input` (`:170-186`) with `NumberStepper`, forwarding the dark-glass `className`, `autoFocus`, and the existing Enter/Escape `onKeyDown` so save/cancel still work.

**Contract**: `<NumberStepper value={draft} onChange={setDraft} autoFocus inputClassName="border-white/20 bg-white/10 text-white placeholder:text-blue-100/40" onKeyDown={...Enter→handleSave / Escape→cancelEdit} />`. No change to `handleSave` validation (`:81-92`). The − / + buttons sit alongside, distinct from the existing save/cancel (`Check`/`X`) row at `:226-247`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npm run lint`
- Unit tests pass: `npm run test:run`
- Build succeeds: `npm run build`

#### Manual Verification:

- Add-plant form: + increments, − decrements, − disabled at 1, + from empty yields 1; typing still works; plant saves with the chosen interval.
- Plant detail: editing the watering interval shows steppers; +/− adjust the draft; Enter saves and Escape cancels as before; saved value persists after reload.
- Both sites visually correct — detail field keeps dark-glass styling, add form keeps default styling; buttons don't submit the add form prematurely.
- No regression in the read-only "Every N days" display or the "AI suggested" badge logic.

**Implementation Note**: After automated verification passes, pause for manual confirmation that both UIs behave as described before archiving.

---

## Testing Strategy

### Unit Tests:

- `src/lib/number-stepper.test.ts` — `stepValue` and `canDecrement` across: empty `+`, empty `−`, at-min `−`, normal increment/decrement, non-numeric guard, custom `min`.

### Integration Tests:

- None required — no API or data-flow change; existing `src/pages/api/plants/*.test.ts` already cover the PATCH/POST contract the field uses.

### Manual Testing Steps:

1. Open the add-plant flow, focus the watering field, click + several times, then −; confirm it stops at 1 and + from empty starts at 1.
2. Submit the form; confirm the plant is created with the stepped value.
3. On a plant detail page, edit the watering interval, use +/−, press Enter to save; reload and confirm persistence.
4. Re-edit and press Escape; confirm the change is discarded.

## Performance Considerations

Negligible — two extra buttons per field and pure arithmetic on click. No re-render or timer concerns (no auto-repeat).

## Migration Notes

None — purely additive UI; no data or schema changes.

## References

- Add-plant field: `src/components/plants/AddPlantForm.tsx:409-422`
- Editable number field: `src/components/plants/EditableField.tsx:170-186`
- FieldKind definition: `src/lib/ai-suggestion.ts:1`
- Triage note: `next-steps.md` (line 21 — "+/− buttons on watering interval (pure UI)")

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Build the NumberStepper component

#### Automated

- [x] 1.1 Type checking passes (`npx astro sync && npm run lint`)
- [x] 1.2 Unit tests pass (`npm run test:run`)
- [x] 1.3 Helper unit tests cover empty/at-min/normal/non-numeric cases

### Phase 2: Wire NumberStepper into both sites

#### Automated

- [ ] 2.1 Type checking passes (`npx astro sync && npm run lint`)
- [ ] 2.2 Unit tests pass (`npm run test:run`)
- [ ] 2.3 Build succeeds (`npm run build`)

#### Manual

- [ ] 2.4 Add-plant form: +/− behavior, disable at 1, empty→1, typing, save all correct
- [ ] 2.5 Plant detail: steppers adjust draft, Enter saves / Escape cancels, value persists
- [ ] 2.6 Both sites visually correct; buttons don't prematurely submit the add form
- [ ] 2.7 No regression in "Every N days" display or "AI suggested" badge
