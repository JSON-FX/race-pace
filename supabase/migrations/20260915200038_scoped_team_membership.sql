-- Team editing previously deleted a role before validating its replacement.
-- Serialize on the org so concurrent edits cannot each remove its last admin.
create function public.team_member_write_tx(p_org_id uuid,p_actor_id uuid,p_user_id uuid,
  p_role text,p_event_scope uuid default null,p_replace_scope boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_scope uuid; v_old_role text;
begin
  perform 1 from public.organizations where id=p_org_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if not exists(select 1 from public.user_roles where user_id=p_actor_id and
    (role='super_admin' or (org_id=p_org_id and role='admin' and event_scope is null)))
    then return jsonb_build_object('error','forbidden'); end if;
  if p_role is not null and p_role not in ('admin','editor','marshal','claiming')
    then return jsonb_build_object('error','bad_role'); end if;
  select role::text,event_scope into v_old_role,v_scope from public.user_roles
    where org_id=p_org_id and user_id=p_user_id order by created_at,id limit 1;
  if p_replace_scope then v_scope:=p_event_scope; end if;
  if p_role is null then v_scope:=null; end if;
  if v_scope is not null and (p_role not in ('marshal','claiming') or not exists(
    select 1 from public.events where id=v_scope and org_id=p_org_id))
    then return jsonb_build_object('error','invalid_event_scope'); end if;
  -- Adding a staff member to a legacy admin-less org does not remove an admin.
  -- Reject only an actual loss of the final existing admin.
  if exists(select 1 from public.user_roles where org_id=p_org_id and user_id=p_user_id and role='admin')
    and p_role is distinct from 'admin'
    and not exists(select 1 from public.user_roles where org_id=p_org_id and user_id<>p_user_id and role='admin')
    then return jsonb_build_object('error','last_admin'); end if;
  delete from public.user_roles where org_id=p_org_id and user_id=p_user_id;
  if p_role is not null then
    insert into public.user_roles(org_id,user_id,role,event_scope)
      values(p_org_id,p_user_id,p_role::public.app_role,v_scope);
  end if;
  return jsonb_build_object('ok',true,'event_scope',v_scope);
end;
$$;
revoke all on function public.team_member_write_tx(uuid,uuid,uuid,text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.team_member_write_tx(uuid,uuid,uuid,text,uuid,boolean) to service_role;
