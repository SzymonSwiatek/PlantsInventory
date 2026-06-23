# Show the AI-Suggested Indicator Only on Unchanged Fields — Implementation Plan

## Overview

In the plant detail/edit view, the "AI suggested: …" hint currently renders for every AI-backed field regardless of whether the user has edited it. This plan gates that indicator so it appears **only while the field's current value still equals the original AI suggestion snapshot** (`plant.ai_suggestion`), and disappears the moment the user edits the value away. The comparison is a pure, per-field-kind normalization helper, computed against the field's live value inside `EditableField` so the indicator updates immediately after an inline edit.

## Current State Analysis

- `PlantDetail.tsx` reads the snapshot once (`const ai = plant.ai_suggestion as AiSuggestion | null`, `src/components/plants/PlantDetail.tsx:53`) and passes an `aiHint` **display string** to each AI-backed `EditableField`. For watering it pre-formats the hint (`"every 7 days"`, `PlantDetail.tsx:54-57`); for the others it passes the raw AI string.
- `EditableField` renders `{aiHint && <p …>AI suggested: {aiHint}</p>}` unconditionally (`src/components/plants/EditableField.tsx:257`) — there is no comparison to the current value.
- `EditableField` owns a live `localValue` state (`EditableField.tsx:44`) that updates on inline save (`setLocalValue(payload)`, `EditableField.tsx:102`). For every field **except** `location_id`, the parent is never notified of the save (`onSaved` is only wired for the location select, `PlantDetail.tsx:253-255`), so the parent's `plant.*` props go stale after an inline edit until a full page reload.
- The AI snapshot is a typed `AiSuggestion` (`src/types.ts:52-58`) with exactly five nullable fields: `species`, `description`, `sunlight` (strings), `watering_interval_days` (number), `winterization_cutoff` (date string). All other fields (`name`, `note`, `location_id`) have no AI suggestion and never receive an `aiHint`.
- Tests are Vitest 3 in a **Node** environment with TZ pinned to UTC (`vitest.setup.ts`); the `@` alias is mirrored in `vitest.config.ts`. No jsdom/React Testing Library is configured, so component rendering is not the test surface — a pure helper is.

### Key Discoveries:

- The badge must be computed from the **live** value, not the parent prop — `EditableField.tsx:102-104` updates `localValue` but not the parent, so a parent-side comparison would linger stale after an inline edit (a visible bug). This is why the comparison lives inside `EditableField`.
- The watering `aiHint` is a formatted string while the underlying value is a number (`PlantDetail.tsx:54-57`) — the comparison needs the **raw** AI value, so a new `aiValue` prop (raw, untyped-for-display) is required alongside the existing `aiHint` (display).
- `FieldKind` is defined in `EditableField.tsx:11`; the helper needs the same union, so it should own/export `FieldKind` and `EditableField` should import it (small, clean refactor) rather than duplicating the literal.

## Desired End State

On the plant detail page, the "AI suggested: …" line under a field is visible **iff** the field's current (live) value, normalized for its kind, equals the original AI snapshot value. Editing a field away from the AI value hides the line instantly (no reload); editing it back to exactly the AI value re-shows it (strict value equality). Clearing a field that the AI had suggested hides the line. Fields with no AI suggestion (`name`, `note`, `location_id`) are unaffected.

Verify by: opening a plant whose fields still match the AI suggestion (lines show), editing one field inline to a different value (its line disappears immediately), and reloading (state is consistent). `npm run test:run` covers the normalization edge cases; `npm run lint` and `npm run build` pass.

## What We're NOT Doing

- **No schema/migration/API change** — `ai_suggestion` already exists and is read-only here.
- **No "sticky / touched" tracking** — we use strict value equality, not a persisted per-field "user touched it" flag. Re-typing the AI value legitimately re-shows the indicator.
- **No visual redesign** — we keep the existing italic `AI suggested: {value}` text line; no shadcn Badge component is introduced.
- **No change to `name`, `note`, or `location_id`** — they carry no AI suggestion.
- **No change to the AddPlantForm** suggestion-apply flow (`AddPlantForm.tsx`) — out of scope; this is the detail/edit view only.

