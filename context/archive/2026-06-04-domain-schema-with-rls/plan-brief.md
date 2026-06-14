# Domain Schema with RLS (F-02) — Plan Brief

> Full plan: `context/changes/domain-schema-with-rls/plan.md`

## What & Why

Land the Postgres data foundation — `locations`, `plants`, `care_events` — via Supabase migrations, with Row Level Security on every table and a private photo bucket. This is roadmap foundation **F-02**; it owns the per-user isolation guardrail and unlocks every domain slice (S-01–S-05). Get the data model and ownership predicates right here and the slices wire features, not schema.

## Starting Point

Auth scaffold only: no migrations, empty `src/types.ts`, no tables, no RLS. Supabase is configured for local dev (`config.toml`, Postgres 17, storage enabled). The SSR client already resolves the user's JWT, so `auth.uid()` works inside RLS against the real request session.

## Desired End State

`supabase db reset` produces three RLS-protected, per-user-owned tables (CASCADE down the chain), a private `plant-photos` bucket with per-user-folder isolation, and generated types wired into a typed Supabase client plus DTOs in `src/types.ts`. A signed-in user can touch only their own rows and their own Storage folder.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Care-events model | Single `care_events` table + `kind` enum | One RLS policy set, extensible, simplest cron/today queries (roadmap left this open) | Plan |
| Care state storage | Denormalized `next_water_due_at` / `last_watered_at` on `plants` | Today-list + 1-min cron become one indexed scan, not a per-tick aggregate | Plan |
| RLS ownership | Direct `user_id` on every table → `auth.uid() = user_id` | One predicate, no joins in the hot RLS path, standard Supabase pattern | Plan |
| Photo storage | Private bucket + storage RLS **now**; `plants.photo_path` references it | Whole isolation boundary (DB + Storage) lands and is verifiable in one foundation | Plan |
| Delete behavior | `ON DELETE CASCADE` location→plants→care_events, user→all | App warns before delete; retention forbids *background* GC, not explicit deletes | Plan |
| Forward-compat | Full care-profile + reminder columns on `plants` now | One migration defines the durable shape; slices add logic, not schema | Plan |
| RLS verification | Manual two-session deny check now; automated pgTAP **deferred** | User decision — test lands in a later test-plan rollout change | Plan |

## Scope

**In scope:** enum + 3 tables + indexes + `updated_at` trigger + same-user FK guard; full RLS (4 policies/table, `to authenticated`); private bucket + storage-object policies; generated types + typed client + DTOs.

**Out of scope:** domain API/UI/services; reminder & cron logic; AI-vision call; denormalization triggers; automated pgTAP RLS test.

## Architecture / Approach

One migration per concern, ordered so nothing is referenced before it exists and **no table is ever live without its RLS** (schema + policies in the same file). Phase 1: core schema + RLS. Phase 2: bucket (config.toml for local + migration `insert` for remote) + `storage.objects` per-folder policies. Phase 3: `supabase gen types` → typed client → DTOs in `src/types.ts`. Policies use `to authenticated` and `(select auth.uid())` for deny-by-default + initplan caching.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Core schema + RLS | Enum, 3 tables, FKs/CASCADE, indexes, triggers, full RLS | Silent RLS gap — mitigated by same-migration RLS + manual deny check |
| 2. Storage bucket + RLS | Private `plant-photos` bucket, per-user-folder policies | Public-bucket or wrong path-segment policy leaks photos |
| 3. Types + DTOs | Generated types, typed client, `src/types.ts` DTOs | Generated file churns lint/format unless ignored |

**Prerequisites:** none (parallel with F-01/F-03); Docker for local Supabase (`supabase start`).
**Estimated effort:** ~1 focused session across 3 phases.

## Open Risks & Assumptions

- Until the automated pgTAP test lands (later change), the **manual** two-session deny check is the only isolation gate — easy to skip under time pressure; the roadmap's "silent RLS gap" risk stays partially open.
- Denormalized care-state is **app-maintained** (no trigger) — S-04 must update the plant's next-due *and* the event log together, or the today-list desyncs.
- `wrangler rollback` does not undo a migration — apply to remote (`supabase db push`) as a deliberate, separate step.

## Success Criteria (Summary)

- `supabase db reset` applies all migrations; RLS is on for all three tables with ≥4 policies each; `npx astro sync && npm run lint && npm run build` pass.
- A second user cannot read/write the first user's rows or Storage folder (manual deny check).
- The typed client infers domain types and `src/types.ts` exposes the DTOs the slices import.
