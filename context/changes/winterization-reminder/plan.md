# Winterization Reminder Implementation Plan

## Overview

Close the winterization reminder loop (roadmap S-05) as an **additive twin** of the already-built watering loop (S-04). When a plant's winterization cutoff is reached, it appears in a distinct "Bring indoors or secure before cutoff" section of the existing daily digest email and on the `/today` page; the user marks it winterized (single or "mark all") with a short Undo window. The reminder re-sends daily from the cutoff date for a 30-day window, stops once the user acts, and **recurs every year** — the user sets the cutoff once and each year's cutoff is computed from its month/day. This satisfies PRD US-02 (winterization side) and US-03 (mark-winterized) and FR-019/FR-020.

## Current State Analysis

The watering loop is fully shipped and is the direct template; the email + service-role + cron plumbing already exists, so winterization is **purely additive** — no new infrastructure.

- **Schema already carries every column needed.** `plants.winterization_cutoff` (a `date`) is set at plant-create (`src/pages/api/plants/index.ts:75`), editable (`src/pages/api/plants/[id].ts:77`), and AI-suggested (`src/lib/ai/suggest.ts:27` — "the month/day each year after which the plant should be brought indoors"). `plants.winterized_at` (timestamptz) exists but is **never written yet**. The `care_events.kind` enum already includes `'winterize'` (`supabase/migrations/20260608171954_core_domain_schema.sql:21`). **No new columns are required.**
- **The cron is live and watering-only.** `src/lib/reminders/scheduled.ts` (`runScheduledTick(now, env)`) queries due watering plants via a service-role client, groups by user, composes one digest (`src/lib/reminders/email.ts` `composeDigest`), and sends via Resend with per-user error isolation. `wrangler.jsonc` fires `0 18 * * *` daily. Winterization extends this same tick.
- **`/today` is watering-only.** `src/pages/today.astro` queries due watering plants with the session client and hydrates `src/components/today/TodayList.tsx` (mark / mark-all / undo / snooze). `/today` is already in `PROTECTED_ROUTES`.
- **Care endpoints are the template.** `src/pages/api/plants/water.ts` (mark, single+bulk), `water-undo.ts` (revert from the care-event log), `snooze.ts` — all self-guard via `requireUser`, use the session client, lean on RLS + the `care_events` same-user FK-guard trigger (`...schema.sql:155`), and map `CLIENT_ERROR_CODES` → 400.
- **The hard part is the "due" predicate, and it can't be expressed in PostgREST filters.** "Due" = *this year's cutoff (the stored month/day applied to the current year) has been reached, within a 30-day tail, and the plant hasn't been winterized this season.* That requires `make_date(current_year, month(cutoff), day(cutoff))`, which the Supabase JS `.from().select().filter()` chain can't compute. Both the cron (service-role, all users) and `/today` (session client, own rows via RLS) need the **same** predicate.

## Desired End State

A signed-in user with at least one plant that has a `winterization_cutoff`:

- Opens `/today` and, once the cutoff is reached, sees that plant in a distinct **"Bring indoors or secure before cutoff"** section alongside the watering list, with Mark winterized / Mark all winterized / Undo controls.
- Marks plants winterized — single or all — which records a `winterize` care-event, sets `winterized_at`, and removes them from the list immediately; a ~5s Undo toast reverts the action.
- Receives, in the **same** once-daily digest email, a winterization section listing exactly the plants past their cutoff (re-sent daily for 30 days from the cutoff, or until winterized), with the watering section still present and distinguishable.
- The next calendar year, the same plant re-appears when its cutoff month/day is reached again — automatically, with no user action.

**Verification:** `npm run test:run`, `npm run lint`, `npx astro sync` clean; migration applies via `npx supabase db reset`; a manual walkthrough of mark → undo on `/today`'s winterization section; and a manually triggered cron tick that emails a combined digest with the winterization section scoped per user.

### Key Discoveries:

