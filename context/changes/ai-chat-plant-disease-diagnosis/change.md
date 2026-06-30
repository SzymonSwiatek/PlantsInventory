---
change_id: ai-chat-plant-disease-diagnosis
title: AI chat for plant disease diagnosis ("Ask AI" with photo upload/capture)
status: implementing
created: 2026-06-30
updated: 2026-06-30
archived_at: null
---

## Notes

Add an "Ask AI" entry point that opens an AI chat for plant disease diagnosis. The
user can choose an existing photo or take a new one (same photo upload/capture
affordance as the add-plant form), then converse with the AI about what's wrong
with the plant.

Scope note: this is listed as a **Non-Goal** in the PRD (line 180) — "AI chat for
plant disease diagnosis" was deferred to v2. Pulling it forward as a deliberate
v2 feature; do not edit the PRD Non-Goals section as part of this change.

Reuse opportunities to validate during research/planning:
- Photo upload/capture UI from the add-plant form.
- The existing AI-vision suggestion endpoint (`/api/plants/suggest`) and its
  Anthropic provider wiring.
- AI-suggested / model-returned text is untrusted (prompt-injection via photo) —
  never render with `set:html` / `dangerouslySetInnerHTML`.
