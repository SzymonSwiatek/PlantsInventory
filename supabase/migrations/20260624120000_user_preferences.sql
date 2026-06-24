-- user_preferences table for per-user settings (reminders on/off).
--
-- RLS is enabled and fully policied in this SAME migration so the table is
-- never live without its policies -- consistent with the core_domain_schema
-- convention. Default-enabled by absence of a row (no backfill needed).

create table user_preferences (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  reminders_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_preferences_set_updated_at
  before update on user_preferences
  for each row execute function set_updated_at();

alter table user_preferences enable row level security;

create policy "user_preferences_select_own" on user_preferences
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "user_preferences_insert_own" on user_preferences
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "user_preferences_update_own" on user_preferences
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "user_preferences_delete_own" on user_preferences
  for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on table user_preferences to authenticated, service_role;