- **No new columns.** `winterization_cutoff` + `winterized_at` + the `winterize` enum value already exist (`...schema.sql:62-63,21`). Annual recurrence falls out of comparing `winterized_at` to the recomputed this-year cutoff — no `reminded_at` column, no snooze column.
- **A `security_invoker` view is the right home for the predicate** (`src/lib/...` consumers query it identically). Under `security_invoker = true` (Postgres 15+, which Supabase runs), the view honors the querying role's RLS: the cron's service-role client bypasses RLS (all users), the `/today` session client gets only the owner's rows — one definition, two correct behaviors.
- **`water-undo.ts` is the exact pattern for `winterize-undo`** (`src/pages/api/plants/water-undo.ts`): delete the most-recent kind-scoped care-event per plant, restore the plant timestamp to the now-most-recent remaining event's `done_at` (or NULL). Swap `kind: 'water'` → `'winterize'` and `last_watered_at` → `winterized_at`.
- TZ is pinned to UTC in `vitest.setup.ts`, so the seasonal date math is deterministic in unit tests; the cron already takes an injectable `now`, and tests mock the Supabase client wholesale (so the view's internal `now()` is never exercised in unit tests).

## What We're NOT Doing

- **Email opt-out / "turn off notifications"** (`idea-notes2.md`) — deferred to its own slice. It needs new per-user-settings infrastructure (a settings table + RLS + a settings UI) orthogonal to winterization; folding it in here would expand scope well beyond S-05.
- **A lead-time / "approaching" warning** — the reminder fires **on** the cutoff date itself (user decision), not N days before.
- **Snooze for winterization** — not built. The daily re-send already forgives a missed day; S-05 maps to FR-019/FR-020, not FR-022. No `winter_snooze_until` column.
- **A separate winterization email or page** — winterization shares the existing digest and `/today`, as distinct sections (honors PRD "distinguishable" + "not noisy").
- **Touching the watering logic** — the watering query, trigger, endpoints, and the `next_water_due_at` lifecycle are untouched; winterization is additive.
- **Changing how `winterization_cutoff` is captured** — create/edit/AI-suggest paths already populate it; this slice only reads it.

## Implementation Approach

Build bottom-up so each phase is independently verifiable: (1) encapsulate the seasonal "due" predicate in a DB view so cron and UI share one definition; (2) extend the cron tick to add a winterization section to the existing per-user digest; (3) add the mark-winterized + undo endpoints mirroring the water endpoints; (4) surface the winterization section on `/today`. Phases 2 and 3–4 are independent once Phase 1 lands; the listed order keeps the dependency chain simple and lets the digest be observed before the UI exists.

The "due" rule lives in the database (a `security_invoker` view) so the cron and the page can never drift. Annual recurrence and the "fire once you act" dedup are both expressed by comparing `winterized_at` against the recomputed this-year cutoff — no extra state to maintain.

## Critical Implementation Details

- **The view, not a column, owns the seasonal predicate.** `this_year_cutoff = (make_date(year(now), month(winterization_cutoff), 1) + (day(winterization_cutoff) - 1) * interval '1 day')::date` — build the date from the first of the month plus a day-offset interval rather than `make_date(year, month, day)` directly, because `make_date` **raises** "date field value out of range" on an invalid day (e.g. Feb 29 in a non-leap year) and that error aborts the *entire* view SELECT — and since the cron scans all users in one service-role query, a single such row would kill winterization for every user that tick. The interval form can't raise: a Feb-29 cutoff in a non-leap year rolls forward to Mar 1. Due ⇔ `this_year_cutoff <= current_date AND current_date <= this_year_cutoff + 30 AND (winterized_at IS NULL OR winterized_at < this_year_cutoff)`. The `winterized_at < this_year_cutoff` clause is what makes it both **dedup** (this season: once `winterized_at >= this_year_cutoff`, not due) and **annual recurrence** (next year `this_year_cutoff` advances past last year's `winterized_at`, so due again). The stored year on `winterization_cutoff` is ignored — only its month/day matter — so an AI-suggested past-year date still works.
- **Leap-day + year-boundary edge.** The this-year cutoff is computed with the non-raising interval form above (first-of-month + day-offset), so a Feb-29 cutoff in a non-leap year rolls forward to Mar 1 instead of aborting the cron-wide view scan — this is required, not optional, because `make_date(year, month, day)` would raise and poison the whole service-role query. A December cutoff with a 30-day tail spilling into January is effectively impossible for autumn winterization cutoffs and is accepted as an out-of-scope edge for v1 (document in the migration comment); do not add season-spanning logic for it.
- **`security_invoker` requires the join inside the view, not PostgREST embedding.** Expose `location_name` as a plain column (join `locations` inside the view) rather than relying on `.select("locations(name)")` embedding, which needs FK metadata PostgREST doesn't infer for views. Consumers select flat columns.
- **The cron must union users across both queries.** Today the loop iterates only water-due users. A user with *only* winterization-due plants must still get an email — build a combined per-user map (water list + winter list) and skip only users with neither.

