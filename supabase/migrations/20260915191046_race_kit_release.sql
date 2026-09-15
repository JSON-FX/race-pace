-- Pilot: one complete kit, runner collection only. Reversed releases remain
-- historical rows; a unique active release prevents two desks handing out twice.
create table public.kit_releases (
  id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  registration_id uuid not null references public.registrations(id) on delete cascade,
  recipient_name text not null,
  kit jsonb not null,
  released_by uuid not null,
  released_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid,
  reversal_reason text
);
create unique index kit_releases_active on public.kit_releases(registration_id) where reversed_at is null;
create index kit_releases_event on public.kit_releases(event_id,registration_id);
alter table public.kit_releases enable row level security;
revoke all on public.kit_releases from anon,authenticated;
grant select on public.kit_releases to authenticated;
grant all on public.kit_releases to service_role;

create function public.auth_can_release_kits(p_org_id uuid,p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.auth_is_super_admin() or exists (
    select 1 from public.user_roles where user_id=auth.uid() and org_id=p_org_id
      and role in ('admin','editor','claiming') and (event_scope is null or event_scope=p_event_id));
$$;
revoke all on function public.auth_can_release_kits(uuid,uuid) from public,anon;
grant execute on function public.auth_can_release_kits(uuid,uuid) to authenticated,service_role;
create policy kit_releases_read on public.kit_releases for select to authenticated using (
  public.auth_can_release_kits(org_id,event_id) or exists (
    select 1 from public.registrations r where r.id=registration_id and r.org_id=kit_releases.org_id and r.user_id=auth.uid()));

-- Shared server snapshot. Never include medical/custom form data in a kit roster.
create function public.kit_snapshot(p_registration_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('shirt_size',r.custom_data->>'shirt_size','addons',coalesce((
    select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name) order by a.id)
    from public.registration_addons ra join public.addons a on a.id=ra.addon_id
    where ra.registration_id=r.id and a.org_id=r.org_id), '[]'::jsonb))
  from public.registrations r where r.id=p_registration_id;
$$;
revoke all on function public.kit_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.kit_snapshot(uuid) to service_role;

create function public.kit_release_events()
returns table(id uuid,name text) language sql stable security definer set search_path = '' as $$
  select e.id,e.name from public.events e where public.auth_can_release_kits(e.org_id,e.id)
  order by e.event_date desc nulls last,e.id;
$$;
revoke all on function public.kit_release_events() from public,anon;
grant execute on function public.kit_release_events() to authenticated,service_role;

create function public.kit_release_roster(p_event_id uuid,p_query text default '',p_state text default 'all')
returns table(registration_id uuid,runner text,bib text,category text,status text,kit jsonb,
  release_id uuid,released_at timestamptz,released_by uuid,recipient_name text,refund_pending boolean,can_reverse boolean)
language sql stable security definer set search_path = '' as $$
  select r.id,coalesce(nullif(r.custom_data->>'full_name',''),pr.full_name,'Unknown runner')::text,
    coalesce(nullif(r.custom_data->>'bib_name',''),pr.bib_name)::text,c.label::text,r.status::text,
    coalesce(k.kit,public.kit_snapshot(r.id)),k.id,k.released_at,k.released_by,k.recipient_name,
    exists(select 1 from public.refund_requests q where q.registration_id=r.id and
      (q.status in ('submitting','unknown','pending') or q.review_required))
      or exists(select 1 from public.payments p where p.registration_id=r.id and
        p.raw->'refund'->>'status' in ('submitting','unknown','pending')),
    public.auth_is_super_admin() or exists(select 1 from public.user_roles ur
      where ur.user_id=auth.uid() and ur.org_id=r.org_id and ur.role='admin'
      and (ur.event_scope is null or ur.event_scope=r.event_id))
  from public.registrations r
  left join public.profiles pr on pr.id=r.user_id
  join public.categories c on c.id=r.category_id and c.org_id=r.org_id
  left join public.kit_releases k on k.registration_id=r.id and k.reversed_at is null
  where r.event_id=p_event_id and public.auth_can_release_kits(r.org_id,r.event_id)
    and (coalesce(p_query,'')='' or position(lower(p_query) in lower(concat_ws(' ',
      coalesce(nullif(r.custom_data->>'full_name',''),pr.full_name),
      coalesce(nullif(r.custom_data->>'bib_name',''),pr.bib_name),r.id::text)))>0)
    and (p_state='all' or (p_state='released' and k.id is not null) or (p_state='unreleased' and k.id is null))
  order by r.created_at desc,r.id;
$$;
revoke all on function public.kit_release_roster(uuid,text,text) from public,anon;
grant execute on function public.kit_release_roster(uuid,text,text) to authenticated,service_role;