## Implementation Approach

Extract a pure helper `aiValueUnchanged(kind, value, aiValue)` into `src/lib/` and unit-test its normalization rules in isolation. Then thread a raw `aiValue` prop from `PlantDetail` into `EditableField`, and gate the existing hint line on `aiHint && aiValueUnchanged(kind, localValue, aiValue)`. Because the comparison reads `localValue`, the indicator stays correct across inline edits without any parent refetch.

## Critical Implementation Details

- **Live-value comparison.** The gate must compare against `localValue` (the component's live state), not the `value` prop — otherwise the indicator won't update after an inline save. This is the whole reason the comparison lives in `EditableField` rather than `PlantDetail`.
- **Normalization is the bug-prone part.** `number`: compare numerically (`Number(a) === Number(b)`), not `"7" === 7`. `date`: normalize both sides to `YYYY-MM-DD` (slice/`String`), since the stored cutoff and the input value share that format. `text`/`multiline`: trim before comparing. Treat `null`, `undefined`, and `""` consistently — but note the line only ever renders when `aiHint` is truthy, so an absent AI value already suppresses it.

## Phase 1: Pure matching helper + unit tests

### Overview

Add a pure, dependency-free helper that decides whether a field's value still equals its AI suggestion, with per-kind normalization, and unit-test the edge cases.

### Changes Required:

#### 1. AI-match helper

**File**: `src/lib/ai-suggestion.ts` (new)

**Intent**: Provide a single pure function the UI can call to decide whether to show the AI indicator, isolating the tricky normalization from React so it is deterministically testable.

**Contract**: Export `type FieldKind = "text" | "multiline" | "number" | "date" | "select"` (the same union currently in `EditableField.tsx:11`) and `function aiValueUnchanged(kind: FieldKind, value: string | number | null, aiValue: string | number | null): boolean`. Returns `false` when `aiValue` is `null`/`undefined`/`""` (nothing to match). Normalization by kind: `number` → numeric equality; `date` → both sides normalized to `YYYY-MM-DD` by taking the leading 10 characters via **string slice** (`String(x).slice(0, 10)`), **never** via `new Date(...)` — parsing a bare `YYYY-MM-DD` as a `Date` can shift it across a TZ boundary; `text`/`multiline` → trimmed string equality; `select` → always `false` (no AI suggestion applies). No code snippet needed — the contract above is the spec.

#### 2. Helper unit tests

**File**: `src/lib/ai-suggestion.test.ts` (new)

**Intent**: Lock the normalization rules so future edits can't silently regress them.

**Contract**: Vitest cases covering — number equality across string/number inputs (`7` vs `"7"` → true; `7` vs `8` → false); date normalization (same day with/without time component → true; a bare `"2026-11-01"` round-trips unchanged — asserts the string-slice path, no `Date` TZ-shift); text trimming (`"Aloe "` vs `"Aloe"` → true); null/empty `aiValue` → false; cleared current value against a non-null AI value → false; `select` kind → false.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:run`
- Type checking / lint passes: `npm run lint`

#### Manual Verification:

- (none for this phase — pure logic, covered by unit tests)

**Implementation Note**: After completing this phase and all automated verification passes, proceed to Phase 2 (no manual sign-off needed for the pure helper).

---

## Phase 2: Gate the indicator in the UI

### Overview

Pass the raw AI snapshot value into `EditableField` and show the existing hint line only when the live value still matches it.

### Changes Required:

#### 1. EditableField — accept raw AI value and gate the hint

**File**: `src/components/plants/EditableField.tsx`

**Intent**: Add a raw `aiValue` prop and render the "AI suggested" line only when the field is both AI-backed (`aiHint` present) and still matches the snapshot, using the live `localValue`. Import `FieldKind` from the new helper instead of redefining it locally.

**Contract**: `Props` gains `aiValue?: string | number | null`. Replace the unconditional render at `EditableField.tsx:257` so the line renders iff `aiHint && aiValueUnchanged(kind, localValue, aiValue ?? null)`. Remove the local `type FieldKind = …` (`EditableField.tsx:11`) in favor of importing it from `@/lib/ai-suggestion`. No snippet needed — follows the existing JSX pattern.

#### 2. PlantDetail — pass the raw AI snapshot value

**File**: `src/components/plants/PlantDetail.tsx`

**Intent**: For the five AI-backed fields, pass the raw snapshot value as `aiValue` alongside the existing `aiHint` so `EditableField` can compare against it.

**Contract**: Add `aiValue={ai?.species ?? null}` to the species field and the analogous `aiValue` to `description`, `sunlight`, `winterization_cutoff`, and `watering_interval_days` (the last using the raw number `ai?.watering_interval_days ?? null`, while `aiHint` keeps the formatted `aiWateringHint` string). `name`, `note`, and `location_id` are left unchanged. No snippet needed.

### Success Criteria:

#### Automated Verification:

- Type checking + lint passes (incl. react-compiler rule): `npm run lint`
- Unit tests still pass: `npm run test:run`
- Production build succeeds: `npm run build`

#### Manual Verification:

- On a plant whose fields still match the AI suggestion, each AI-backed field shows the "AI suggested: …" line.
- Editing a field inline to a different value hides that field's line immediately (no reload).
- Editing the same field back to exactly the AI value re-shows the line.
- Clearing an AI-suggested field hides its line.
- `name`, `note`, and `location` never show an AI line; no regressions in inline editing/saving.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation from the human that the UI behaviors above were verified.

---

## Testing Strategy

### Unit Tests:

- `aiValueUnchanged` per kind: number (string-vs-number equality, inequality), date (normalized equality), text/multiline (trim), `select` (always false), null/empty `aiValue` (false), cleared value vs non-null AI (false).

### Integration Tests:

- None — no API or data-layer change; behavior is presentational and covered by the unit test plus manual checks.

### Manual Testing Steps:

1. Open a plant created from an AI suggestion with fields unedited → all five AI lines visible.
2. Inline-edit `species` to a new value → its AI line disappears immediately; others unchanged.
3. Inline-edit `species` back to the exact AI value → its AI line returns.
4. Clear `winterization_cutoff` (No winterization needed) → its AI line disappears.
5. Edit `watering_interval_days` to a different number → AI line disappears; set it back → returns.
6. Confirm `name`, `note`, `location` never render an AI line.

## Performance Considerations

Negligible — one pure comparison per AI-backed field on render (five fields). No new network or state.

## Migration Notes

None — no data or schema changes.

## References

- Indicator render site: `src/components/plants/EditableField.tsx:257`
- AI snapshot wiring: `src/components/plants/PlantDetail.tsx:53-57`, `:204-244`
- Snapshot type: `src/types.ts:52-58`
- Change identity: `context/changes/ai-suggested-badge-only-on-unchanged/change.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pure matching helper + unit tests

#### Automated

- [x] 1.1 Unit tests pass: `npm run test:run`
- [x] 1.2 Type checking / lint passes: `npm run lint`

### Phase 2: Gate the indicator in the UI

#### Automated

- [ ] 2.1 Type checking + lint passes (incl. react-compiler rule): `npm run lint`
- [ ] 2.2 Unit tests still pass: `npm run test:run`
- [ ] 2.3 Production build succeeds: `npm run build`

#### Manual

- [ ] 2.4 AI-backed fields show the line when value matches the snapshot
- [ ] 2.5 Inline-editing a field away hides its line immediately (no reload)
- [ ] 2.6 Editing back to the exact AI value re-shows the line
- [ ] 2.7 Clearing an AI-suggested field hides its line
- [ ] 2.8 name/note/location never show an AI line; no inline-edit regressions
