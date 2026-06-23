# AI-Suggested Indicator Only on Unchanged Fields — Plan Brief

> Full plan: `context/changes/ai-suggested-badge-only-on-unchanged/plan.md`

## What & Why

In the plant detail/edit view, the "AI suggested: …" hint shows on every AI-backed field even after the user has edited it — which is misleading. We want the indicator to appear **only while a field still matches the original AI suggestion**, so it honestly signals "this value is still the AI's, untouched."

## Starting Point

`PlantDetail.tsx` reads the read-only `plant.ai_suggestion` snapshot and passes an `aiHint` string to each of five AI-backed `EditableField`s (`species`, `description`, `sunlight`, `watering_interval_days`, `winterization_cutoff`). `EditableField` renders that hint unconditionally (`EditableField.tsx:257`), with no comparison to the current value.

## Desired End State

Each AI hint line is visible iff the field's live value, normalized for its kind, equals the AI snapshot. Editing a field away hides its line instantly (no reload); editing it back re-shows it. Fields with no AI suggestion (`name`, `note`, `location`) are untouched. No schema, API, or visual redesign.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Indicator presentation | Keep existing italic "AI suggested: {value}" line, just gated | Smallest diff, preserves the value preview, no new component | Plan |
| Where to compute the match | Inside `EditableField`, against live `localValue` | Parent props go stale after inline edit, so a parent-side check would linger as a visible bug | Plan |
| Testing | Pure `aiValueUnchanged` helper in `src/lib/` + Vitest unit test | Deterministic coverage of normalization without jsdom; react-compiler-safe | Plan |
| Matching semantics | Strict normalized value equality (no "touched" flag) | Predictable and honest; avoids persisting per-field touched state (out of scope) | Plan |

## Scope

**In scope:** A pure comparison helper + tests; a raw `aiValue` prop on `EditableField`; gating the hint line; passing raw AI values from `PlantDetail` for the five AI fields.

**Out of scope:** Schema/migration/API changes; "sticky/touched" tracking; shadcn Badge redesign; `name`/`note`/`location` fields; `AddPlantForm`.

## Architecture / Approach

`PlantDetail` passes both the display `aiHint` and a new raw `aiValue` to `EditableField`. `EditableField` calls `aiValueUnchanged(kind, localValue, aiValue)` — a pure helper with per-kind normalization (numeric for `number`, `YYYY-MM-DD` for `date`, trim for text) — and renders the hint only when `aiHint && aiValueUnchanged(...)`. Reading `localValue` keeps the badge correct across inline edits without a parent refetch.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Helper + tests | `aiValueUnchanged` in `src/lib/` with unit tests | Getting per-kind normalization right (number vs string, dates) |
| 2. UI wiring | `aiValue` prop + gated hint in `EditableField`/`PlantDetail` | Comparing the prop instead of live `localValue` (stale badge) |

**Prerequisites:** None — `ai_suggestion` snapshot and types already exist.
**Estimated effort:** ~1 session, 2 small phases.

## Open Risks & Assumptions

- Assumes `winterization_cutoff` snapshot and the date input share a `YYYY-MM-DD`-normalizable format (confirmed by the date field handling in `EditableField`).
- Strict equality means re-typing the exact AI value re-shows the indicator — accepted as correct behavior.

## Success Criteria (Summary)

- AI hint shows only on fields still matching the snapshot; hides immediately on inline edit.
- `npm run test:run`, `npm run lint`, and `npm run build` all pass.
- No regressions in inline editing or in non-AI fields.
