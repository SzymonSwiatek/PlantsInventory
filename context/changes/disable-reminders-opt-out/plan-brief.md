# Disable Watering/Winterization Reminders (User Opt-Out) — Plan Brief

> Full plan: `context/changes/disable-reminders-opt-out/plan.md`

## What & Why

Let users turn off the daily reminder digest (watering + winterization). Today reminders are mandatory for anyone with due plants; there's no opt-out, which is a trust and email-deliverability gap (no `List-Unsubscribe`). This adds two ways to disable — a one-click email link and an in-app settings toggle — backed by a per-user flag the reminder cron respects.

## Starting Point

Reminders are already built: a daily `0 18 * * *` cron (`worker.ts` → `runScheduledTick`) scans due plants with a service-role client, groups by user, and sends a Resend digest. There is no user-preferences store, no unsubscribe surface, and no `/settings` page. The cron already fails closed (sends nothing) on a query error.

## Desired End State

A user can click "Unsubscribe" in any digest (no login) or flip a toggle at `/settings` to stop reminders; the next cron tick skips them entirely. Re-enabling is via `/settings`. With no preference row, a user receives reminders exactly as today. The app still builds/runs with the new secret unset.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Mechanism | Email link **and** settings toggle | Email link is the literal "by email" ask + deliverability; settings is the re-enable path | Discussion |
| Granularity | Single master switch | One `reminders_enabled` flag covers both reminder types | Discussion |
| Storage | New `user_preferences` table | Per-user RLS, bulk-queryable by the cron, extensible; default = enabled by absence | Discussion |
| Token | Stateless HMAC (Web Crypto) | No token table/cleanup; works in workerd for both sign (cron) and verify (route) | Plan |
| Cron lookup failure | Skip the whole tick | Matches existing fail-closed water/winter error handling; never emails a possible opt-out | Plan |
| Unsubscribe page | Confirmation + link to `/settings` | Simplest; re-enable requires login (one token direction only) | Plan |
| Secret unset | Degrade gracefully | Omit link + header, route refuses — preserves "runs unconfigured" guardrail | Plan |

## Scope

**In scope:** `user_preferences` table + RLS; cron opt-out filter; HMAC token util; digest unsubscribe link + `List-Unsubscribe` headers; unsubscribe route (GET page + POST one-click); `/settings` page + toggle island + preferences API; nav link.

**Out of scope:** per-type opt-out; email re-enable link; general settings shell / frequency / quiet hours; data backfill; cron-schedule or due-logic changes.

## Architecture / Approach

One small table keyed by `user_id` with `reminders_enabled boolean default true`. Two write paths converge on an `upsert`: an unauthenticated unsubscribe route authenticated by a per-user HMAC token (from the email), and a session-scoped `/api/preferences` route under RLS (from the settings toggle). The cron reads the opted-out set (`reminders_enabled = false`) once per tick and skips those users before the per-user email lookup/send loop.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data model | `user_preferences` table + RLS + regenerated DB types | DB types regen vs hand-edit drift |
| 2. Cron filter | Tick skips opted-out users; fail-closed on lookup error | Filter placement / fail-mode correctness |
| 3. Email link | HMAC token util, digest link + headers, unsubscribe route | RFC 8058 one-click POST must auth by token, not session |
| 4. Settings toggle | `/settings` page + toggle island + preferences API | Standard CRUD; lowest risk |

**Prerequisites:** local Supabase for migration + type regen (`npx supabase start`); `REMINDER_UNSUBSCRIBE_SECRET` for end-to-end email testing.
**Estimated effort:** ~2–3 sessions across the four phases.

## Open Risks & Assumptions

- DB types are regenerated from a local stack; if unavailable, hand-editing `database.types.ts` must exactly match the migration.
- One-click unsubscribe relies on mail clients honoring RFC 8058 headers; the visible footer link is the fallback.
- Fail-closed cron means a transient preferences-query error skips that day's reminders for everyone (accepted, matches existing behavior).

## Success Criteria (Summary)

- An opted-out user (via either path) receives no digest on the next tick; a default user still does.
- The unsubscribe link works without login (click + native one-click) and flips the flag idempotently.
- `/settings` round-trips the toggle and persists; re-enabling restores reminders.
