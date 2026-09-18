-- Internal reservation slice. GROUP_RESERVATIONS_ENABLED remains off in hosted
-- environments until order payments/refunds/reporting are implemented.
alter table public.booking_orders
  add column reservation_request jsonb,
  add column entry_base_price_cents integer check(entry_base_price_cents >= 0),
  add column entry_total_cents integer check(entry_total_cents >= 0);

create function public.booking_order_terms_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if (new.reservation_request,new.entry_base_price_cents,new.entry_total_cents)
    is distinct from (old.reservation_request,old.entry_base_price_cents,old.entry_total_cents)
  then raise exception 'order_terms_immutable' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function public.booking_order_terms_guard() from public,anon,authenticated;
grant execute on function public.booking_order_terms_guard() to service_role;
create trigger booking_order_terms_guard before update on public.booking_orders
for each row execute function public.booking_order_terms_guard();

create function public.booking_order_reservation_result(p_order_id uuid) returns jsonb
language sql set search_path='' as $$
  select jsonb_build_object(
    'order_id',o.id,
    'status',case when o.status='pending' and o.expires_at<=statement_timestamp() then 'expired' else o.status end,
    'expires_at',o.expires_at, 'entry_total_cents',o.entry_total_cents,
    'registrations',coalesce((select jsonb_agg(jsonb_build_object(
      'registration_id',r.id,'participant_passport_id',r.participant_passport_id,
      'entry_total_cents',r.total_amount) order by r.participant_passport_id)
      from public.registrations r where r.booking_order_id=o.id),'[]'::jsonb))
  from public.booking_orders o where o.id=p_order_id;
$$;
revoke all on function public.booking_order_reservation_result(uuid) from public,anon,authenticated;
grant execute on function public.booking_order_reservation_result(uuid) to service_role;

