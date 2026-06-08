-- Follow-up to core_domain_schema (F-02 impl-review F1): give plants.name the
-- same length / non-empty guard locations.name already carries, so an empty or
-- oversized plant name is rejected at the DB layer rather than relying solely on
-- the S-01/S-03 app layer. Forward-only, additive: no existing rows to backfill.

alter table plants
  add constraint plants_name_check
  check (char_length(btrim(name)) between 1 and 100);
