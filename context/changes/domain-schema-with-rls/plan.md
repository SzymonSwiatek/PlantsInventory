# Domain Schema with RLS (F-02) Implementation Plan

## Overview

Land the durable Postgres data foundation for 10xPlantsInventory: the `locations`, `plants`, and `care_events` tables via Supabase migrations, with Row Level Security enabled on every table (per-operation, per-role policies tied to `auth.uid()`), a private `plant-photos` Storage bucket with per-user-folder isolation, and generated TypeScript types wired into the app. This is foundation F-02 from the roadmap — it unlocks every domain slice (S-01 through S-05) and owns the per-user isolation guardrail at the storage boundary.

## Current State Analysis

The codebase is the auth scaffold only. Relevant facts discovered:

- **No schema exists.** `supabase/migrations/` does not exist; `src/types.ts` does not exist yet either (it is created in Phase 3, per the CLAUDE.md "shared types in `src/types.ts`" convention). This is genuinely from-scratch DDL — no existing tables, columns, or RLS to reconcile.
- **Supabase is configured for local dev.** `supabase/config.toml` has `[storage] enabled = true` (with a commented-out private-bucket template), `[db] major_version = 17`, `[db.migrations] enabled = true`, and `[db.seed] enabled = true` (`./seed.sql`). The SSR client (`src/lib/supabase.ts`) builds an `@supabase/ssr` cookie-session client from the user's JWT, so `auth.uid()` resolves to the signed-in user inside RLS — the policies will work against the real request session.
- **Photos must go directly to Supabase Storage, not through the Worker.** `context/foundation/infrastructure.md:91` flags the Cloudflare free-tier 10 ms CPU limit: decoding a ~10 MB image in the Worker trips it. So `plants` stores a Storage object path and the bucket carries its own RLS — the Worker never holds image bytes.
- **CI does not run migrations.** `.github/workflows/ci.yml` runs `npx astro sync`, `npm run lint`, `npm run build` (and ignores `context/**` + `**/*.md`). There is **no test runner** and no `supabase db reset` step in CI. Migration-apply and RLS deny-checks are therefore **local** gates in this change.
- **Lint is strict and type-aware** (`strictTypeChecked` + `stylisticTypeChecked`); `eslint .` lints the whole tree. A large generated types file needs to be excluded or it adds noise / churn.

## Desired End State

After this plan:

- `supabase db reset` applies cleanly and produces three RLS-protected tables (`locations`, `plants`, `care_events`) plus a `care_event_kind` enum, owned per-user via a direct `user_id` column, with `ON DELETE CASCADE` from `auth.users` → all rows and from `locations` → `plants` → `care_events`.
- A private `plant-photos` bucket exists with `storage.objects` policies that confine each user to their own `<user_id>/…` folder; `plants.photo_path` references objects in it.
- `src/db/database.types.ts` is generated from the schema, `src/lib/supabase.ts` returns a typed client, and `src/types.ts` exposes domain DTOs (entity + insert/update shapes + the care-event enum + the AI-suggestion JSON shape).
- A signed-in user can read/write only their own rows and only their own Storage folder — verified by a documented two-session deny check (the automated pgTAP regression test is deferred to a later change).

### Key Discoveries:

- Photos direct-to-Storage is mandated by the 10 ms CPU trap — `context/foundation/infrastructure.md:91`.
- Care-events modeling was explicitly left to this plan — `context/foundation/roadmap.md:90`.
- "RLS gaps are silent" is the named foundation risk — `context/foundation/roadmap.md:91`.
- 12-month no-silent-GC retention guardrail — `context/foundation/prd.md:158`. CASCADE on *user-initiated* deletes does not violate it (it forbids background GC, not explicit deletes).
- FR-015 requires the detail screen to show "all stored care info **and the original AI suggestion**" — the original suggestion must be retained separately from the edited values.

## What We're NOT Doing

