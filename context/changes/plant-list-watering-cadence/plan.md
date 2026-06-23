# Show Watering Cadence in the Location Plant List — Implementation Plan

## Overview

The location plant list renders a hardcoded `"Not scheduled yet"` subtitle for every plant — a leftover placeholder from before the watering-reminder loop shipped. This change wires each plant's `watering_interval_days` into the existing query and renders the real cadence ("Water every N days") per plant, keeping `"Not scheduled yet"` only as the genuine `null` fallback.

## Current State Analysis

- `src/pages/locations/[id].astro` lists the plants for a location. The plants query (`:21-25`) selects only `id, name, photo_path`. The card-shape type `PlantCard` (`:10`) Picks the same three fields plus a derived `photoUrl`.
- The subtitle is a static string: `<p class="text-sm text-blue-100/50">Not scheduled yet</p>` (`:81`).
- `Plant.watering_interval_days` is already typed `number | null` (`src/types.ts:56`) and lives on the `plants` row (`src/db/database.types.ts:120`) — it is already populated by the add/edit flows. No migration, API, or auth change is needed; the list query is RLS-scoped already.
- A cadence-formatting precedent exists at `src/components/plants/PlantDetail.tsx:55-56`: `` `every ${n} day${n === 1 ? "" : "s"}` ``. We mirror its plural handling, adapted to the standalone-label copy chosen for this list.

## Desired End State

On `/locations/[id]`, each plant card's subtitle shows its watering cadence:

- `watering_interval_days` is `null` → `"Not scheduled yet"` (unchanged).
- `watering_interval_days === 1` → `"Water every day"`.
- `watering_interval_days > 1` → `"Water every {N} days"`.

Verify by visiting a location that has at least one plant with an interval set, one with interval `1`, and one with no interval, and confirming all three render correctly. `npm run lint` and `npm run build` pass.

### Key Discoveries:

- Single-file change — `src/pages/locations/[id].astro` (query + type + render).
- Plural/singular precedent: `src/components/plants/PlantDetail.tsx:56`.
- Field already typed and stored: `src/types.ts:56`, `src/db/database.types.ts:120`.

## What We're NOT Doing

- No `next_water_due_at` / overdue / snooze math — that view lives on `/today`.
- No new component, helper, or `src/lib/` extraction — the format is a 3-branch inline expression with one call site.
- No styling/visual distinction between an active cadence and the `null` fallback — both keep the existing muted subtitle style.
- No migration, API, or type changes — the field already exists end to end.
- No automated test — `.astro` pages here have no page-level test harness, and the logic is a single inline conditional (manual verification chosen).

## Implementation Approach

Add `watering_interval_days` to the `plants` select, widen the `PlantCard` Pick to carry it through the `safeRows.map`, and replace the static subtitle text with a small inline expression that produces the three-branch string. The `photoUrl` derivation and ordering are untouched.

## Phase 1: Render Watering Cadence in the Location Plant List

### Overview

Carry `watering_interval_days` from the query through to the card and render it as cadence copy, with `"Not scheduled yet"` retained as the `null` fallback.

### Changes Required:

#### 1. Plant list query + card type

**File**: `src/pages/locations/[id].astro`

**Intent**: Select the interval column and let it flow into each `PlantCard` so the render layer has the value.

**Contract**:
- Widen the `PlantCard` type (`:10`) to include `watering_interval_days` from `Plant` — i.e. `Pick<Plant, "id" | "name" | "photo_path" | "watering_interval_days">`.
- Add `watering_interval_days` to the `.select(...)` string in the plants query (`:23`). The existing `safeRows.map((p) => ({ ...p, photoUrl }))` spread (`:30-33`) already forwards the new field — no change needed there beyond the spread that's present.

#### 2. Subtitle render

**File**: `src/pages/locations/[id].astro`

**Intent**: Replace the hardcoded subtitle (`:81`) with the cadence string, falling back to the placeholder only when the interval is `null`.

**Contract**: Render, inside the existing `<p class="text-sm text-blue-100/50">` slot, a three-branch expression over `plant.watering_interval_days`: `null` → `"Not scheduled yet"`; `=== 1` → `"Water every day"`; otherwise → `` `Water every ${plant.watering_interval_days} days` ``. Keep the existing element and classes unchanged (reuse the subtitle slot as-is).

### Success Criteria:

#### Automated Verification:

- Type checking / lint passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- A plant with `watering_interval_days > 1` shows `"Water every {N} days"`.
- A plant with `watering_interval_days === 1` shows `"Water every day"`.
- A plant with `watering_interval_days === null` still shows `"Not scheduled yet"`.
- No visual regression in card layout, spacing, or the empty-location state.

**Implementation Note**: After automated verification passes, pause for the human to confirm manual testing before considering the change complete.

---

## Testing Strategy

### Manual Testing Steps:

1. Sign in and open a location with plants that have a mix of interval values (set some via the plant edit flow if needed: one `1`, one `>1`, one cleared/`null`).
2. Confirm each card's subtitle matches the expected branch.
3. Confirm the empty-location and 404 (foreign/unknown id) states are unchanged.

## References

- Change brief: `context/changes/plant-list-watering-cadence/change.md`
- Cadence-format precedent: `src/components/plants/PlantDetail.tsx:55-56`
- Field type: `src/types.ts:56`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Render Watering Cadence in the Location Plant List

#### Automated

- [x] 1.1 Type checking / lint passes: `npm run lint`
- [x] 1.2 Production build succeeds: `npm run build`

#### Manual

- [ ] 1.3 Plant with interval > 1 shows "Water every {N} days"
- [ ] 1.4 Plant with interval === 1 shows "Water every day"
- [ ] 1.5 Plant with interval === null shows "Not scheduled yet"
- [ ] 1.6 No visual regression in card layout or empty-location state