## Phase 1: Winterization "due" data foundation

### Overview

Encapsulate the seasonal due-predicate in a `security_invoker` view both the cron and `/today` query, and add a partial index for the scan. No new columns; no backfill.

### Changes Required:

#### 1. Winterization-due view + index migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_winterization_due.sql` (new)

**Intent**: Add a `winterization_due_plants` view computing the this-year cutoff and filtering to plants currently in their winterization window and not yet winterized this season, plus a partial index on `winterization_cutoff` for the cron scan.

**Contract**: `create view winterization_due_plants with (security_invoker = true) as …` selecting `id, user_id, name, location_id, location_name (joined from locations), winterization_cutoff, this_year_cutoff`. Predicate as in Critical Implementation Details. Add `create index plants_winterization_cutoff_idx on plants (winterization_cutoff) where winterization_cutoff is not null;`. **Grant SELECT explicitly** — `grant select on winterization_due_plants to authenticated, anon;` — this is the repo's first view, so unlike existing tables it shouldn't rely on inherited default privileges; cheap insurance against a silent "permission denied for view" (which `today.astro` would swallow as an empty section, since it ignores `.error`). Document the leap-day/year-boundary edges in a comment. Forward-only, re-runnable on a fresh DB; no data migration. After applying, **regenerate `src/db/database.types.ts`** so the view is typed for the client: `npx supabase gen types typescript --local > src/db/database.types.ts` (requires a running local stack via `npx supabase start`), then `npx astro sync`. The generated file is committed and lint/format-excluded — do not hand-edit it.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly on a fresh DB: `npx supabase db reset`
- Type generation + lint pass: `npx astro sync && npm run lint`
- Existing tests pass: `npm run test:run`

#### Manual Verification:

- A plant whose `winterization_cutoff` month/day is today (any stored year) appears in `select * from winterization_due_plants` (checked via SQL/Supabase studio)
- A plant winterized this season (`winterized_at` ≥ this-year cutoff) is absent; one winterized only last season is present
- A plant whose cutoff is >30 days past is absent (tail window holds)
- Querying the view **as the session client** (not service-role) returns rows for the owner — confirms the GRANT is in effect, not just that RLS scopes the result; a second user sees only their own rows (RLS via `security_invoker`)

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Cron digest — winterization section

### Overview

Extend the existing daily tick to also query the winterization view (service-role) and render a distinct "Bring indoors or secure before cutoff" section in the same per-user digest, unioning users so a winter-only user still gets one email.

### Changes Required:

#### 1. Extend the digest composer

**File**: `src/lib/reminders/email.ts`

**Intent**: Render both a watering section and a winterization section in one email, with a subject that reflects whichever sections are non-empty.

**Contract**: Add a `DueWinterPlant` type (`name`, `locationName`, `cutoff: string`). Refactor `composeDigest` to take both lists — e.g. `composeDigest(input: { water: DuePlant[]; winter: DueWinterPlant[] }, siteUrl: string)` — returning `{ subject, html, text }`. Watering section keeps its current copy; winterization section is headed **"Bring indoors or secure before cutoff"** and lists each plant + location (+ its cutoff). Subject: water-only and winter-only phrasings plus a combined form when both are present. Keep `escapeHtml` on all interpolated names/locations. Update the existing `composeDigest` callers and `email.test.ts` to the new signature.