-- Service-only definer: auth.users is not readable by service_role. The edge derives p_actor from
-- getUser, never from the request. p_lines contains validated SERVER snapshots.
-- Comparing them under locks closes the validation/write race without duplicating
-- the complete Zod/form validator in PL/pgSQL.
create function public.booking_order_reserve(
  p_actor uuid, p_request jsonb, p_lines jsonb default null, p_fields jsonb default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_order public.booking_orders%rowtype;
  v_category public.categories%rowtype;
  v_event public.events%rowtype;
  v_passport public.runner_passports%rowtype;
  v_line jsonb; v_validated jsonb; v_fields jsonb;
  v_count integer; v_addon_count integer; v_addon_total bigint;
  v_total bigint := 0; v_registration uuid; v_expiry timestamptz;
begin
  perform 1 from auth.users where id=p_actor and email_confirmed_at is not null
    and not coalesce(is_anonymous,false) for share;
  if not found then raise exception 'booking_email_unverified' using errcode='42501'; end if;
  if p_request is null or p_request->>'idempotency_key' is null
  then raise exception 'invalid_input' using errcode='22023'; end if;
  -- Same actor/key serializes even when callers disagree about the category.
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text || ':' || (p_request->>'idempotency_key'),0));
  select * into v_order from public.booking_orders
    where booked_by_user_id=p_actor and idempotency_key=(p_request->>'idempotency_key')::uuid for update;
  if found then
    if v_order.reservation_request is distinct from p_request
    then raise exception 'idempotency_conflict' using errcode='22023'; end if;
    return public.booking_order_reservation_result(v_order.id);
  end if;
  -- The edge can probe replay before re-reading Passports that may have changed
  -- after reservation. This does not create a draft, consume capacity or renew it.
  if p_lines is null then return null; end if;
  if jsonb_typeof(p_request->'participants') is distinct from 'array' or jsonb_typeof(p_lines) is distinct from 'array'
  then raise exception 'invalid_input' using errcode='22023'; end if;
  v_count := jsonb_array_length(p_request->'participants');
  if v_count<1 or v_count>10 or jsonb_array_length(p_lines)<>v_count or
    (select count(distinct x->>'participant_passport_id') from jsonb_array_elements(p_request->'participants') x)<>v_count
  then raise exception 'invalid_input' using errcode='22023'; end if;

  select * into v_category from public.categories where id=(p_request->>'category_id')::uuid for update;
  if not found or v_category.event_id is distinct from (p_request->>'event_id')::uuid
  then raise exception 'category_not_found' using errcode='22023'; end if;
  select * into v_event from public.events where id=v_category.event_id for share;
  if v_event.org_id<>v_category.org_id then raise exception 'category_not_found' using errcode='22023'; end if;
  if v_event.status not in ('open','almost_full') or v_event.registration_closes_at<=statement_timestamp()
  then raise exception 'registration_closed' using errcode='22023'; end if;
  perform 1 from public.organizations where id=v_category.org_id and is_active for share;
  if not found then raise exception 'org_suspended' using errcode='22023'; end if;
  if v_event.waiver_version_id is null or v_event.waiver_version_id is distinct from (p_request->>'waiver_version_id')::uuid
  then raise exception 'waiver_version_changed' using errcode='22023'; end if;

  -- Row locks alone cannot stop a NEW required question appearing between the
  -- edge read and commit. SHARE permits concurrent reservations, blocks edits.
  lock table public.form_fields in share mode;
  select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]'::jsonb) into v_fields
    from public.form_fields f where f.event_id=v_event.id and f.is_active;
  if v_fields is distinct from p_fields then raise exception 'reservation_input_changed' using errcode='22023'; end if;
  perform 1 from public.runner_passports p where p.id in
    (select (x->>'participant_passport_id')::uuid from jsonb_array_elements(p_request->'participants') x)
    order by p.id for share;
  perform 1 from public.passport_managers m where m.user_id=p_actor and m.passport_id in
    (select (x->>'participant_passport_id')::uuid from jsonb_array_elements(p_request->'participants') x)
    order by m.passport_id for share;
  perform 1 from public.addons a where a.id in
    (select y::uuid from jsonb_array_elements(p_request->'participants') x,
      jsonb_array_elements_text(x->'addon_ids') y) order by a.id for share;

  for v_line in select x from jsonb_array_elements(p_request->'participants') x order by x->>'participant_passport_id' loop
    select * into v_passport from public.runner_passports where id=(v_line->>'participant_passport_id')::uuid;
    if not found or (v_passport.claimed_user_id is distinct from p_actor and
      (v_passport.claimed_user_id is not null or not exists(select 1 from public.passport_managers
        where passport_id=v_passport.id and user_id=p_actor)))
    then raise exception 'participant_not_accessible' using errcode='42501'; end if;
    if v_line->>'waiver_accepted' is distinct from 'true' or
      v_line->>'waiver_acceptance_method' is distinct from
        (case when v_passport.claimed_user_id=p_actor then 'signed_in_self' else 'participant_on_helper_device' end)
    then raise exception 'participant_acceptance_required' using errcode='22023'; end if;
    select x into v_validated from jsonb_array_elements(p_lines) x where x->>'participant_passport_id'=v_passport.id::text;
    if v_validated is null or v_validated->'passport_snapshot' is distinct from to_jsonb(v_passport)
    then raise exception 'reservation_input_changed' using errcode='22023'; end if;
    if jsonb_typeof(v_line->'addon_ids') is distinct from 'array'
    then raise exception 'invalid_addons' using errcode='22023'; end if;
    select count(*),coalesce(sum(a.price),0) into v_addon_count,v_addon_total from public.addons a
      where a.id in (select x::uuid from jsonb_array_elements_text(v_line->'addon_ids') x)
        and a.event_id=v_event.id and a.org_id=v_event.org_id and a.price>=0;
    if v_addon_count<>jsonb_array_length(v_line->'addon_ids') or v_addon_count>20 or v_category.base_price<0
    then raise exception 'invalid_addons' using errcode='22023'; end if;
    v_total := v_total+v_category.base_price+v_addon_total;
  end loop;
  if v_total>2147483647 then raise exception 'order_amount_too_large' using errcode='22023'; end if;

  -- Lazy expiry removes the partial-unique-index collision. All these writes
  -- roll back if ANY participant conflicts or total capacity is insufficient.
  update public.registrations r set status='expired',expires_at=null
    where r.event_id=v_event.id and r.status='pending' and r.expires_at<=statement_timestamp()
      and r.participant_passport_id in (select (x->>'participant_passport_id')::uuid from jsonb_array_elements(p_request->'participants') x);
  if exists(select 1 from public.registrations r where r.event_id=v_event.id and r.status in ('pending','paid')
    and r.participant_passport_id in (select (x->>'participant_passport_id')::uuid from jsonb_array_elements(p_request->'participants') x))
  then raise exception 'participant_already_registered' using errcode='23505'; end if;
  if (select count(*) from public.registrations r where r.category_id=v_category.id and
    (r.status='paid' or (r.status='pending' and (r.expires_at is null or r.expires_at>statement_timestamp()))))+v_count>v_category.slots_total
  then raise exception 'category_capacity_exhausted' using errcode='23514'; end if;

  v_expiry := statement_timestamp()+interval '24 hours';
  insert into public.booking_orders(org_id,event_id,category_id,booked_by_user_id,idempotency_key,
    status,expires_at,reservation_request,entry_base_price_cents,entry_total_cents)
  values(v_event.org_id,v_event.id,v_category.id,p_actor,(p_request->>'idempotency_key')::uuid,
    'pending',v_expiry,p_request,v_category.base_price,v_total) returning * into v_order;
  for v_line in select x from jsonb_array_elements(p_request->'participants') x order by x->>'participant_passport_id' loop
    select * into v_passport from public.runner_passports where id=(v_line->>'participant_passport_id')::uuid;
    select x into v_validated from jsonb_array_elements(p_lines) x where x->>'participant_passport_id'=v_passport.id::text;
    select coalesce(sum(price),0) into v_addon_total from public.addons
      where id in (select x::uuid from jsonb_array_elements_text(v_line->'addon_ids') x);
    insert into public.registrations(org_id,event_id,category_id,user_id,booked_by_user_id,
      participant_passport_id,booking_order_id,status,total_amount,custom_data,
      waiver_version_id,waiver_acceptance_method,idempotency_key,expires_at)
    values(v_event.org_id,v_event.id,v_category.id,v_passport.claimed_user_id,p_actor,
      v_passport.id,v_order.id,'pending',v_category.base_price+v_addon_total,v_validated->'custom_data',
      v_event.waiver_version_id,v_line->>'waiver_acceptance_method','group:'||v_order.id::text,v_expiry)
    returning id into v_registration;
    insert into public.registration_addons(registration_id,addon_id,price)
      select v_registration,id,price from public.addons where id in
      (select x::uuid from jsonb_array_elements_text(v_line->'addon_ids') x);
  end loop;
  return public.booking_order_reservation_result(v_order.id);
end $$;
revoke all on function public.booking_order_reserve(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.booking_order_reserve(uuid,jsonb,jsonb,jsonb) to service_role;
