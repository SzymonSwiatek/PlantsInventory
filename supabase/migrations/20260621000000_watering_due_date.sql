-- Watering due-date trigger + backfill (roadmap S-04, Phase 1).
--
-- Adds a BEFORE INSERT OR UPDATE trigger on plants that recomputes
-- next_water_due_at whenever watering_interval_days or last_watered_at
-- changes. Also backfills existing rows so every plant with an interval has
-- a non-NULL due date immediately after this migration runs.

-- ============================================================================
-- Trigger function
-- ============================================================================

create or replace function compute_next_water_due_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- On INSERT, always compute. On UPDATE, only when the inputs changed.
  if (tg_op = 'INSERT') or
     (new.watering_interval_days is distinct from old.watering_interval_days) or
     (new.last_watered_at is distinct from old.last_watered_at)
  then
    if new.watering_interval_days is null then
      new.next_water_due_at := null;
    else
      new.next_water_due_at :=
        coalesce(new.last_watered_at, now())
        + (new.watering_interval_days || ' days')::interval;
    end if;
  end if;
  return new;
end;
$$;

create trigger plants_compute_next_water_due_at
  before insert or update on public.plants
  for each row execute function compute_next_water_due_at();

-- ============================================================================
-- Backfill existing rows
-- ============================================================================

update public.plants
set next_water_due_at =
      coalesce(last_watered_at, now())
      + (watering_interval_days || ' days')::interval
where watering_interval_days is not null;
