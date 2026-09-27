-- Platform-owned teaching content is deliberately shared across organizations;
-- tenant business records remain org-scoped. A known object path must never let
-- an organizer sign a draft video or its thumbnail before publication.
create table public.guide_videos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  topic text not null,
  duration_seconds integer not null,
  storage_path text not null unique,
  thumbnail_path text unique,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guide_videos_title_check check (
    title = btrim(title, E' \t\n\r') and char_length(title) between 1 and 160
  ),
  constraint guide_videos_description_check check (
    description = btrim(description, E' \t\n\r') and char_length(description) between 1 and 2000
  ),
  constraint guide_videos_topic_check check (
    topic in ('Getting started', 'Events', 'Registrations', 'Payments', 'Race day', 'Team & settings')
  ),
  constraint guide_videos_duration_check check (duration_seconds between 1 and 14400),
  constraint guide_videos_storage_path_check check (
    storage_path ~ ('^' || id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|webm)$')
  ),
  constraint guide_videos_thumbnail_path_check check (
    thumbnail_path is null or thumbnail_path ~
      ('^' || id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
  )
);

alter table public.guide_videos enable row level security;

-- auth_can_admin_org also accepts editors; Guide intentionally requires admin.
create policy guide_videos_read_published on public.guide_videos
  for select to authenticated
  using (
    is_published and exists (
      select 1 from public.user_roles ur
      where ur.user_id = (select auth.uid()) and ur.role = 'admin' and ur.org_id is not null
    )
  );

create policy guide_videos_manage_super_admin on public.guide_videos
  for all to authenticated
  using ((select public.auth_is_super_admin()))
  with check ((select public.auth_is_super_admin()));

-- Pin Data API access rather than inheriting hosted provisioning defaults.
revoke all on table public.guide_videos from public, anon, authenticated;
grant select, insert, update, delete on table public.guide_videos to authenticated;
grant all on table public.guide_videos to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('guide-videos', 'guide-videos', false, 52428800, array['video/mp4', 'video/webm', 'image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Metadata RLS is also evaluated inside this lookup. Both exact video and
-- thumbnail matches are required; sharing a UUID folder alone grants nothing.
create policy guide_video_objects_read_published on storage.objects
  for select to authenticated
  using (
    bucket_id = 'guide-videos'
    and exists (
      select 1 from public.guide_videos g
      where g.is_published
        and (g.storage_path = storage.objects.name or g.thumbnail_path = storage.objects.name)
    )
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id = (select auth.uid()) and ur.role = 'admin' and ur.org_id is not null
    )
  );

-- Super admins may upload before saving metadata and retain access for retry
-- and orphan cleanup. No browser service-role credential or new RPC is needed.
create policy guide_video_objects_manage_super_admin on storage.objects
  for all to authenticated
  using (bucket_id = 'guide-videos' and (select public.auth_is_super_admin()))
  with check (bucket_id = 'guide-videos' and (select public.auth_is_super_admin()));
