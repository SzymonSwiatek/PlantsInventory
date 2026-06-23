-- Winterization due-plants view + partial index (roadmap S-05, Phase 1).
--
-- Adds a security_invoker view that computes the current-year winterization
-- cutoff for each plant from its stored month/day, and filters to plants
-- currently in their 30-day winterization window and not yet winterized this
-- season.
--
-- The this-year cutoff is built as:
--   (make_date(<year>, month, 1) + (day - 1) * interval '1 day')::date
-- instead of make_date(<year>, month, day) directly, because make_date raises
-- "date field value out of range" for invalid day/month combinations (e.g.
-- Feb 29 in a non-leap year). The interval form rolls forward (Feb 29 → Mar 1
-- in a non-leap year), which is safe for the cron's all-users service-role scan;
-- a single bad row would otherwise abort winterization for every user that tick.
--
-- Annual recurrence: once winterized_at >= this_year_cutoff the plant is
-- excluded this season; next year this_year_cutoff advances past last year's
-- winterized_at so the plant is due again automatically.
--
-- Year-boundary edge (Dec cutoff + 30-day tail into Jan): not handled; autumn
-- cutoffs spilling into the new year are accepted as out-of-scope for v1.
--
-- security_invoker = true means the view honors the querying role's RLS:
--   service-role client (cron): RLS bypassed → all users visible
--   session client (/today): RLS scopes to the owner's rows only
-- One view definition, two correct behaviors.

create view winterization_due_plants with (security_invoker = true) as
select
  p.id,
  p.user_id,
  p.name,
  p.location_id,
  l.name as location_name,
  p.winterization_cutoff,
  c.this_year_cutoff
from public.plants p
join public.locations l on l.id = p.location_id
join lateral (
  select (
    make_date(
      extract(year from current_date)::int,
      extract(month from p.winterization_cutoff)::int,
      1
    ) + (extract(day from p.winterization_cutoff)::int - 1) * interval '1 day'
  )::date as this_year_cutoff
) c on true
where
  p.winterization_cutoff is not null
  and c.this_year_cutoff <= current_date
  and current_date <= c.this_year_cutoff + interval '30 days'
  and (
    p.winterized_at is null
    or p.winterized_at < c.this_year_cutoff
  );

-- Grant SELECT explicitly — views do not inherit default table privileges.
-- `service_role` is included so the cron's service-role client can query the
-- view without RLS bypassing the underlying table grants requirement.
-- `anon` is intentionally excluded — every route requires sign-in (matches the
-- base-table grants in 20260608171954_core_domain_schema.sql).
grant select on winterization_due_plants to authenticated, service_role;

-- Partial index for the cron scan and /today list: limits the scan to plants
-- that have a winterization cutoff set.
create index plants_winterization_cutoff_idx
  on public.plants (winterization_cutoff)
  where winterization_cutoff is not null;