- **No automated RLS regression test (pgTAP) in this change.** Deferred per user decision; the interim gate is the documented two-session manual deny check. A later change (the `/10x-test-plan` rollout) wires `supabase test db`.
- **No domain API endpoints, services, or UI.** No `src/pages/api/locations|plants|…`, no React components. Those are S-01/S-02/S-03.
- **No reminder/cron logic.** `next_water_due_at`, `water_snooze_until`, `winterization_cutoff`, `winterized_at` columns are *created* here but their write/read logic ships in S-04/S-05 (and the `scheduled()` handler in F-03).
- **No AI-vision call.** The `ai_suggestion` JSON column and `species`/`description` fields are *defined* here; populating them is S-01.
- **No denormalization triggers.** `last_watered_at` / `next_water_due_at` are app-maintained by the slices, not kept in sync by a DB trigger (see Critical Implementation Details).
- **No seed data** beyond what's needed for the manual deny-check (kept out of the committed `seed.sql` unless trivially useful).
- **No Storage orphan cleanup.** DB `CASCADE` removes `plants` rows but **not** the Storage objects at their `photo_path` (there is no DB→Storage cascade). Deleting the corresponding objects is owned by the slices that perform deletes — **S-03** (plant delete) and **S-02** (location delete, which cascades plants) — not by this schema foundation.

## Implementation Approach

Three phases, each one migration or one wiring step, ordered so the schema and its RLS land atomically before anything references them:

1. **Core domain schema + RLS in a single migration** — so a table is never live without its policies (a half-applied migration that creates a table but not its RLS is a silent leak window). Enum → tables → indexes → `updated_at` trigger → same-user FK guard trigger → `ENABLE ROW LEVEL SECURITY` → per-operation policies, all in one file.
2. **Storage bucket + storage RLS** — private bucket via both `config.toml` (local dev parity) and a migration `insert` (remote reproducibility), plus per-user-folder `storage.objects` policies.
3. **Generated types + DTO surface** — `supabase gen types`, type the client generic, expose DTOs from `src/types.ts`, confirm the repo still builds.

## Critical Implementation Details

