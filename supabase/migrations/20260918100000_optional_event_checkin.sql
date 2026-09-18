-- This version has only been replayed locally; the follow-up FOR SHARE lock
-- was added before any hosted deployment. Existing events keep their current
-- race-day behavior. New events inherit the organization's default unless an
-- authorized admin explicitly chooses otherwise.
alter table public.organizations
  add column check_in_required_default boolean not null default true;
alter table public.events add column check_in_required boolean;
update public.events set check_in_required = true;
alter table public.events alter column check_in_required set not null;

-- Organization defaults are an admin decision, not an editor branding write.
grant update (check_in_required_default) on public.organizations to authenticated;

create table public.checkin_settings_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  actor_id uuid,
  previous_value boolean not null,
  required_value boolean not null,
  changed_at timestamptz not null default now()
);
create index checkin_settings_audit_org_time
  on public.checkin_settings_audit(org_id, changed_at desc);
alter table public.checkin_settings_audit enable row level security;
create policy checkin_settings_audit_admin_read on public.checkin_settings_audit
  for select to authenticated using (public.auth_can_admin_org(org_id));
grant select on public.checkin_settings_audit to authenticated;

create function public.checkin_setting_admin(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.auth_is_super_admin() or exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.org_id = p_org_id and ur.role = 'admin'
  );
$$;
revoke all on function public.checkin_setting_admin(uuid) from public, anon;
grant execute on function public.checkin_setting_admin(uuid) to authenticated, service_role;

create function public.checkin_org_setting_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.check_in_required_default is distinct from old.check_in_required_default then
    if auth.role() <> 'service_role' and not public.checkin_setting_admin(old.id) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    insert into public.checkin_settings_audit
      (org_id, actor_id, previous_value, required_value)
    values (old.id, auth.uid(), old.check_in_required_default, new.check_in_required_default);
  end if;
  return new;
end;
$$;
revoke all on function public.checkin_org_setting_guard() from public, anon, authenticated;
create trigger checkin_org_setting_guard before update of check_in_required_default
  on public.organizations for each row execute function public.checkin_org_setting_guard();

create function public.checkin_event_setting_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_default boolean;
begin
  if tg_op = 'INSERT' then
    select o.check_in_required_default into v_default
    from public.organizations o where o.id = new.org_id for share;
    if new.check_in_required is null then
      new.check_in_required := coalesce(v_default, true);
    elsif new.check_in_required is distinct from v_default
      and auth.role() <> 'service_role'
      and not public.checkin_setting_admin(new.org_id) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  elsif new.check_in_required is distinct from old.check_in_required then
    if auth.role() <> 'service_role'
      and not public.checkin_setting_admin(old.org_id) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    insert into public.checkin_settings_audit
      (org_id, event_id, actor_id, previous_value, required_value)
    values (old.org_id, old.id, auth.uid(), old.check_in_required, new.check_in_required);
  end if;
  return new;
end;
$$;
revoke all on function public.checkin_event_setting_guard() from public, anon, authenticated;
create trigger checkin_event_setting_guard before insert or update of check_in_required
  on public.events for each row execute function public.checkin_event_setting_guard();

-- The station can inspect its event mode without broadening marshal SELECT on
-- draft events or exposing private event fields.
create function public.checkin_event_required(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select e.check_in_required from public.events e
  where e.id = p_event_id and public.auth_can_check_in_event(e.org_id, e.id);
$$;
revoke all on function public.checkin_event_required(uuid) from public, anon;
grant execute on function public.checkin_event_required(uuid) to authenticated, service_role;

-- The Edge Function calls this service-only transaction. Its own role check
-- remains the authority, while the mode check prevents direct RPC bypass.
create or replace function public.checkin_record_tx(p_registration_id uuid, p_event_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.registrations%rowtype;
  v_id uuid;
  v_role text;
  v_required boolean;
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
  -- Serialize a setting change against this scan. A disable committed first
  -- must be seen here; a scan committed first happened while enabled.
  select e.check_in_required into v_required from public.events e
    where e.id = r.event_id for share;
  if v_required is false then return jsonb_build_object('error','check_in_disabled'); end if;
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
revoke all on function public.checkin_record_tx(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.checkin_record_tx(uuid,uuid,uuid) to service_role;
