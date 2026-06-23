---
change_id: ai-suggested-badge-only-on-unchanged
title: Show the AI-suggested indicator only on fields the user hasn't changed
status: implemented
created: 2026-06-23
updated: 2026-06-23
archived_at: null
---

## Notes

In the plant detail/edit view, show the "AI suggested" indicator on a field ONLY when the field's current value still equals the original AI suggestion snapshot (plant.ai_suggestion). Once the user has edited a field away from the AI value, hide the indicator. No schema change expected — the ai_suggestion jsonb snapshot already exists. Surface area: src/components/plants/EditableField.tsx (renders the aiHint line) and src/components/plants/PlantDetail.tsx (passes aiHint from plant.ai_suggestion). Open question for planning: value normalization for the equality check (number vs string, select id-vs-name, date formats).
