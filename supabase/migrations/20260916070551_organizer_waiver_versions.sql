-- Published text is append-only. A replacement is a new version, never an edit
-- of the document an earlier participant accepted. Existing events stay legacy
-- until their checkout consumers support versioned acceptance.
create table public.organizer_waiver_versions (
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references public.organizations(id),
 title text not null check (length(btrim(title)) between 1 and 200),
 body text not null check (length(btrim(body)) between 1 and 100000),
 content_hash text generated always as (encode(extensions.digest(body, 'sha256'), 'hex')) stored,
 published_by uuid references auth.users(id) on delete set null,
 published_at timestamptz not null default now(),
 unique(org_id, id)
);
create index organizer_waiver_versions_org_idx on public.organizer_waiver_versions(org_id, published_at);
alter table public.organizer_waiver_versions enable row level security;
-- Waivers are public documents. No participant or acceptance data belongs here.
create policy organizer_waivers_read on public.organizer_waiver_versions
 for select to anon, authenticated using(true);
revoke all on public.organizer_waiver_versions from anon, authenticated;
grant select on public.organizer_waiver_versions to anon, authenticated;
grant all on public.organizer_waiver_versions to service_role;

create function public.organizer_publish_waiver(p_org_id uuid, p_version_id uuid, p_title text, p_body text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_existing public.organizer_waiver_versions;
begin
 if auth.uid() is null or not public.auth_can_admin_org(p_org_id) then
   raise exception 'not_authorized' using errcode='42501';
 end if;
 if p_version_id is null then raise exception 'version_required' using errcode='22023'; end if;
 insert into public.organizer_waiver_versions(id, org_id, title, body, published_by)
 values(p_version_id, p_org_id, btrim(p_title), p_body, auth.uid())
 on conflict(id) do nothing;
 select * into v_existing from public.organizer_waiver_versions where id=p_version_id;
 -- Replaying a publish request is safe only for the exact same document and org.
 if v_existing.org_id is distinct from p_org_id or v_existing.title is distinct from btrim(p_title)
    or v_existing.body is distinct from p_body then
   raise exception 'waiver_version_conflict' using errcode='22023';
 end if;
 return p_version_id;
end $$;
revoke all on function public.organizer_publish_waiver(uuid,uuid,text,text) from public, anon;
grant execute on function public.organizer_publish_waiver(uuid,uuid,text,text) to authenticated, service_role;