- **RLS must be enabled in the same migration that creates each table.** Never split "create table" and "enable RLS + policies" across migrations — between them the table is readable by anyone with the anon/authenticated key. Enable RLS and add all policies in the same file, immediately after the table.
- **Policies use `to authenticated` and `(select auth.uid())`.** Scoping `to authenticated` skips evaluation for `anon` (deny-by-default for logged-out). Wrapping `auth.uid()` in a scalar subquery — `(select auth.uid())` — lets Postgres cache it as an initplan instead of re-evaluating per row; this is the documented Supabase performance pattern and matters for the today-list/cron scans.
- **Denormalized care-state is app-maintained, not trigger-maintained.** `last_watered_at` / `next_water_due_at` on `plants` are written by the slices (S-01 on create, S-04 on mark-watered), not by a DB trigger. This keeps DB logic transparent and avoids coupling the interval math into the schema. The plan defines the columns + indexes only; the sequencing contract (a care action updates both the event log *and* the plant's next-due) is owned by S-04.
- **Same-user FK integrity needs a trigger, not just RLS.** A child row's owning FK only checks existence, so a user could attach their own row to another user's parent id. This applies to **both** owning FKs in the schema: `plants.location_id` (a plant pointing at another user's location) and `care_events.plant_id` (a care event pointing at another user's plant — the insert `with check` still passes because `user_id` defaults to `auth.uid()`). Each needs a `BEFORE INSERT OR UPDATE` trigger asserting the referenced parent's `user_id` equals the row's `user_id`; RLS alone does not close either.
- **Commit the generated types file, but exclude it from lint/format — without `.gitignore`-ing it.** `src/db/database.types.ts` is generated and large, so it should be skipped by `eslint .` / `prettier`. But it **must be committed**: CI (`.github/workflows/ci.yml`) runs `npm run build` *without* generating types, and `src/lib/supabase.ts` imports `Database` from it — `.gitignore`-ing the file would drop it from the commit and break the CI build. This repo's ESLint ignores are derived from `.gitignore` (`includeIgnoreFile(gitignorePath)` in `eslint.config.js`, where `.gitignore` already has a `# generated types` section pointing at `.astro/`), so the exclusion must instead be a **new flat-config `{ ignores: ["src/db/database.types.ts"] }` object** in `eslint.config.js`, plus a **new `.prettierignore`** (none exists yet) listing the path. Do **not** add it to `.gitignore`.

---

## Phase 1: Core domain schema + RLS

### Overview

One migration that creates the `care_event_kind` enum and the three tables with all columns, constraints, indexes, the shared `updated_at` trigger, the same-user FK guard, and full RLS — leaving no table live without policies.

### Changes Required:

#### 1. Core schema migration

**File**: `supabase/migrations/<timestamp>_core_domain_schema.sql` (generate with `supabase migration new core_domain_schema`; timestamp follows `YYYYMMDDHHmmss`)

**Intent**: Define the entire relational foundation and lock it down with RLS in a single atomic migration.

**Contract**:

- **Enum**: `care_event_kind` as `('water', 'winterize')`.

- **Table `locations`**: `id uuid pk default gen_random_uuid()`; `user_id uuid not null references auth.users(id) on delete cascade default auth.uid()`; `name text not null` with a `char_length(btrim(name)) between 1 and 100` check; `created_at`, `updated_at` `timestamptz not null default now()`. Index on `(user_id)`.

- **Table `plants`**: `id`, `user_id` (same shape + CASCADE + `default auth.uid()`); `location_id uuid not null references locations(id) on delete cascade`; `name text not null`; care-profile columns (all nullable, AI-fillable / user-editable): `species text`, `description text`, `note text`, `sunlight text` (free text — not an enum, so it never constrains AI output); `photo_path text` (Storage object path, see Phase 2 convention); `ai_suggestion jsonb` (snapshot of the original AI suggestion for the FR-015 "original suggestion" view and the acceptance metric; **treated as write-once by convention** — set on create by S-01 and never overwritten by edits. This immutability is an app convention enforced by the slices, not the DB: the `update` policy still permits writing the column, so no slice should include `ai_suggestion` in a plant-edit update); reminder columns: `watering_interval_days integer` (`check > 0`), `last_watered_at timestamptz`, `next_water_due_at timestamptz`, `water_snooze_until timestamptz`, `winterization_cutoff date` (NULL = "none"), `winterized_at timestamptz`; `created_at`, `updated_at`. Indexes: `(user_id)`, `(location_id)`, and a partial `(user_id, next_water_due_at)` where `next_water_due_at is not null` (today-list + cron scan).

- **Table `care_events`**: `id`; `user_id` (CASCADE + `default auth.uid()`); `plant_id uuid not null references plants(id) on delete cascade`; `kind care_event_kind not null`; `done_at timestamptz not null default now()`; `created_at timestamptz not null default now()`. Index `(plant_id, kind, done_at desc)`.

- **`updated_at` trigger**: one `set_updated_at()` function + `BEFORE UPDATE` triggers on `locations` and `plants`.

- **Same-user FK guards** (two, same pattern): a `BEFORE INSERT OR UPDATE` trigger on `plants` raising an exception unless `(select user_id from locations where id = new.location_id) = new.user_id`, **and** a parallel `BEFORE INSERT OR UPDATE` trigger on `care_events` raising unless `(select user_id from plants where id = new.plant_id) = new.user_id`. (See Critical Implementation Details for why RLS alone is insufficient on either FK.)

- **RLS**: `alter table … enable row level security` on all three tables, then **four separate policies per table** (`select`, `insert`, `update`, `delete`), each `to authenticated`. The ownership predicate pattern (the load-bearing contract every policy and downstream slice depends on):

  ```sql
  -- repeated per table, per operation
  create policy "<table>_select_own" on <table>
    for select to authenticated using ((select auth.uid()) = user_id);
  create policy "<table>_insert_own" on <table>
    for insert to authenticated with check ((select auth.uid()) = user_id);
  create policy "<table>_update_own" on <table>
    for update to authenticated using ((select auth.uid()) = user_id)
                                  with check ((select auth.uid()) = user_id);
  create policy "<table>_delete_own" on <table>
    for delete to authenticated using ((select auth.uid()) = user_id);
  ```

  No policy is granted to `anon` → logged-out access is denied by default.

### Success Criteria:

#### Automated Verification:

- [ ] Migration applies cleanly locally: `supabase db reset`
- [ ] RLS is on for all three tables: `select tablename, rowsecurity from pg_tables where schemaname='public'` shows `rowsecurity = true` for `locations`, `plants`, `care_events`
- [ ] Each table has ≥4 policies: `select tablename, count(*) from pg_policies where schemaname='public' group by tablename`
- [ ] Repo still builds: `npx astro sync && npm run lint && npm run build`

#### Manual Verification:

- [ ] Two-session deny check: signed in as user A, attempts to `select`/`update`/`delete` user B's `locations`, `plants`, and `care_events` return zero rows / affect zero rows (interim isolation gate; automated pgTAP deferred)
- [ ] Same-user FK guards: inserting a plant whose `location_id` belongs to a different user is rejected; inserting a care_event whose `plant_id` belongs to a different user is rejected
- [ ] CASCADE: deleting a location removes its plants and their care_events; deleting a user (via `auth.users`) removes all their rows

**Implementation Note**: After Phase 1 automated checks pass, pause for human confirmation of the manual deny check before Phase 2.

---

## Phase 2: Plant-photos Storage bucket + storage RLS

### Overview

Create the private `plant-photos` bucket and the `storage.objects` policies that confine each user to their own folder, completing the per-user isolation boundary on the storage side.

### Changes Required:

#### 1. Local bucket config

**File**: `supabase/config.toml`

**Intent**: Make `supabase start` / `supabase db reset` create the bucket locally so dev mirrors prod.

**Contract**: Uncomment/add a `[storage.buckets.plant-photos]` block: `public = false`, `file_size_limit = "10MiB"` (PRD ~10 MB photo NFR), `allowed_mime_types = ["image/png", "image/jpeg", "image/webp"]`.

#### 2. Storage bucket + policies migration

**File**: `supabase/migrations/<timestamp>_plant_photos_storage.sql`

**Intent**: Reproducibly create the bucket on remote (config.toml only affects local) and add per-user-folder RLS to `storage.objects`.

**Contract**:

- Insert the bucket idempotently: `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('plant-photos', 'plant-photos', false, …, …) on conflict (id) do nothing`.
- Four policies on `storage.objects` (`select`/`insert`/`update`/`delete`), `to authenticated`, gated on bucket + first path segment = the user id. The path-confinement contract (which fixes the object-key convention for S-01):

  ```sql
  -- object key convention: '<user_id>/<plant_id>/<filename>'
  create policy "plant_photos_select_own" on storage.objects
    for select to authenticated
    using (bucket_id = 'plant-photos'
           and (storage.foldername(name))[1] = (select auth.uid())::text);
  -- …insert (with check), update (using+with check), delete (using) follow the same predicate
  ```

### Success Criteria:

#### Automated Verification:

- [ ] Storage migration applies: `supabase db reset`
- [ ] Bucket exists and is private: `select id, public, file_size_limit from storage.buckets where id='plant-photos'` shows `public = false`
- [ ] Storage policies present: `select policyname from pg_policies where schemaname='storage' and tablename='objects'` lists the four `plant_photos_*` policies

#### Manual Verification:

- [ ] As user A, uploading an object under `A's-uid/…` succeeds; uploading or reading under user B's uid folder is denied (two-session check)
- [ ] Bucket serves no public URL (private); files over 10 MiB and disallowed mime types are rejected

**Implementation Note**: Pause for human confirmation of the storage deny check before Phase 3.

---

## Phase 3: Generated DB types + DTO surface

### Overview

Generate TypeScript types from the schema, make the Supabase client generic-typed, and expose ergonomic domain DTOs from `src/types.ts` so the slices import from one place.

### Changes Required:

#### 1. Generated database types

**File**: `src/db/database.types.ts` (new)

**Intent**: Produce the source-of-truth types from the live local schema.

**Contract**: Output of `supabase gen types typescript --local > src/db/database.types.ts` (requires `supabase start`). Exports the `Database` type. **Commit this file** (CI builds without regenerating). Exclude it from lint/format via a new `{ ignores: ["src/db/database.types.ts"] }` flat-config object in `eslint.config.js` and a new `.prettierignore` containing the path — **not** via `.gitignore` (see Critical Implementation Details: `.gitignore`-ing it would un-commit the file and break the CI `npm run build`).

#### 2. Typed Supabase client

**File**: `src/lib/supabase.ts`

**Intent**: Thread the schema types through the client so callers get typed tables.

**Contract**: Import `Database` from `@/db/database.types` and parameterize `createServerClient<Database>(…)`. No behavioral change; the `null`-when-unconfigured contract (`SUPABASE_URL`/`SUPABASE_KEY` unset) is preserved.

#### 3. Domain DTOs

**File**: `src/types.ts` (new — does not exist yet)

**Intent**: Give the slices stable, named entity and write-shape aliases instead of reaching into generated types.

**Contract**: Export `Location`, `Plant`, `CareEvent` row aliases (from `Database['public']['Tables'][…]['Row']`), their `…Insert` / `…Update` aliases, the `CareEventKind` union, and an `AiSuggestion` interface describing the `plants.ai_suggestion` JSON shape (species, watering_interval_days, sunlight, winterization_cutoff, description).

### Success Criteria:

#### Automated Verification:

- [ ] Types generate without error: `supabase gen types typescript --local > src/db/database.types.ts`
- [ ] `src/db/database.types.ts` is git-ignored by lint/format (not flagged by `eslint .` / `prettier --check`)
- [ ] Typed client + DTOs compile: `npx astro sync && npm run lint && npm run build`

#### Manual Verification:

- [ ] Generated types include the three tables, the `care_event_kind` enum, and the `ai_suggestion` JSON column
- [ ] A scratch typed query (e.g. `client.from('plants').select()`) infers `Plant[]` — confirms the generic is wired

**Implementation Note**: Final phase — confirm the full `db reset` → `gen types` → `build` loop is reproducible before marking complete.

---

## Testing Strategy

### Unit Tests:

- None in this change (no test runner; no application logic to unit-test). The schema's correctness is exercised by migration-apply + the SQL introspection checks above.

### Integration Tests:

- Deferred. The automated cross-user RLS regression test (`supabase test db` / pgTAP) is explicitly out of scope (user decision) and is owned by a later test-plan rollout change.

### Manual Testing Steps:

**Setup — two test users + a SQL impersonation harness.** `auth.uid()` reads `request.jwt.claims->>'sub'`; a raw `psql` session has no JWT (so `auth.uid()` is NULL) and the app has no domain UI yet, so the deny check is run by *impersonating* each user inside a transaction rather than through the app.

1. `supabase db reset` — confirm all migrations apply with no error.
2. Create two users and capture their UUIDs (local Studio → Authentication → Add user, or the auth admin API). Call them `A_UID` and `B_UID`.
3. Impersonate user A and seed one row per table (run in a single `psql` transaction so the GUCs apply to the seeding statements):

   ```sql
   begin;
   set local role authenticated;
   set local request.jwt.claims = '{"sub":"<A_UID>","role":"authenticated"}';
   -- user_id defaults to auth.uid(); insert a location, then a plant in it, then a care_event on that plant
   insert into locations (name) values ('A home') returning id;        -- note the location id
   insert into plants (location_id, name) values ('<loc id>', 'A fern') returning id;  -- note the plant id
   insert into care_events (plant_id, kind) values ('<plant id>', 'water');
   commit;
   ```

4. **Cross-user deny check** — open a new transaction impersonating user B (`set local request.jwt.claims = '{"sub":"<B_UID>",…}'`) and attempt `select`/`update`/`delete` on user A's `locations`, `plants`, `care_events`. Expect **zero rows returned** and **zero rows affected** on every operation.
5. **Same-user FK guards** — still as user A, attempt (a) `insert into plants (location_id, …)` referencing user B's `location_id`, and (b) `insert into care_events (plant_id, …)` referencing user B's `plant_id`. Both must be **rejected by the guard trigger** (the referenced parent is invisible under RLS, so the subquery returns NULL ≠ `auth.uid()`).
6. **CASCADE** — delete user A's location and confirm its plants and their care_events are gone; deleting `A_UID` from `auth.users` removes all of A's rows.
7. **Storage deny check** — using an *authenticated* client/session (not raw SQL — `storage.objects` RLS needs a real signed request), as user A upload an object under `A_UID/…` (succeeds) and attempt upload/read under `B_UID/…` (denied). The local Studio Storage UI signed in as each user, or a small script using the anon key + each user's session, exercises this.

## Performance Considerations

- The partial index `(user_id, next_water_due_at) where next_water_due_at is not null` keeps the today-list and the 1-minute reminder cron a single indexed range scan rather than a full-table sort — the cron tick (F-03/S-04) reads this hot path.
- `(select auth.uid())` in policies is evaluated once per query as an initplan, not per row — material on list/cron scans.
- Data volume is small (PRD `target_scale`), so beyond these indexes no further tuning is warranted in v1.

## Migration Notes

- Migrations are **additive and forward-only**; there is no existing data to migrate (empty schema).
- `wrangler rollback` reverts code only — a shipped migration does not roll back with it (`infrastructure.md:82,98`). Keep this migration self-contained and apply it to remote (`supabase db push`) as a deliberate, separate step from the code deploy.

## References

- Roadmap foundation F-02: `context/foundation/roadmap.md:80` (care-events modeling left open at `:90`, RLS risk at `:91`)
- Storage / CPU constraint: `context/foundation/infrastructure.md:91`; rollback caveat: `:82`, `:98`
- Isolation + retention guardrails: `context/foundation/prd.md:156,158`; FR-015 original-suggestion requirement: `prd.md:132`
- Existing SSR client to type: `src/lib/supabase.ts`
- Migration convention + RLS guardrail: `CLAUDE.md` (Conventions → Supabase migrations)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Core domain schema + RLS

#### Automated

- [x] 1.1 Migration applies cleanly locally (`supabase db reset`)
- [x] 1.2 RLS on for all three tables (`pg_tables.rowsecurity = true`)
- [x] 1.3 Each table has ≥4 policies (`pg_policies`)
- [x] 1.4 Repo still builds (`npx astro sync && npm run lint && npm run build`)

#### Manual

- [x] 1.5 Two-session deny check passes on all three tables
- [x] 1.6 Same-user FK guards reject cross-user `location_id` (plants) and cross-user `plant_id` (care_events)
- [x] 1.7 CASCADE verified (location→plants→care_events; user→all)

### Phase 2: Plant-photos Storage bucket + storage RLS

#### Automated

- [ ] 2.1 Storage migration applies (`supabase db reset`)
- [ ] 2.2 Bucket exists and is private (`storage.buckets.public = false`)
- [ ] 2.3 Four `plant_photos_*` policies present on `storage.objects`

#### Manual

- [ ] 2.4 Own-folder upload succeeds; other-user folder denied
- [ ] 2.5 Private bucket; size + mime limits enforced

### Phase 3: Generated DB types + DTO surface

#### Automated

- [ ] 3.1 Types generate without error
- [ ] 3.2 Generated types file excluded from lint/format
- [ ] 3.3 Typed client + DTOs compile (`npx astro sync && npm run lint && npm run build`)

#### Manual

- [ ] 3.4 Generated types include three tables, the enum, and `ai_suggestion`
- [ ] 3.5 Scratch typed query infers `Plant[]`