#### 2. Query winterization-due plants in the tick

**File**: `src/lib/reminders/scheduled.ts`

**Intent**: After the watering query, query the winterization view via the service-role client, group by user, build a combined per-user map, and send one digest per user with whichever sections apply.

**Contract**: Add a `supabase.from("winterization_due_plants").select("name, user_id, location_name, winterization_cutoff")` query (service-role bypasses RLS → all users). Map rows to `DueWinterPlant`. Build a combined `Map<userId, { water: DuePlant[]; winter: DueWinterPlant[] }>` from both queries (union of user ids). For each user with ≥1 plant in either list: look up the email once (existing `auth.admin.getUserById` path), `composeDigest({ water, winter }, siteUrl)`, `sendDigest` — preserving the existing per-user try/catch isolation and the `scheduled.email_error` log. A user with zero due plants in both lists gets no email. Extend the `scheduled.summary` log counts to include winterization.

### Success Criteria:

#### Automated Verification:

- `composeDigest` unit test: winter-only, water-only, and combined inputs each produce the right sections/subject; the winterization heading is present: `npm run test:run`
- Tick unit test: winter-due rows are grouped by user; a winter-only user is included in the send set (mock the service client)
- Fault test: a `sendDigest` rejection for one user does not abort others (existing `scheduled.fault.test.ts` pattern still passes / is extended)
- Lint passes: `npm run lint`

#### Manual Verification:

- Trigger the scheduled handler with seeded winter-due plants for 2 users ⇒ each gets a digest whose winterization section names only their own plants
- A user with only winter-due plants (no water due) still receives an email
- A plant winterized this season is absent from the next tick's digest

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Care API — winterize endpoints

### Overview

Add the user-facing mutation endpoints: mark-winterized (single + bulk) and undo, mirroring the water endpoints, self-guarded and RLS-scoped.

### Changes Required:

#### 1. Mark-winterized endpoint

**File**: `src/pages/api/plants/winterize.ts` (new)

**Intent**: Mark one or more plants winterized in a single call, writing a `winterize` care-event and stamping `winterized_at`.

**Contract**: Mirror `src/pages/api/plants/water.ts`. `POST { plantIds: string[] }`; self-guard via `requireUser`; validate ids with `UUID_RE`; cap at `MAX_BULK` (200). Insert `care_events` rows (`kind: 'winterize'`, `done_at: now`) and `update plants set winterized_at = now` for those ids (RLS + FK-guard enforce ownership). Map `CLIENT_ERROR_CODES` → 400; `503` if `supabase` is null. Return `{ winterized: string[] }`. No snooze field is touched.

#### 2. Winterize-undo endpoint

**File**: `src/pages/api/plants/winterize-undo.ts` (new)

**Intent**: Reverse a just-completed mark-winterized, restoring `winterized_at` from the care-event log so the plant reappears as due.

**Contract**: Mirror `src/pages/api/plants/water-undo.ts` exactly with `kind: 'winterize'` and `winterized_at` in place of `'water'`/`last_watered_at`: fetch winterize events for the ids newest-first, per plant delete the most-recent and set `winterized_at` to the now-most-recent remaining event's `done_at` (or NULL). Return `{ reverted: string[] }`. Idempotent per-plant when there's no event to remove.

### Success Criteria:

#### Automated Verification:

- Endpoint tests (mirroring `water.test.ts` / `water-undo.test.ts`): mark-winterized inserts a `winterize` care-event + sets `winterized_at`; bulk marks all ids: `npm run test:run`
- Undo test: reverting restores `winterized_at` to the prior value (or NULL) and removes the just-created event
- Auth test: unauthenticated ⇒ 401; another user's plant id ⇒ rejected with no state change
- Lint passes: `npm run lint`

#### Manual Verification:

- After mark-winterized, the plant disappears from `winterization_due_plants` (verified via SQL)
- Undo within seconds restores the plant as due
- "Mark all" winterizes every supplied id in one call

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: `/today` + UI — winterization section

