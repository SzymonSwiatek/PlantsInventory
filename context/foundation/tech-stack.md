---
starter_id: 10x-astro-starter
package_manager: npm
project_name: 10x-plants-inventory
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: true
---

## Why this stack

Solo, after-hours, 3-week MVP web-app shipping AI-vision plant cataloging,
magic-link auth, photo storage, and scheduled care reminders. 10x-astro-starter
is the recommended default for `(web, js)` and a tight fit: Supabase covers
magic-link auth plus per-user storage isolation (the access-control guardrail),
Astro API routes call the AI provider for the photo-to-care-info flow, and
Cloudflare Pages/Workers handles edge deploy with Cron Triggers for the
watering and winterization reminder loop. All four agent-friendly criteria
clear cleanly, which matters for after-hours velocity. Bootstrapper confidence
is first-class, so scaffolding should be mostly smooth with occasional manual
steps. `has_auth`, `has_ai`, and `has_background_jobs` are set; `has_payments`
and `has_realtime` are out of scope per PRD Non-Goals. GitHub Actions
auto-deploy-on-merge is the starter's shipping default — fits the
solo-builder workflow.
