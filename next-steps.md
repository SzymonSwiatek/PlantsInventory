These 8 items are separate brownfield changes, not one project. The original /10x-shape → /10x-prd → /10x-roadmap chain is for greenfield/whole-product work — you've already done that. For incremental ideas like these, the per-change loop is:

/10x-shape (only if the idea is under-specified) → shape-notes
/10x-new create context/changes/<id>/change.md
/10x-research (optional — if it touches unfamiliar code)
/10x-plan → /10x-plan-review
/10x-implement (or /10x-tdd / /10x-e2e)
/10x-impl-review
/10x-archive

You don't jump straight to /10x-plan. First pick one idea and frame/shape it, because half your list is one-liners that hide real decisions.

Triage of your 8 ideas

Your notes split cleanly into two buckets:

Clear enough to go /10x-new → /10x-plan directly:

- Turn off email notifications (a real schema + settings change, but well-defined)
- +/− buttons on watering interval (pure UI)
- Camera button for mobile photo capture (UI + capture attr)
- AI-Suggested badge only on user-unchanged values (needs "is this field AI-origin or user-edited?" tracking — slightly deeper than it looks)

Need /10x-shape or /10x-frame first (decisions hidden inside):

- "Guardrail for user's image input" — what guardrail? size/type/content/AI-rejection? This is a /10x-frame candidate.
- "Adjust login page to project + magic link" — scope is fuzzy
- "Change app language to Polish" — i18n strategy decision (hardcode vs. i18n lib); affects every component
- "Update README for GitHub presentation" — docs, low-risk, can be done outside the loop