### Overview

Surface winter-due plants in a distinct section on `/today` with Mark winterized / Mark all winterized / Undo, reusing the `TodayList` interaction patterns.

### Changes Required:

#### 1. Query winter-due plants on the page

**File**: `src/pages/today.astro`

**Intent**: Server-render the winter-due list alongside the watering list via the session client and pass it to the island.

**Contract**: Add a `supabase.from("winterization_due_plants").select("id, name, location_name, winterization_cutoff").order("this_year_cutoff")` query (RLS scopes to the owner). Map to a new `TodayWinterPlant` type (`id`, `name`, `locationName`, `cutoff`) added to `src/types.ts`. Pass both `plants` and the new `winterPlants` to the island.

#### 2. Render the winterization section in the island

**File**: `src/components/today/TodayList.tsx` (extend), `src/types.ts`

**Intent**: Add a distinct **"Bring indoors or secure before cutoff"** section with per-plant Mark winterized + a Mark-all action + a ~5s Undo toast, sharing the island's single `Toaster` and loading state.

**Contract**: Accept a `winterPlants: TodayWinterPlant[]` prop. Add `markWinterized(ids)` / `undoWinterize(ids, restored)` handlers calling `POST /api/plants/winterize` and `/winterize-undo`, mirroring the existing `markWatered`/`undoWater` optimistic-update + Undo-toast flow (reuse `sortPlants` or a sibling sort for the winter list). Render the winter section only when non-empty; the empty-state covers both lists empty. Compiler-safe (no prop/state mutation, rules-of-hooks) per the `react-compiler` error rule; use `cn()`, `lucide-react` icons (e.g. `Snowflake`/`Home`), existing `shadcn/ui` primitives. `/today` is already protected — no middleware change.

### Success Criteria:

#### Automated Verification:

- Lint + type-check pass (incl. `react-compiler`): `npx astro sync && npm run lint`
- Build succeeds: `npm run build`
- Component unit tests pass (extend `today.test.ts` for the winter section): `npm run test:run`

#### Manual Verification:

- `/today` shows a distinct winterization section listing exactly the winter-due plants; watering section unaffected; empty state shows when both lists are empty
- "Mark winterized" and "Mark all winterized" remove plants immediately; the Undo toast restores them within the window
- A winterized plant does not reappear until next year's cutoff (simulate by editing a cutoff / `winterized_at` via SQL)
- Responsive on mobile Safari/Chrome widths (per NFR)

**Implementation Note**: After automated verification passes, pause for final manual confirmation. This phase closes the winterization loop end-to-end (cron digest → `/today` → mark-winterized).

---

## Testing Strategy

### Unit Tests:

- View predicate behavior is validated through `/today` and cron queries against seeded rows (the predicate lives in SQL; exercise it via `npx supabase db reset` + manual SQL and the endpoint/page paths).
- `composeDigest`: winter-only / water-only / combined produce correct sections, subject, and the winterization heading; pluralization correct.
- Mark-winterized sets `winterized_at` + writes a `winterize` event; undo restores prior `winterized_at`; bulk marks all ids.
- Auth/isolation: 401 unauthenticated; cross-user plant id rejected.

### Integration / Fault Tests:

- `sendDigest` failure for one user does not abort the others (extend `scheduled.fault.test.ts`).
- A winter-only user (no water due) is still emailed; zero-due-in-both ⇒ no email.

### Manual Testing Steps:

1. Seed two users with winter-due / not-yet-due / already-winterized plants; trigger the scheduled handler; confirm each user's digest winterization section names only their own due plants and a winter-only user still gets an email.
2. On `/today`: mark a single winter plant, undo it; mark all winterized; confirm the section empties and the watering section is unaffected.
3. Confirm annual recurrence by setting a plant's `winterized_at` to a prior season and re-querying the view (plant reappears).

## Performance Considerations

Target scale is small (PRD: small users, low qps). The cron scan uses the new `plants_winterization_cutoff_idx` partial index; the view's per-row `make_date` is trivial at this volume. The digest groups in memory. No new hotspots. One extra service-role query per tick and one extra session query per `/today` load.

