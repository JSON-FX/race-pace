-- Runner profile images: avatar + cover (banner) URLs on profiles, plus a
-- public `profile-images` bucket with owner-scoped writes. Objects live at
-- {user_id}/{uuid}.{ext}; the write policies check the first path segment
-- against auth.uid(). Public read is served by the public bucket + a select
-- policy (also required so upsert works). Additive & idempotent.

alter table profiles
  add column if not exists avatar_url text,
  add column if not exists cover_url text;
-- New columns are covered by the existing `grant select, insert, update on
-- profiles to authenticated` and the profiles_update_own RLS policy.

insert into storage.buckets (id, name, public)
values ('profile-images', 'profile-images', true)
on conflict (id) do nothing;

-- Owner-scoped storage policies. TO authenticated + an ownership predicate on
-- the first path segment (never role-only). Idempotent via drop-if-exists.
drop policy if exists "profile_images_select_own" on storage.objects;
create policy "profile_images_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "profile_images_insert_own" on storage.objects;
create policy "profile_images_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "profile_images_update_own" on storage.objects;
create policy "profile_images_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "profile_images_delete_own" on storage.objects;
create policy "profile_images_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
