# Winterization Reminder — Plan Brief

> Full plan: `context/changes/winterization-reminder/plan.md`

## What & Why

Close the winterization reminder loop (roadmap S-05) as an additive twin of the already-built watering loop. When a plant reaches its winterization cutoff, it shows in a distinct "Bring indoors or secure before cutoff" section of the existing daily digest email and on `/today`; the user marks it winterized (single or "mark all") with a short Undo. This satisfies PRD US-02 (winterization side), US-03 (mark-winterized), FR-019, FR-020 — and turns the seasonal cutoff the user already records into an acted-upon reminder.

## Starting Point

The watering loop (S-04) is fully shipped, so the email + service-role + cron plumbing already exists. The schema already carries `plants.winterization_cutoff` (set at create, editable, AI-suggested) and `plants.winterized_at` (never written yet), and `care_events.kind` already includes `'winterize'`. The cron (`src/lib/reminders/scheduled.ts`) and `/today` are watering-only today. Nothing about winterization is wired — but no new infrastructure or columns are needed.

## Desired End State

Once a plant's cutoff is reached, the user sees it on `/today` and in their once-daily digest (winterization as a distinct, labeled section beside watering). Marking winterized — one or all — records a `winterize` care-event, stamps `winterized_at`, and clears it from the list, with a ~5s Undo. The reminder re-sends daily for 30 days from the cutoff or until acted, then goes quiet. Each year the same plant re-appears automatically when its cutoff month/day comes around again.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| "Once per window" vs daily | Re-send daily until acted | User overrode the roadmap's "once" framing — same nudge model as watering | Plan |
| Annual recurrence | Compute this-year cutoff from stored month/day | User sets the cutoff once; each year is calculated, no manual reset | Plan |
| Dedup mechanism | Compare `winterized_at` to this-year cutoff | Gives both per-season dedup and annual reset with zero new columns | Plan |
| Lead time | Fire **on** the cutoff date | User chose no advance warning | Plan |
| Re-send tail | Stop at cutoff + 30 days | Honors the "not noisy" guardrail for an ignored plant | Plan |
| Surface | Distinct section in the same digest **and** `/today` | PRD "distinguishable" + "not noisy"; maximal reuse | Plan |
| Predicate home | `security_invoker` SQL view | Can't express `make_date(year, month, day)` in PostgREST; one definition, RLS-correct for both cron and UI | Plan |
| Care actions | Mark + Mark-all + Undo (no snooze) | Undo honors US-03; snooze is redundant given daily re-send | Plan |
| Email opt-out (`idea-notes2.md`) | Deferred to its own slice | Needs orthogonal per-user-settings infra; out of scope for S-05 | Plan |

## Scope

**In scope:** a `winterization_due_plants` view + partial index; a winterization section in the existing digest; `/api/plants/winterize` (single+bulk) and `/winterize-undo`; a winterization section on `/today`.

**Out of scope:** email opt-out (own slice); snooze; lead-time warning; a separate email/page; any change to the watering logic or to how the cutoff is captured.

## Architecture / Approach

Bottom-up, four additive phases. (1) A `security_invoker` view encapsulates the seasonal "due" predicate — `this_year_cutoff = make_date(year(now), month(cutoff), day(cutoff))`, due when the cutoff is reached, within a 30-day tail, and `winterized_at` is null or older than this year's cutoff — so the cron (service-role, all users) and `/today` (session client, own rows via RLS) share one definition. (2) The cron queries the view and adds a winterization section to each user's existing digest, unioning users so a winter-only user still gets one email. (3) Mark-winterized + undo endpoints mirror `water.ts`/`water-undo.ts` (swap `kind` and the timestamp column). (4) `/today` renders the winter list in a distinct section reusing the `TodayList` optimistic-update + Undo-toast flow.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. "Due" data foundation | `winterization_due_plants` view + index | Seasonal predicate correctness (this-year cutoff, tail, annual reset) |
| 2. Cron digest section | Winterization section in the per-user digest | Unioning users so a winter-only user still gets emailed |
| 3. Winterize endpoints | Mark (single+bulk) + undo | Undo restoring `winterized_at` from the care-event log |
| 4. `/today` + UI | Distinct winterization section with mark/undo | react-compiler rules; one shared Toaster/loading state across two sections |

**Prerequisites:** F-03 (cron) + S-01 (plants) + S-04 (watering loop) — all done. Reuses the existing Resend + service-role secrets; no new env or accounts.
**Estimated effort:** ~2-3 sessions across 4 phases (leaner than S-04 — no infra phase).

## Open Risks & Assumptions

- `security_invoker` views require Postgres 15+ — assumed true on Supabase (it is).
- Leap-day cutoffs (Feb 29) and December cutoffs whose 30-day tail spills into January are accepted, documented out-of-scope edges (impossible/irrelevant for autumn cutoffs).
- Seasonal behavior is hard to observe live; tested via seeded rows + injectable `now` + manual SQL rather than waiting for a real cutoff.

## Success Criteria (Summary)

- A user with a plant past its cutoff sees it on `/today` and in a distinct winterization section of their daily digest (and a winter-only user still gets an email).
- Mark winterized (single + all) and Undo work and update the list immediately.
- A winterized plant stays gone until next year's cutoff, then re-appears automatically — with no new columns or user action.
