---
change_id: plant-list-watering-cadence
title: Show watering cadence in the location plant list instead of the stale "Not scheduled yet" placeholder
status: archived
created: 2026-06-23
updated: 2026-06-24
archived_at: 2026-06-24T21:09:15Z
---

## Notes

The location plant list (`src/pages/locations/[id].astro:81`) shows a hardcoded "Not scheduled yet" subtitle for every plant — a leftover placeholder from before the watering reminder loop (S-04) shipped. Wire the plant's `watering_interval_days` into the query and render the cadence ("Every N days") per plant, keeping "Not scheduled yet" only as the genuine `null` fallback. Scope is deliberately simple: just the interval cadence, no `next_water_due_at` / overdue math (that lives on `/today`).
