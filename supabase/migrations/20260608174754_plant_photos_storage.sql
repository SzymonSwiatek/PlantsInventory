-- Plant-photos Storage bucket + per-user-folder RLS (roadmap F-02, Phase 2).
--
-- Photos go DIRECTLY to Supabase Storage, never through the Worker: decoding a
-- ~10 MB image in a Cloudflare Worker trips the free-tier 10 ms CPU limit
-- (infrastructure.md:91). So plants.photo_path holds a Storage object key and
-- the bucket carries its own RLS -- the Worker never holds image bytes.
--
-- config.toml creates this bucket locally; this migration creates it on remote
-- (config.toml only affects local dev) and adds the storage.objects policies.
-- Object-key convention is '<user_id>/<plant_id>/<filename>', so the first path
-- segment is the owner -- the policies confine each user to their own folder.

-- ============================================================================
-- Bucket
-- ============================================================================
-- Idempotent insert: db reset replays migrations after config.toml may have
-- already created the bucket locally, so guard on the primary key.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'plant-photos',
  'plant-photos',
  false,
  10485760,                                    -- 10 MiB (PRD ~10 MB photo NFR)
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- ============================================================================
-- Storage RLS
-- ============================================================================
-- Four policies (select / insert / update / delete), each scoped
-- `to authenticated` so anon is denied by default. The predicate pins the
-- bucket and requires the first folder segment to equal the caller's uid, so a
-- user can only touch objects under their own '<user_id>/...' prefix.
-- auth.uid() is wrapped in a scalar subquery (initplan-cached) per the Supabase
-- performance pattern.

create policy "plant_photos_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'plant-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "plant_photos_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'plant-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "plant_photos_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'plant-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'plant-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "plant_photos_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'plant-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
