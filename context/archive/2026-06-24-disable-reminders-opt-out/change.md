---
change_id: disable-reminders-opt-out
title: Let users disable watering/winterization reminder emails
status: archived
created: 2026-06-24
updated: 2026-06-30
archived_at: 2026-06-30T14:11:54Z
---

## Notes

Give users a way to opt out of the daily reminder digest (watering + winterization).

Decisions locked in discussion:
- **Mechanism: both** — a signed one-click email unsubscribe link (no login) *and* an in-app settings toggle (the re-enable path).
- **Granularity: single master switch** — one `reminders_enabled` flag covering both watering and winterization.
- **Storage: new `user_preferences` table** — per-user RLS, bulk-queryable by the cron; default = enabled by absence of a row (no backfill).

Enforcement point: `runScheduledTick` (`src/lib/reminders/scheduled.ts`) skips opted-out users before the per-user `auth.admin.getUserById` + send loop. Email link uses a stateless HMAC token (`HMAC-SHA256(user_id, secret)`); route handles GET (confirmation page) + POST (RFC 8058 one-click) and sets `List-Unsubscribe` / `List-Unsubscribe-Post` headers. Settings page at `/settings` (add to `PROTECTED_ROUTES`).
