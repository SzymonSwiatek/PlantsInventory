---
change_id: first-plant-from-photo
title: "First plant from a photo: AI care suggestion, accept/edit, save to a location"
status: implemented
created: 2026-06-08
updated: 2026-06-10
archived_at: null
---

## Notes

Source: roadmap S-01 (north star) — `context/foundation/roadmap.md`. Issue [#4](https://github.com/SzymonSwiatek/PlantsInventory/issues/4).

Outcome: a signed-in user creates their first location, taps "Add plant", uploads a photo, sees an AI-suggested species + care profile within ~10s, accepts or edits any field (or replaces the suggestion entirely), and saves the plant into the chosen location. The plant is immediately visible in the location's plant list. Manual-creation fallback works if the AI is unavailable.

- **PRD refs:** US-01, FR-004, FR-008–FR-014; NFR "AI suggestion 95p < 10s", NFR "10 MB photo upload", Guardrail "catalog survives AI outage".
- **Prerequisites:** F-01 (magic-link-auth), F-02 (domain-schema-with-rls) — both `ready` in the roadmap; confirm they are landed before implement.
- **Unknowns to resolve at plan time:** AI vision provider choice + per-call cost ceiling (default to cheapest viable vision model); operational definition of "minor edit" for the 75% acceptance metric (instrument edit-count/field-changes; threshold downstream).
- **Risk / mitigation:** carries the north star plus three integration surfaces at once — Supabase Storage signed-upload, AI provider call, magic-link auth boundary. Ship the photo-storage and AI-call paths behind small endpoints first, observed individually, before stitching into the UI form.