## Migration Notes

One forward-only migration (Phase 1) adds the view and the partial index — no columns, no backfill, no destructive changes; re-runnable on a fresh DB via `npx supabase db reset`. Regenerate `src/db/database.types.ts` after applying so the view is typed: `npx supabase gen types typescript --local > src/db/database.types.ts` (needs `npx supabase start`), then `npx astro sync`.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-05, lines 161-172)
- PRD: US-02 (winterization side), US-03, FR-019, FR-020; Open Questions 1 & 3 (defaults applied)
- Sibling (built) plan: `context/changes/watering-reminder-loop/plan.md`
- Schema (winterization columns + enum): `supabase/migrations/20260608171954_core_domain_schema.sql:21,62-63`
- Cron + email: `src/lib/reminders/scheduled.ts`, `src/lib/reminders/email.ts`
- Care endpoints to mirror: `src/pages/api/plants/water.ts`, `water-undo.ts`
- `/today` + island: `src/pages/today.astro`, `src/components/today/TodayList.tsx`
- User note (deferred): `idea-notes2.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Winterization "due" data foundation

#### Automated

- [x] 1.1 Migration applies cleanly on a fresh DB (`npx supabase db reset`) — 4dd18ba
- [x] 1.2 Type generation + lint pass (`npx astro sync && npm run lint`) — 4dd18ba
- [x] 1.3 Existing tests pass (`npm run test:run`) — 4dd18ba

#### Manual

- [x] 1.4 Plant with cutoff month/day = today appears in the view — 4dd18ba
- [x] 1.5 Winterized-this-season absent; winterized-last-season present — 4dd18ba
- [x] 1.6 Cutoff >30 days past is absent (tail window holds) — 4dd18ba
- [x] 1.7 Session client (not service-role) returns the owner's rows via the view (GRANT in effect); a second user sees only own rows (RLS) — 4dd18ba

### Phase 2: Cron digest — winterization section

#### Automated

- [x] 2.1 `composeDigest` winter-only / water-only / combined produce correct sections + subject + heading — 8654fe6
- [x] 2.2 Tick groups winter-due by user; winter-only user is in the send set — 8654fe6
- [x] 2.3 Fault test: one user's send failure doesn't abort others — 8654fe6
- [x] 2.4 Lint passes — 8654fe6

#### Manual

- [x] 2.5 Two seeded users each get a digest naming only their own winter-due plants — 8654fe6
- [x] 2.6 Winter-only user (no water due) still receives an email — 8654fe6
- [x] 2.7 Plant winterized this season absent from next tick's digest — 8654fe6

### Phase 3: Care API — winterize endpoints

#### Automated

- [x] 3.1 Mark-winterized inserts a `winterize` event + sets `winterized_at`; bulk marks all ids — ea4fc73
- [x] 3.2 Undo restores prior `winterized_at` (or NULL) and removes the event — ea4fc73
- [x] 3.3 401 unauthenticated; cross-user id rejected with no state change — ea4fc73
- [x] 3.4 Lint passes — ea4fc73

#### Manual

- [x] 3.5 After mark-winterized, plant absent from `winterization_due_plants` — ea4fc73
- [x] 3.6 Undo restores the plant as due — ea4fc73
- [x] 3.7 "Mark all" winterizes every supplied id in one call — ea4fc73

### Phase 4: `/today` + UI — winterization section

#### Automated

- [x] 4.1 Lint + type-check pass (incl. react-compiler rule) — 50ea3da
- [x] 4.2 Build succeeds — 50ea3da
- [x] 4.3 Component unit tests pass (winter section) — 50ea3da

#### Manual

- [x] 4.4 `/today` shows a distinct winterization section; watering unaffected; empty state works — 50ea3da
- [x] 4.5 Mark / Mark-all remove plants immediately; Undo restores within window — 50ea3da
- [x] 4.6 Winterized plant doesn't reappear until next year's cutoff — 50ea3da
- [x] 4.7 Responsive on mobile widths — 50ea3da
