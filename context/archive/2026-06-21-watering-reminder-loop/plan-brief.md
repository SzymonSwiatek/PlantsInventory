# Watering Reminder Loop — Plan Brief

> Full plan: `context/changes/watering-reminder-loop/plan.md`

## What & Why

Close the watering reminder loop (roadmap S-04). A daily Cloudflare cron emails each user a digest of plants due for watering; a dedicated `/today` page aggregates due plants across all their locations; users can mark plants watered (single + bulk), undo within a short window, and snooze by N days. This is the slice that satisfies PRD Success Criterion #3 — a user receives and acts on a reminder within their first two weeks — turning the catalog from a passive list into a system that closes the loop between cataloging and care.

## Starting Point

The schema and cron skeleton already exist (F-02, F-03). `plants` carries every reminder column needed (`watering_interval_days`, `last_watered_at`, `next_water_due_at`, `water_snooze_until`) plus a purpose-built partial index, and there's an append-only `care_events` table. `src/worker.ts` runs a `scheduled()` handler on a daily cron (`0 18 * * *`) that currently just logs a heartbeat. Three things are unwired: `next_water_due_at` is never populated (so nothing is ever "due"), the cron has no way to read cross-user data or emails (RLS is `to authenticated`), and there is no email provider.

## Desired End State

A signed-in user opens `/today`, sees every plant due for watering across their locations, and marks them watered (one or "mark all") — with a ~5s Undo toast — or snoozes them for a chosen number of days. Once a day at 18:00 UTC they receive an email naming exactly the plants needing water (and no email when nothing is due), linking back to `/today`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Notification channel | Email-only via **Resend** | PRD default (email-only); Resend is the fastest REST integration and named first in the infra doc | PRD / Plan |
| Batching | One daily digest per user | PRD/roadmap default for the "not noisy" guardrail | PRD |
| Cron data access | Service-role Supabase client | Standard Supabase pattern; one query joins due plants + `auth.users` emails across RLS | Plan |
| `next_water_due_at` lifecycle | DB trigger + one-time backfill | Single source of truth so every writer stays consistent without recomputing | Plan |
| Undo | Server commits, client offers ~5s Undo | Today-list updates instantly and undo survives refresh; reverts from the care-event log | Plan |
| Snooze | User picks days → `water_snooze_until` | Preserves watering-interval integrity (the point of FR-022) | Plan |
| Mark-watered API | One endpoint, array of plant IDs | One code path + one revert path for single and bulk | Plan |
| Today-list surface | Dedicated `/today` page | Focused surface, linked from the dashboard | Plan |
| Overdue behavior | Reappears daily until watered/snoozed | Honest nudge; snooze is the explicit "not today" escape | Plan |
| Digest dedup | `noRetry()` + idempotent daily query | No new state; fits the speed budget; tiny accepted double-send risk | Plan |

## Scope

**In scope:** due-date trigger + backfill; Resend + service-role + secrets plumbing; cron digest logic; mark-watered (single + bulk) / undo / snooze endpoints; `/today` page + UI.

**Out of scope:** winterization (S-05); web push / in-app channels; per-user notification settings; care history UI; hard digest idempotency; editing `POST /api/plants`.

## Architecture / Approach

Bottom-up, five vertical phases: (1) a `BEFORE` trigger makes `next_water_due_at` correct at the data layer + backfills existing rows; (2) plumbing — Resend dep, new secrets, a cron-only service-role client, an email module; (3) the cron queries due-and-not-snoozed plants grouped by user, composes + sends one digest each, with per-user error isolation; (4) self-guarded care endpoints (mark/undo/snooze) reusing the `/api/plants` conventions; (5) a server-rendered `/today` page with a React island for the interactions. The due-date rule lives in the DB; the service-role key is confined to `src/lib/reminders/*` and must never be reachable from request paths.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Due-date foundation | Trigger + backfill so "due" is meaningful | Trigger clobbering an app-set due date |
| 2. Email + service-role infra | Resend, secrets, service-role client, email module | Service-role key leaking into request code |
| 3. Cron digest logic | Daily per-user digest send | `astro:env` access inside `scheduled()`; per-user error isolation |
| 4. Care API endpoints | Mark (single+bulk), undo, snooze | Undo correctly restoring prior state from the log |
| 5. `/today` page + UI | In-app care list + interactions | react-compiler rules; toast/undo timing |

**Prerequisites:** F-03 (cron skeleton) + S-01 (plants exist) — both done. Needs a Resend account + verified sender domain and a Supabase service-role key set as Worker secrets.
**Estimated effort:** ~3-4 sessions across 5 phases.

## Open Risks & Assumptions

- Resend domain verification (SPF/DKIM) must be done before non-sandbox sends — an external dependency outside the code.
- `astro:env/server` secret access inside the `scheduled()` handler is assumed available; fallback is the `env` argument already on the handler signature.
- Cron double-invocation at the platform level could double-email (accepted v1 risk; mitigated by `noRetry()`).

## Success Criteria (Summary)

- A user with due plants receives one daily email naming exactly those plants (and none when nothing is due).
- On `/today`, mark (single + bulk), undo, and snooze all work and update the list immediately.
- A plant's reminder loop resets on mark-watered and defers cleanly on snooze, without corrupting the watering interval.
