-- Core domain schema + RLS for 10xPlantsInventory (roadmap F-02).
--
-- Creates the care_event_kind enum and the locations, plants, and care_events
-- tables. RLS is enabled and fully policied in this SAME migration so a table is
-- never live without its policies: splitting "create table" from "enable RLS"
-- across migrations opens a silent leak window where the table is readable by
-- anyone holding the anon/authenticated key.
--
-- Per-user isolation is a direct user_id column on every table, defaulting to
-- auth.uid() and CASCADE-deleting from auth.users. Ownership is enforced two
-- ways that are both required: (1) RLS policies scope every row to the owner,
-- and (2) BEFORE triggers assert that owning FKs (plants.location_id,
-- care_events.plant_id) point at a parent owned by the same user -- RLS alone
-- does not close this because the insert with-check still passes when user_id
-- defaults to auth.uid().

-- ============================================================================
-- Enum
-- ============================================================================

create type care_event_kind as enum ('water', 'winterize');

-- ============================================================================
-- Tables
-- ============================================================================

-- locations: a user's top-level grouping of plants (e.g. "Living room").
create table locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index locations_user_id_idx on locations (user_id);

-- plants: a cataloged plant owned by a user, living in one of their locations.
-- Care-profile columns are AI-fillable / user-editable and all nullable.
-- ai_suggestion snapshots the original AI suggestion (FR-015 + acceptance
-- metric); it is write-once by app convention (S-01 sets it, edits never touch
-- it) -- the update policy still permits the column, so the convention is owned
-- by the slices, not the DB.
-- Reminder columns are created here; their write/read logic ships in S-04/S-05.
create table plants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  location_id uuid not null references locations (id) on delete cascade,
  name text not null,
  -- care profile
  species text,
  description text,
  note text,
  sunlight text,
  photo_path text,
  ai_suggestion jsonb,
  -- reminders (logic owned by S-04/S-05)
  watering_interval_days integer check (watering_interval_days > 0),
  last_watered_at timestamptz,
  next_water_due_at timestamptz,
  water_snooze_until timestamptz,
  winterization_cutoff date,
  winterized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index plants_user_id_idx on plants (user_id);
create index plants_location_id_idx on plants (location_id);
-- Partial index for the today-list and the reminder cron scan: a single indexed
-- range scan over (user_id, next_water_due_at) instead of a full-table sort.
create index plants_user_next_water_due_idx
  on plants (user_id, next_water_due_at)
  where next_water_due_at is not null;

-- care_events: append-only log of care actions on a plant.
create table care_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  plant_id uuid not null references plants (id) on delete cascade,
  kind care_event_kind not null,
  done_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index care_events_plant_kind_done_idx
  on care_events (plant_id, kind, done_at desc);

-- ============================================================================
-- updated_at trigger
-- ============================================================================

create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger locations_set_updated_at
  before update on locations
  for each row execute function set_updated_at();

create trigger plants_set_updated_at
  before update on plants
  for each row execute function set_updated_at();

-- ============================================================================
-- Same-user FK guards
-- ============================================================================
-- A child row's owning FK only checks that the parent exists, so a user could
-- attach their own row to another user's parent id. These SECURITY INVOKER
-- triggers run under the caller's role, so the lookup is itself subject to RLS:
-- a cross-user parent is invisible, the subquery returns NULL, and NULL is
-- distinct from the row's user_id -> the insert is rejected.

create or replace function assert_plant_location_same_user()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select user_id from public.locations where id = new.location_id)
       is distinct from new.user_id then
    raise exception 'location % does not belong to user %', new.location_id, new.user_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger plants_location_same_user
  before insert or update on plants
  for each row execute function assert_plant_location_same_user();

create or replace function assert_care_event_plant_same_user()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select user_id from public.plants where id = new.plant_id)
       is distinct from new.user_id then
    raise exception 'plant % does not belong to user %', new.plant_id, new.user_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger care_events_plant_same_user
  before insert or update on care_events
  for each row execute function assert_care_event_plant_same_user();

-- ============================================================================
-- Row Level Security
-- ============================================================================
-- Four policies per table (select / insert / update / delete), each scoped
-- `to authenticated` so evaluation is skipped for anon (logged-out is denied by
-- default). auth.uid() is wrapped in a scalar subquery so Postgres caches it as
-- an initplan instead of re-evaluating per row -- the documented Supabase
-- performance pattern, material on the list/cron scans.

alter table locations enable row level security;
alter table plants enable row level security;
alter table care_events enable row level security;

-- locations
create policy "locations_select_own" on locations
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "locations_insert_own" on locations
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "locations_update_own" on locations
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "locations_delete_own" on locations
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- plants
create policy "plants_select_own" on plants
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "plants_insert_own" on plants
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "plants_update_own" on plants
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "plants_delete_own" on plants
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- care_events
create policy "care_events_select_own" on care_events
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "care_events_insert_own" on care_events
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "care_events_update_own" on care_events
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "care_events_delete_own" on care_events
  for delete to authenticated
  using ((select auth.uid()) = user_id);