create function public.kit_release_tx(p_registration_id uuid,p_event_id uuid,p_actor_id uuid,
  p_request_id uuid,p_expected_kit jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.registrations%rowtype; k public.kit_releases%rowtype; v_role text; v_kit jsonb; v_name text;
begin
  select * into r from public.registrations where id=p_registration_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select ur.role::text into v_role from public.user_roles ur where ur.user_id=p_actor_id
    and (ur.role='super_admin' or (ur.org_id=r.org_id and ur.role in ('admin','editor','claiming')
      and (ur.event_scope is null or ur.event_scope=r.event_id)))
    order by case ur.role when 'super_admin' then 0 when 'admin' then 1 else 2 end limit 1;
  if v_role is null then return jsonb_build_object('error','forbidden'); end if;
  if p_event_id is distinct from r.event_id then return jsonb_build_object('error','wrong_event'); end if;
  if p_request_id is null then return jsonb_build_object('error','request_id_required'); end if;
  select * into k from public.kit_releases where id=p_request_id;
  if found then
    if k.registration_id<>r.id then return jsonb_build_object('error','request_conflict'); end if;
    if k.reversed_at is not null then return jsonb_build_object('error','release_reversed'); end if;
    return jsonb_build_object('ok',true,'already',true,'release_id',k.id);
  end if;
  select * into k from public.kit_releases where registration_id=r.id and reversed_at is null;
  if found then return jsonb_build_object('ok',true,'already',true,'release_id',k.id); end if;
  if r.status<>'paid' then return jsonb_build_object('error','not_paid'); end if;
  if exists(select 1 from public.refund_requests q where q.registration_id=r.id and
       (q.status in ('submitting','unknown','pending') or q.review_required))
     or exists(select 1 from public.payments p where p.registration_id=r.id and p.raw->'refund'->>'status' in ('submitting','unknown','pending'))
     then return jsonb_build_object('error','refund_pending'); end if;
  v_kit:=public.kit_snapshot(r.id);
  if v_kit is distinct from p_expected_kit then return jsonb_build_object('error','kit_changed'); end if;
  select coalesce(nullif(r.custom_data->>'full_name',''),pr.full_name,'Unknown runner') into v_name
    from public.profiles pr where pr.id=r.user_id;
  v_name:=coalesce(v_name,nullif(r.custom_data->>'full_name',''),'Unknown runner');
  insert into public.kit_releases(id,org_id,event_id,registration_id,recipient_name,kit,released_by)
    values(p_request_id,r.org_id,r.event_id,r.id,v_name,v_kit,p_actor_id);
  insert into public.registration_audit(registration_id,org_id,event_id,action,detail,actor_id,actor_role)
    values(r.id,r.org_id,r.event_id,'kit_released',jsonb_build_object('release_id',p_request_id,'kit',v_kit,'recipient',v_name),p_actor_id,v_role);
  return jsonb_build_object('ok',true,'release_id',p_request_id);
end;
$$;
revoke all on function public.kit_release_tx(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.kit_release_tx(uuid,uuid,uuid,uuid,jsonb) to service_role;

create function public.kit_release_reverse_tx(p_registration_id uuid,p_event_id uuid,p_actor_id uuid,p_release_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.registrations%rowtype; k public.kit_releases%rowtype; v_role text;
begin
  select * into r from public.registrations where id=p_registration_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select ur.role::text into v_role from public.user_roles ur where ur.user_id=p_actor_id
    and (ur.role='super_admin' or (ur.org_id=r.org_id and ur.role='admin' and (ur.event_scope is null or ur.event_scope=r.event_id))) limit 1;
  if v_role is null then return jsonb_build_object('error','forbidden'); end if;
  if p_event_id is distinct from r.event_id then return jsonb_build_object('error','wrong_event'); end if;
  if length(trim(coalesce(p_reason,''))) not between 3 and 500 then return jsonb_build_object('error','reason_required'); end if;
  select * into k from public.kit_releases where id=p_release_id and registration_id=r.id;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if k.reversed_at is not null then return jsonb_build_object('ok',true,'already',true); end if;
  update public.kit_releases set reversed_at=now(),reversed_by=p_actor_id,reversal_reason=trim(p_reason) where id=k.id;
  insert into public.registration_audit(registration_id,org_id,event_id,action,detail,actor_id,actor_role)
    values(r.id,r.org_id,r.event_id,'kit_release_reversed',jsonb_build_object('release_id',k.id,'reason',trim(p_reason),'kit',k.kit),p_actor_id,v_role);
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.kit_release_reverse_tx(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.kit_release_reverse_tx(uuid,uuid,uuid,uuid,text) to service_role;

-- A collected kit must be reversed before its shirt size can change.
-- The single write path for post-checkout registration field edits.
--
-- Takes NO actor parameter on purpose. This function is granted to `authenticated` and
-- called straight from the browser, so an actor argument would be a privilege-escalation
-- hole: any signed-in user could pass another runner's uid and edit that runner's row.
-- Identity comes from the JWT via auth.uid(), never from an argument.
--
-- Authorization lives inside the function rather than in RLS because RLS is row-level and
-- cannot express "you may write this JSONB key but not total_amount" — the same reasoning
-- as 20260806150000_checkin_rpcs.sql.
--
-- The field classification below mirrors KIT_KEYS/SAFETY_KEYS in packages/shared and
-- supabase/functions/_shared/validation.ts. This SQL copy is the load-bearing one.
create or replace function public.update_registration_fields_tx(
  p_registration_id uuid,
  p_changes         jsonb
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := auth.uid();
  v_reg        public.registrations%rowtype;
  v_is_admin   boolean;
  v_kit_closes timestamptz;
  v_key        text;
  v_val        jsonb;
  v_new        text;
  v_policy     text;
  v_changed    jsonb := '{}'::jsonb;
  v_role       text;
begin
  if v_actor is null then return 'forbidden'; end if;

  select * into v_reg from public.registrations where id = p_registration_id for update;
  if not found then return 'not_found'; end if;

  v_is_admin := public.auth_can_admin_org(v_reg.org_id);
  if v_reg.user_id <> v_actor and not v_is_admin then return 'forbidden'; end if;

  -- refunded / cancelled registrations are settled; nothing about them may change.
  if v_reg.status not in ('pending', 'paid') then return 'not_editable'; end if;

  select kit_edit_closes_at into v_kit_closes from public.events where id = v_reg.event_id;

  -- p_changes must be a JSON object for jsonb_each below; an array or scalar makes it raise
  -- "cannot call jsonb_each on a non-object", surfacing as a raw 500 instead of one of this
  -- function's seven documented return codes. p_changes = NULL is already safe: jsonb_each is
  -- strict, so the loop body never runs and we fall through to 'no_change'.
  if p_changes is not null and jsonb_typeof(p_changes) <> 'object' then return 'invalid_value'; end if;

  -- Validation pass. Any rejection returns before a single write, so a batch containing
  -- one bad key changes nothing.
  for v_key, v_val in select key, value from jsonb_each(p_changes) loop
    -- `#>>'{}'` silently stringifies non-string JSON: an object/array becomes its serialized
    -- text (so {"emergency_contact":{"a":1}} would store the literal string '{"a": 1}'), and a
    -- JSON null becomes SQL NULL, which defeats every `not in (...)` guard below (NULL NOT IN
    -- (...) evaluates to NULL, not TRUE, so neither the shirt_size nor blood_type canonical-list
    -- check fires and the null sails through to the change-detection step). Reject anything
    -- that isn't a JSON string before extracting text, so neither bypass is reachable.
    if jsonb_typeof(v_val) <> 'string' then return 'invalid_value'; end if;
    v_new := v_val #>> '{}';

    v_policy := case
      when v_key = 'shirt_size' then 'kit'
      when v_key in ('blood_type', 'emergency_contact') then 'safety'
      else 'immutable'
    end;

    if v_policy = 'kit' and exists (select 1 from public.kit_releases k where k.registration_id=v_reg.id and k.reversed_at is null) then return 'collected'; end if;

    if v_policy = 'immutable' then return 'invalid_value'; end if;

    -- Org admins are never deadline-bound; every admin edit is recorded below, which is
    -- what makes the override safe to grant.
    if v_policy = 'kit' and not v_is_admin
       and v_kit_closes is not null and v_kit_closes < now() then
      return 'locked';
    end if;

    if v_key = 'shirt_size'
       and v_new not in ('XS', 'S', 'M', 'L', 'XL', 'XXL') then
      return 'invalid_value';
    end if;
    if v_key = 'blood_type'
       and v_new not in ('A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-', 'Unknown') then
      return 'invalid_value';
    end if;
    -- emergency_contact is free text with no canonical list; bound its length instead, so a
    -- signed-in runner can't push a multi-megabyte string into custom_data (and into an audit
    -- row) on every call.
    if v_key = 'emergency_contact' and length(v_new) > 200 then
      return 'invalid_value';
    end if;

    if (v_reg.custom_data #>> array[v_key]) is distinct from v_new then
      v_changed := v_changed || jsonb_build_object(v_key, v_new);
    end if;
  end loop;

  if v_changed = '{}'::jsonb then return 'no_change'; end if;

  update public.registrations
     set custom_data = coalesce(custom_data, '{}'::jsonb) || v_changed
   where id = p_registration_id;

  v_role := case when v_is_admin then 'admin' else 'runner' end;

  -- One row per changed field. v_reg holds the pre-update snapshot, so `from` is the old
  -- value even though registrations has already been updated.
  for v_key, v_new in select key, value #>> '{}' from jsonb_each(v_changed) loop
    insert into public.registration_audit
      (registration_id, org_id, event_id, action, detail, actor_id, actor_role)
    values (
      p_registration_id, v_reg.org_id, v_reg.event_id, 'field_changed',
      jsonb_build_object('field', v_key, 'from', v_reg.custom_data #>> array[v_key], 'to', v_new),
      v_actor, v_role
    );
  end loop;

  return 'ok';
end;
$$;

revoke all on function public.update_registration_fields_tx(uuid, jsonb) from public;
grant execute on function public.update_registration_fields_tx(uuid, jsonb) to authenticated;

grant execute on function public.update_registration_fields_tx(uuid,jsonb) to service_role;
