# Show Watering Cadence in the Location Plant List — Plan Brief

> Full plan: `context/changes/plant-list-watering-cadence/plan.md`

## What & Why

The location plant list shows a hardcoded `"Not scheduled yet"` subtitle on every plant — a stale placeholder from before the watering-reminder loop shipped. We replace it with each plant's real watering cadence, so the list reflects the schedule data that already exists on the row.

## Starting Point

`src/pages/locations/[id].astro` queries `id, name, photo_path` for each plant and renders a static `"Not scheduled yet"` subtitle at line 81. The `watering_interval_days` field already exists, is typed `number | null`, and is populated by the add/edit flows — it's simply not queried or shown here.

## Desired End State

Each plant card's subtitle reflects its interval: `"Water every {N} days"` when set, `"Water every day"` for an interval of 1, and `"Not scheduled yet"` only when the interval is genuinely `null`.

## Key Decisions Made

| Decision          | Choice                                         | Why (1 sentence)                                                            | Source |
| ----------------- | ---------------------------------------------- | -------------------------------------------------------------------------- | ------ |
| Cadence copy      | "Water every N days"                           | Explicit verb makes the interval's meaning unambiguous on a list subtitle. | Plan   |
| Singular case     | "Water every day" (drop the number)            | Most natural English; avoids the stilted "Water every 1 day".              | Plan   |
| Styling/placement | Reuse existing subtitle slot as-is             | Zero visual-regression risk, minimal diff.                                 | Plan   |
| Testing           | Manual verification only                       | `.astro` pages have no page-test harness; logic is one inline conditional. | Plan   |
| Scope             | Interval cadence only, no overdue math         | Overdue/next-due lives on `/today`; keep this purely presentational.       | Frame (change.md) |

## Scope

**In scope:**
- Add `watering_interval_days` to the location plant-list query.
- Widen the `PlantCard` Pick type to carry it.
- Render the three-branch cadence subtitle.

**Out of scope:**
- `next_water_due_at` / overdue / snooze math (`/today`).
- New component or `src/lib/` formatter extraction.
- Visual distinction between active cadence and the `null` fallback.
- Migrations, API, or type changes (field already exists end to end).

## Architecture / Approach

Single-file change in `src/pages/locations/[id].astro`: extend the `select`, widen one type, and swap the static string for an inline conditional that mirrors the singular/plural precedent at `PlantDetail.tsx:56`. The existing `safeRows.map` spread already forwards the new field.

## Phases at a Glance

| Phase                              | What it delivers                            | Key risk                                          |
| ---------------------------------- | ------------------------------------------- | ------------------------------------------------- |
| 1. Render cadence in plant list    | Real per-plant cadence subtitle on the list | Minimal — mismatched copy/singular handling       |

**Prerequisites:** None — the field is already stored, typed, and queryable.
**Estimated effort:** ~1 short session, single file.

## Open Risks & Assumptions

- Assumes `watering_interval_days` is reliably populated for scheduled plants (confirmed: written by add/edit flows, typed `number | null`).
- No automated regression guard — if the column is later dropped from the query, only manual testing would catch it.

## Success Criteria (Summary)

- Plants with an interval show "Water every N days" / "Water every day".
- Plants without an interval still show "Not scheduled yet".
- No layout regression; `npm run lint` and `npm run build` pass.
