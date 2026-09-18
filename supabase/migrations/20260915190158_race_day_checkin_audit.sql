-- Local pilot follow-up: record check-in and its reversal atomically. Locking
-- the registration also prevents a refund from landing between eligibility and insertion.
create function public.checkin_record_tx(p_registration_id uuid, p_event_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.registrations%rowtype;
  v_id uuid;
  v_role text;
begin
  select * into r from public.registrations where id = p_registration_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select ur.role::text into v_role from public.user_roles ur
    where ur.user_id = p_actor_id and (ur.role = 'super_admin' or
      (ur.org_id = r.org_id and ur.role in ('admin','editor','marshal')
       and (ur.event_scope is null or ur.event_scope = r.event_id)))
    order by case ur.role when 'super_admin' then 0 when 'admin' then 1 else 2 end limit 1;
  if v_role is null then return jsonb_build_object('error','forbidden'); end if;
  if r.event_id <> p_event_id or p_event_id is null then return jsonb_build_object('error','wrong_event'); end if;
  if r.status <> 'paid' then return jsonb_build_object('error','not_paid'); end if;
  insert into public.checkins(org_id,registration_id,event_id,checked_in_by)
    values(r.org_id,r.id,r.event_id,p_actor_id)
    on conflict (registration_id) do nothing returning id into v_id;
  if v_id is null then return jsonb_build_object('ok',true,'registration_id',r.id,'already',true); end if;
  insert into public.registration_audit(registration_id,org_id,event_id,action,actor_id,actor_role,detail)
    values(r.id,r.org_id,r.event_id,'checked_in',p_actor_id,v_role,jsonb_build_object('checkin_id',v_id));
  return jsonb_build_object('ok',true,'registration_id',r.id,'checkin_id',v_id);
end;
$$;
revoke all on function public.checkin_record_tx(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.checkin_record_tx(uuid,uuid,uuid) to service_role;

create or replace function public.checkin_undo(p_registration_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  r public.registrations%rowtype;
  c public.checkins%rowtype;
  v_role text;
begin
  select * into r from public.registrations where id = p_registration_id for update;
  if not found then return 'not_found'; end if;
  if not public.auth_can_check_in_event(r.org_id,r.event_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.checkins where registration_id = r.id returning * into c;
  if not found then return 'undone'; end if; -- Idempotent, without inventing a second reversal.
  select ur.role::text into v_role from public.user_roles ur
    where ur.user_id = auth.uid() and (ur.role = 'super_admin' or
      (ur.org_id = r.org_id and ur.role in ('admin','editor','marshal')
       and (ur.event_scope is null or ur.event_scope = r.event_id)))
    order by case ur.role when 'super_admin' then 0 when 'admin' then 1 else 2 end limit 1;
  insert into public.registration_audit(registration_id,org_id,event_id,action,actor_id,actor_role,detail)
    values(r.id,r.org_id,r.event_id,'checkin_undone',auth.uid(),v_role,
      jsonb_build_object('checkin_id',c.id,'checked_in_at',c.checked_in_at,'checked_in_by',c.checked_in_by));
  return 'undone';
end;
$$;
revoke all on function public.checkin_undo(uuid) from public,anon;
grant execute on function public.checkin_undo(uuid) to authenticated,service_role;

create function public.checkin_history(p_event_id uuid)
returns table(id uuid,registration_id uuid,runner text,action text,actor_id uuid,actor_role text,created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id,a.registration_id,
    coalesce(nullif(r.custom_data->>'full_name',''),p.full_name,'Unknown runner')::text,
    a.action,a.actor_id,a.actor_role,a.created_at
  from public.registration_audit a
  join public.registrations r on r.id = a.registration_id and r.org_id = a.org_id
  left join public.profiles p on p.id = r.user_id
  where a.event_id = p_event_id and a.action in ('checked_in','checkin_undone')
    and public.auth_can_check_in_event(a.org_id,a.event_id)
  order by a.created_at desc,a.id;
$$;
revoke all on function public.checkin_history(uuid) from public,anon;
grant execute on function public.checkin_history(uuid) to authenticated,service_role;
