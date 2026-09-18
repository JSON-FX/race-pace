-- auth_can_admin_org includes editors. Publishing legal documents requires admin.
create or replace function public.organizer_publish_waiver(p_org_id uuid, p_version_id uuid, p_title text, p_body text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_existing public.organizer_waiver_versions;
begin
 if auth.uid() is null or not (public.auth_is_super_admin() or exists (select 1 from public.user_roles where user_id=auth.uid() and org_id=p_org_id and role='admin')) then
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
