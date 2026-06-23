---
project: 10xPlantsInventory
version: 1
status: draft
created: 2026-05-25
updated: 2026-06-23
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: 10xPlantsInventory

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Hobbyist plant owners keep dozens of plants across two or more physical locations (home, work, garden plot) and lose track of per-plant care needs. AI photo recognition removes the data-entry friction that historically blocked plant-tracking products, and a scheduled-reminder layer turns the catalog into actionable daily care work — closing the loop between knowing what you own and acting on it. The core hypothesis (the product's "core thesis": AI vision plus a reminder loop is materially better than memory + sticky notes for multi-location plant care) is what this roadmap is sequenced to validate.

## North star

**S-01: User adds a first plant from a photo, sees an AI-suggested care profile, accepts or edits it, and saves it into a named location** — this is the smallest end-to-end slice that proves the core thesis (AI vision + cataloging is the right shape), because it directly drives PRD Success Criteria #1 and #2 (≥75% AI-acceptance and ≥75% AI-path adoption).

> "North star" here means the smallest end-to-end slice whose successful delivery would prove the core product hypothesis — placed as early as Prerequisites allow because everything else only matters if this works.

## At a glance

> Live status: GitHub milestone [MVP v1](https://github.com/SzymonSwiatek/PlantsInventory/milestone/1). Issue numbers below link to the canonical work-tracking entry; this file remains the source of truth for narrative and sequencing.

| ID   | Change ID               | Outcome (user can …)                                                                      | Prerequisites | PRD refs                                                              | Status   | Issue                                                           |
| ---- | ----------------------- | ----------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------- | -------- | --------------------------------------------------------------- |
| F-01 | magic-link-auth         | (foundation) magic-link sign-in replaces password scaffold; sign-out works                | —             | FR-001, FR-002, FR-003, Access Control                                | done     | [#1](https://github.com/SzymonSwiatek/PlantsInventory/issues/1) |
| F-02 | domain-schema-with-rls  | (foundation) locations + plants + care-events tables exist with per-user RLS              | —             | NFR per-user isolation, NFR 12-month retention, Access Control        | done     | [#2](https://github.com/SzymonSwiatek/PlantsInventory/issues/2) |
| F-03 | cron-scheduled-skeleton | (foundation) Worker `scheduled()` handler runs on cron; survives adapter rebuilds         | —             | US-02, FR-018, FR-019                                                 | done     | [#3](https://github.com/SzymonSwiatek/PlantsInventory/issues/3) |
| S-01 | first-plant-from-photo  | sign in, create a location, upload a photo, get AI care suggestion, accept/edit, save     | F-01, F-02    | US-01, FR-004, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014 | done     | [#4](https://github.com/SzymonSwiatek/PlantsInventory/issues/4) |
| S-02 | location-management     | rename a location, delete (with non-empty warning), see all locations with plant counts   | F-01, F-02    | FR-005, FR-006, FR-007                                                | done     | [#5](https://github.com/SzymonSwiatek/PlantsInventory/issues/5) |
| S-03 | plant-management        | open plant detail (editable in place), edit any field, delete plant, add a free-text note | S-01          | FR-015, FR-016, FR-017                                                | done     | [#6](https://github.com/SzymonSwiatek/PlantsInventory/issues/6) |
| S-04 | watering-reminder-loop  | see today's care list, receive a watering reminder, mark watered (bulk too), snooze       | F-03, S-01    | US-02, US-03, FR-018, FR-020, FR-021, FR-022                          | done     | [#7](https://github.com/SzymonSwiatek/PlantsInventory/issues/7) |
| S-05 | winterization-reminder  | receive a reminder when a winterization cutoff approaches; mark winterized                | F-03, S-01    | US-02, US-03, FR-019, FR-020                                          | done     | [#8](https://github.com/SzymonSwiatek/PlantsInventory/issues/8) |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme          | Chain                             | Note                                                                                  |
| ------ | -------------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| A      | Account access | `F-01` (joins B at `S-01`)        | Auth conversion is small but unblocks every slice — scope it to magic-link only.      |
| B      | Plant catalog  | `F-02` → `S-01` → `S-02` → `S-03` | Carries the north star. `S-01` ships first; `S-02`/`S-03` sequential to avoid sprawl. |
| C      | Care reminders | `F-03` → `S-04` → `S-05`          | `F-03` can land in parallel with B; `S-04`/`S-05` depend on Stream B at `S-01`.       |

## Baseline

What's already in place in the codebase as of 2026-05-25 (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 SSR + React 19 islands, Tailwind 4 (CSS-first via `@tailwindcss/vite`), shadcn/ui (`src/components/ui/button.tsx`); only auth-related components built (`src/components/auth/*`).
- **Backend / API:** present (scaffold) — Astro API routes pattern at `src/pages/api/` with auth-only endpoints (`signin.ts`, `signup.ts`, `signout.ts`); no domain endpoints yet.
- **Data:** partial — `@supabase/supabase-js` 2.99 and Supabase CLI 2.23 installed, `supabase/config.toml` present, but no `supabase/migrations/`, no schema, no tables, no RLS.
- **Auth:** partial / divergent — scaffolded but as email+password (`signInWithPassword` in `src/pages/api/auth/signin.ts:14`, `PasswordToggle.tsx`, separate `SignUpForm.tsx`), whereas PRD FR-001/002 require magic-link. Resolution: F-01 converts the scaffold to magic-link.
- **Deploy / infra:** present — Cloudflare Workers via `@astrojs/cloudflare` 13.5 (Workers-with-static-assets shape in `wrangler.jsonc`), `nodejs_compat` flag set, CI auto-deploy-on-merge in `.github/workflows/ci.yml`, `wrangler` 4.94 in devDependencies. No `scheduled()` handler yet (required by F-03).
- **Observability:** partial — `observability.enabled: true` in `wrangler.jsonc` (Workers Logs retention only); no application-level logging, no error tracking (Sentry/etc.), no metrics. Out of scope for v1 per main_goal speed.

## Foundations

### F-01: Magic-link authentication

- **Outcome:** (foundation) Magic-link sign-in replaces the existing password scaffold; entering an email sends a single-use link; clicking the link creates the account on first use and signs the user in on subsequent uses; sign-out works from any authenticated screen.
- **Change ID:** magic-link-auth
- **PRD refs:** FR-001, FR-002, FR-003, Access Control (passwordless, single role `user`, unauthenticated routes redirect to sign-in)
- **Unlocks:** S-01 (north star), S-02, S-03, S-04, S-05 — every signed-in slice depends on this
- **Prerequisites:** —
- **Parallel with:** F-02, F-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Conversion (not greenfield) — must drop the password fields, the `SignUpForm.tsx` flow, and the `signInWithPassword` call without breaking the existing middleware path that resolves `context.locals.user` and redirects from `PROTECTED_ROUTES`.
- **Status:** done

### F-02: Domain schema with RLS

- **Outcome:** (foundation) Postgres schema lands via Supabase migrations covering locations, plants (with photo path and care profile fields), and care-events (watering/winterization timestamps); RLS is enabled on every table with per-operation, per-role policies tied to `auth.uid()`; no table is readable, insertable, or updatable across users.
- **Change ID:** domain-schema-with-rls
- **PRD refs:** NFR "isolation enforced at the storage boundary, not at the UI layer", NFR 12-month retention, Access Control, Guardrail "per-user data isolation"
- **Unlocks:** S-01, S-02, S-03, S-04, S-05 — every domain slice
- **Prerequisites:** —
- **Parallel with:** F-01, F-03
- **Blockers:** —
- **Unknowns:**
  - Should care-events be a single table (kind = water | winterize) or one table per kind? — Owner: user, deferrable to `/10x-plan`. Block: no.
- **Risk:** RLS gaps are silent — a missed policy leaks data with no error surfaced. Per-table policy tests (or at minimum a deny-by-default check from a second user's session) are mandatory before any slice merges.
- **Status:** done

### F-03: Cron `scheduled()` handler skeleton

- **Outcome:** (foundation) A custom Worker entry re-exports the `@astrojs/cloudflare` fetch handler and adds a `scheduled()` handler; `wrangler.jsonc` declares a `triggers.crons` entry; a smoke test (or external uptime check) asserts the handler ran at least once per scheduled tick.
- **Change ID:** cron-scheduled-skeleton
- **PRD refs:** US-02 (reminders), FR-018, FR-019 (cron is their delivery mechanism)
- **Unlocks:** S-04, S-05 — the watering and winterization reminder loops cannot fire without a `scheduled()` entry point
- **Prerequisites:** —
- **Parallel with:** F-01, F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Per `context/foundation/infrastructure.md` Risk Register: `@astrojs/cloudflare` adapter regenerates worker output on every build, which silently drops a hand-injected `scheduled()` handler. Foundation must put the custom entry under version control (not a post-build patch) AND include a smoke test, or a future adapter upgrade kills the reminder loop without warning.
- **Status:** done

## Slices

### S-01: First plant from a photo (north star)

- **Outcome:** A signed-in user creates their first location, taps "Add plant", uploads a photo, sees an AI-suggested species + care profile within ~10 seconds, accepts or edits any field (or replaces the suggestion entirely), and saves the plant into the chosen location. The plant is immediately visible in the location's plant list. The manual-creation fallback works if the AI is unavailable.
- **Change ID:** first-plant-from-photo
- **PRD refs:** US-01, FR-004, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, NFR "AI suggestion 95p < 10s", NFR "10 MB photo upload", Guardrail "catalog survives AI outage"
- **Prerequisites:** F-01, F-02
- **Parallel with:** S-02 (locations management is independent of the plant flow once the schema lands)
- **Blockers:** —
- **Unknowns:**
  - AI vision provider choice (OpenRouter, direct OpenAI/Anthropic, Google, etc.) and per-call cost ceiling — Owner: user, by `/10x-plan` for this slice. Block: no (default to whichever provider has the cheapest viable vision model the day planning starts).
  - Operational definition of "minor edit" for the 75% acceptance metric (PRD Open Question 2) — Owner: user, by PRD finalization. Block: no (instrumentation can record edit-count and field-changes; the threshold is downstream).
- **Risk:** Carries the north star plus three integration surfaces at once (Supabase Storage signed-upload pattern, AI provider call, magic-link auth boundary). If any one subsystem is wrong, the validation signal is muddied across all of them. Mitigation: ship the photo-storage and AI-call paths behind small endpoints first, observed individually, before stitching them into the UI form.
- **Status:** done

### S-02: Location management

- **Outcome:** A signed-in user can rename a location, delete a location (with a warning if it still contains plants), and view a list of all their locations with the number of plants per location.
- **Change ID:** location-management
- **PRD refs:** FR-005, FR-006, FR-007
- **Prerequisites:** F-01, F-02
- **Parallel with:** S-01 (no data dependency between location-management and plant-creation once the schema exists)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Trivial CRUD with one gotcha — FR-006 mandates a non-empty-warning UX before delete; easy to forget when copying form patterns from the plant or auth screens.
- **Status:** done

### S-03: Plant management

- **Outcome:** A signed-in user can open a plant's detail screen showing all stored care info and the original AI suggestion, edit any field in place (no separate edit mode), delete the plant, and add a free-text note.
- **Change ID:** plant-management
- **PRD refs:** FR-015, FR-016, FR-017
- **Prerequisites:** S-01
- **Parallel with:** S-04, S-05 (once S-01 lands, plant-management and the reminder loops are independent)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The editable-detail-screen is the busiest UI in the app — per FR-015 there is no read-only / edit-mode split, so every field needs inline validation, save-on-blur or save-on-confirm semantics, and an undo path consistent with US-03 AC for the care actions.
- **Status:** done

### S-04: Watering reminder loop

- **Outcome:** A signed-in user opens the app and sees today's care list aggregated across all their locations (FR-021); when a plant's watering interval has elapsed, the user receives a reminder identifying the specific plant(s); the user marks the plant(s) watered — single or bulk "mark all watered" — which resets the interval and removes them from today's care list; the user can snooze a reminder one or more days when care can't happen today.
- **Change ID:** watering-reminder-loop
- **PRD refs:** US-02 (watering side), US-03 (mark-watered + bulk requirement + undo window), FR-018, FR-020, FR-021, FR-022, Guardrail "reminders are not noisy"
- **Prerequisites:** F-03, S-01
- **Parallel with:** S-03, S-05
- **Blockers:** —
- **Unknowns:**
  - PRD Open Question 1: notification delivery channel (email / web push / in-app / combination) — Owner: user, before tech-stack selection (already past, default applies). Block: no — defaults to email-only per PRD; needs email provider key (Resend / Postmark / etc.) chosen at `/10x-plan` time.
  - PRD Open Question 3: reminder cap / batching rules (one daily digest per user vs one notification per plant vs threshold-based) — Owner: user, by PRD finalization. Block: no — defaults to one daily digest per user listing all plants needing care.
- **Risk:** Highest moving-part count in the roadmap — cron tick + DB read of "what needs care today" + email provider call + UI state for mark-done + undo window + snooze deferral + the bulk action. Defer any one of these to a follow-up slice and the loop doesn't close — the Success Criterion #3 requires reminder → care-marked-done within the first 2 weeks of use. Under main_goal=speed, default both Open Questions instead of waiting for them to resolve.
- **Status:** done

### S-05: Winterization reminder

- **Outcome:** A signed-in user receives a reminder when a plant's winterization cutoff is approaching (fired once per winterization window per plant, not periodically); marking the plant winterized resets the seasonal flag and removes it from any active winterization list.
- **Change ID:** winterization-reminder
- **PRD refs:** US-02 (winterization side), US-03 (mark-winterized), FR-019, FR-020
- **Prerequisites:** F-03, S-01
- **Parallel with:** S-03, S-04
- **Blockers:** —
- **Unknowns:**
  - Same as S-04: notification channel (Open Question 1, default email-only) and batching rules (Open Question 3, default daily digest).
- **Risk:** Winterization is seasonal — testing requires either fake-clock infrastructure or shipping near the actual winterization window for one of the user's own plants, neither of which fits cleanly into a 3-week speed budget. This is the first slice to defer or simplify if the watering loop alone has consumed the time budget; a stub that only emits a single reminder on a single hard-coded cutoff date may be acceptable as a v1 surface.
- **Status:** done

## Backlog Handoff

| Roadmap ID | Change ID               | Issue                                                           | Title                                                                     | Ready for `/10x-plan` | Notes                                          |
| ---------- | ----------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------- | ---------------------------------------------- |
| F-01       | magic-link-auth         | [#1](https://github.com/SzymonSwiatek/PlantsInventory/issues/1) | Replace password auth scaffold with magic-link sign-in (FR-001/002/003)   | yes                   | Run `/10x-plan magic-link-auth`                |
| F-02       | domain-schema-with-rls  | [#2](https://github.com/SzymonSwiatek/PlantsInventory/issues/2) | Land Postgres schema for locations + plants + care-events with RLS        | yes                   | Run `/10x-plan domain-schema-with-rls`         |
| F-03       | cron-scheduled-skeleton | [#3](https://github.com/SzymonSwiatek/PlantsInventory/issues/3) | Add `scheduled()` Worker entry + cron trigger + smoke test                | yes                   | Run `/10x-plan cron-scheduled-skeleton`        |
| S-01       | first-plant-from-photo  | [#4](https://github.com/SzymonSwiatek/PlantsInventory/issues/4) | North star — add a plant from a photo with AI-suggested care info         | no                    | Blocked on F-01 + F-02                         |
| S-02       | location-management     | [#5](https://github.com/SzymonSwiatek/PlantsInventory/issues/5) | Location rename / delete (with non-empty warning) / list with counts      | no                    | Blocked on F-01 + F-02                         |
| S-03       | plant-management        | [#6](https://github.com/SzymonSwiatek/PlantsInventory/issues/6) | Plant detail (editable in place) + delete + free-text note                | no                    | Blocked on S-01                                |
| S-04       | watering-reminder-loop  | [#7](https://github.com/SzymonSwiatek/PlantsInventory/issues/7) | Watering reminder loop — cron, mark-done (incl. bulk), snooze, today list | no                    | Blocked on F-03 + S-01; defaults for OQ-1/OQ-3 |
| S-05       | winterization-reminder  | [#8](https://github.com/SzymonSwiatek/PlantsInventory/issues/8) | Winterization reminder + mark-winterized                                  | no                    | Blocked on F-03 + S-01; first defer candidate  |

## Open Roadmap Questions

1. **Notification delivery channel** — email, web push (requires PWA + service worker + permissions UX), in-app only, or a combination? PRD calls this the second-biggest cost driver after AI vision. Owner: user. Block: no — defaults to email-only for S-04, S-05 if unresolved by `/10x-plan` time. Email-provider choice (Resend, Postmark, etc.) is downstream of this.
2. **"Minor edit" definition for the 75% acceptance metric** — does adding a single field count as edit-acceptance or rejection? Owner: user. Block: S-01 instrumentation can ship without this (record edit-count and per-field changes; apply the threshold later).
3. **Reminder cap / batching rules** — exact threshold for "not noisy" (one digest per day vs one notification per plant vs threshold-based). Owner: user. Block: S-04, S-05 design — defaults to one daily digest per user listing all plants needing care.
4. **Reminder delivery-latency precision** — explicit NFR for "reminders fire within N minutes of scheduled time" was raised in PRD and not adopted. Owner: user. Block: none — defaults to best-effort within the chosen channel's constraints (Cloudflare cron 1-minute floor + email provider latency).
5. **Accessibility floor (WCAG 2.1 Level A)** — raised in PRD and not adopted for v1. Owner: user. Block: none — revisit before any external user feedback round.
6. **AI provider disclosure** — single-named-provider transparency was raised in PRD and not adopted as an NFR. Owner: user. Block: pre-launch checklist (not roadmap). Decision needed before any public launch.

## Parked

- **AI chat for plant disease diagnosis** — PRD §Non-Goals (v2 after the catalog + AI vision + reminder loop ships).
- **Sharing locations or plants between users** — PRD §Non-Goals (v2+ would require rethinking the access model; v1 strictly single-user).
- **Photo gallery per plant** — PRD §Non-Goals (one current photo per plant, replaceable via plant edit).
- **Inventory change history / journal-style tracking** — PRD §Non-Goals (no audit log, no time-series of care actions; today's-state only).
- **Native mobile apps** — PRD §Non-Goals (responsive web only).
- **"Sign me out of all devices"** — PRD shape-notes FR-003 socratic, intentionally not added to v1.
- **Location reorder** — PRD shape-notes FR-007 socratic, deferred.
- **Plant search / filter** — PRD shape-notes FR-014 socratic, deferred (becomes useful at 100+ plants; v1 caters to dozens).
- **WCAG 2.1 Level A baseline** — PRD Open Question 5, deferred to v1.1 / external feedback.
- **Application-level observability beyond Workers Logs** — under main_goal=speed, Sentry / metrics / structured logging are out; `wrangler tail` plus existing `observability.enabled` is the v1 floor.

## Done

- **F-01: (foundation) Magic-link sign-in replaces the existing password scaffold; entering an email sends a single-use link; clicking the link creates the account on first use and signs the user in on subsequent uses; sign-out works from any authenticated screen.** — Archived 2026-06-14 → `context/archive/2026-05-29-magic-link-auth/`. Lesson: —.
- **F-02: (foundation) locations + plants + care-events tables exist with per-user RLS** — Archived 2026-06-14 → `context/archive/2026-06-04-domain-schema-with-rls/`. Lesson: —.
- **S-01: A signed-in user creates their first location, taps "Add plant", uploads a photo, sees an AI-suggested species + care profile within ~10 seconds, accepts or edits any field (or replaces the suggestion entirely), and saves the plant into the chosen location. The plant is immediately visible in the location's plant list. The manual-creation fallback works if the AI is unavailable.** — Archived 2026-06-14 → `context/archive/2026-06-08-first-plant-from-photo/`. Lesson: —.
- **S-02: A signed-in user can rename a location, delete a location (with a warning if it still contains plants), and view a list of all their locations with the number of plants per location.** — Archived 2026-06-19 → `context/archive/2026-06-18-location-management/`. Lesson: —.
- **S-03: A signed-in user can open a plant's detail screen showing all stored care info and the original AI suggestion, edit any field in place (no separate edit mode), delete the plant, and add a free-text note.** — Archived 2026-06-19 → `context/archive/2026-06-19-plant-management/`. Lesson: —.
- **F-03: (foundation) Worker `scheduled()` handler runs on cron; survives adapter rebuilds** — Archived 2026-06-21 → `context/archive/2026-06-20-cron-scheduled-skeleton/`. Lesson: —.
- **S-04: A signed-in user opens the app and sees today's care list aggregated across all their locations (FR-021); when a plant's watering interval has elapsed, the user receives a reminder identifying the specific plant(s); the user marks the plant(s) watered — single or bulk "mark all watered" — which resets the interval and removes them from today's care list; the user can snooze a reminder one or more days when care can't happen today.** — Archived 2026-06-23 → `context/archive/2026-06-21-watering-reminder-loop/`. Lesson: —.
- **S-05: A signed-in user receives a reminder when a plant's winterization cutoff is approaching (fired once per winterization window per plant, not periodically); marking the plant winterized resets the seasonal flag and removes it from any active winterization list.** — Archived 2026-06-23 → `context/archive/2026-06-21-winterization-reminder/`. Lesson: —.
