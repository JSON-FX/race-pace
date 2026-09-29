-- Local-only migration; not applied to either hosted project.
-- New entry paths and old direct writes share this admission boundary. Existing
-- active entries are grandfathered when an organizer enables screening.
create or replace function public.registration_event_capacity_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.categories%rowtype; a public.prescreening_applications%rowtype; b public.prescreening_batches%rowtype;
  p public.event_reservation_places%rowtype; v_conversion boolean:=false; v_pool text:='general';
begin
  if tg_op='UPDATE' and new.prescreening_application_id is distinct from old.prescreening_application_id then
    raise exception 'registration_screening_identity_immutable' using errcode='23514'; end if;
  if tg_op='UPDATE' and new.status='pending' and old.prescreening_application_id is not null and exists(
    select 1 from public.prescreening_applications pa join public.prescreening_batches pb on pb.id=pa.batch_id
      where pa.id=old.prescreening_application_id and pb.checkout_intent='entry'
        and (new.expires_at is null or new.expires_at>pb.payment_deadline_at)) then
    raise exception 'prescreening_payment_window_immutable' using errcode='23514'; end if;
  if new.status not in ('pending','paid') then return new; end if;
  if new.status='pending' and new.expires_at<=statement_timestamp() then return new; end if;
  perform 1 from public.events where id=new.event_id for update;
  select * into c from public.categories where id=new.category_id and event_id=new.event_id and org_id=new.org_id for update;
  if not found then raise exception 'category_scope_mismatch' using errcode='23514'; end if;
  if tg_op='UPDATE' and (old.category_id,old.event_id,old.participant_passport_id,old.event_reservation_id,old.booked_by_user_id)
      is not distinct from (new.category_id,new.event_id,new.participant_passport_id,new.event_reservation_id,new.booked_by_user_id)
    and exists(select 1 from public.event_capacity_claims(new.event_id) q where q.registration_id=old.id) then return new; end if;
  if new.event_reservation_id is not null then
    if not exists(select 1 from public.event_reservations q where q.id=new.event_reservation_id and q.event_id=new.event_id
      and q.org_id=new.org_id and q.user_id=new.booked_by_user_id and q.status='paid') then
      raise exception 'invalid_event_reservation' using errcode='23514'; end if;
    select * into p from public.event_reservation_places where reservation_id=new.event_reservation_id and participant_passport_id=new.participant_passport_id;
    if found then
      if p.status<>'held' or (p.category_id is not null and p.category_id<>new.category_id) or
        coalesce(greatest(p.entry_payment_deadline_at,c.entry_payment_deadline_at),
          (select registration_deadline_at from public.event_reservations where id=new.event_reservation_id))<=statement_timestamp() then
        raise exception 'invalid_event_reservation' using errcode='23514'; end if;
      new.expires_at:=least(new.expires_at,coalesce(greatest(p.entry_payment_deadline_at,c.entry_payment_deadline_at),
        (select registration_deadline_at from public.event_reservations where id=new.event_reservation_id)));
      new.prescreening_application_id:=p.prescreening_application_id;
      v_conversion:=true;
      if p.category_id is not null then v_pool:='reservation'; end if;
    elsif exists(select 1 from public.event_reservation_places where reservation_id=new.event_reservation_id) or
      not exists(select 1 from public.event_reservations q where q.id=new.event_reservation_id and q.user_id=new.user_id
        and q.registration_deadline_at>statement_timestamp()) then
      raise exception 'invalid_event_reservation' using errcode='23514';
    else v_conversion:=true; end if;
  end if;
  if not v_conversion then
    select * into a from public.prescreening_applications where event_id=new.event_id and participant_passport_id=new.participant_passport_id and released_at is null;
    if found then
      if a.category_id<>new.category_id or a.booked_by_user_id<>new.booked_by_user_id or a.decision not in ('approved','not_required') then
        raise exception 'prescreening_approval_required' using errcode='23514'; end if;
      select * into b from public.prescreening_batches where id=a.batch_id;
      if b.status<>'ready' or b.checkout_intent<>'entry' or b.payment_deadline_at<=statement_timestamp() then
        raise exception 'prescreening_group_not_payable' using errcode='23514'; end if;
      if new.booking_order_id is null and (select count(*) from public.prescreening_applications where batch_id=b.id and released_at is null)>1 then
        raise exception 'prescreening_group_payment_required' using errcode='23514'; end if;
      if new.booking_order_id is not null and not exists(select 1 from public.booking_orders o where o.id=new.booking_order_id
        and o.reservation_request->>'prescreening_batch_id'=b.id::text) then
        raise exception 'prescreening_batch_required' using errcode='23514'; end if;
      new.prescreening_application_id:=a.id;
      new.expires_at:=b.payment_deadline_at;
    elsif c.prescreening_enabled or new.prescreening_application_id is not null then
      raise exception 'prescreening_approval_required' using errcode='23514'; end if;
  end if;
  perform public.assert_category_capacity(c.id,v_pool,1,new.id,new.prescreening_application_id,coalesce(p.id,new.event_reservation_id));
  return new;
end $$;
revoke all on function public.registration_event_capacity_guard() from public,anon,authenticated;

-- The event guard now checks both partitions and all kinds of holds. Keeping
-- the old registration-only count would apply a second, inconsistent ledger.
create or replace function public.registration_capacity_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin return new; end $$;
revoke all on function public.registration_capacity_guard() from public,anon,authenticated;

create or replace function public.booking_order_reserve(
  p_actor uuid, p_request jsonb, p_lines jsonb default null, p_fields jsonb default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_order public.booking_orders%rowtype;
  v_category public.categories%rowtype;
  v_event public.events%rowtype;
  v_passport public.runner_passports%rowtype;
  v_line jsonb; v_validated jsonb; v_fields jsonb;
  v_category_id uuid; v_header_category uuid; v_distinct_categories integer;
  v_count integer; v_addon_count integer; v_addon_total bigint; v_category_total integer;
  v_total bigint := 0; v_registration uuid; v_expiry timestamptz;
begin
  perform 1 from auth.users where id=p_actor and email_confirmed_at is not null
    and not coalesce(is_anonymous,false) for share;
  if not found then raise exception 'booking_email_unverified' using errcode='42501'; end if;
  if p_request is null or p_request->>'idempotency_key' is null
  then raise exception 'invalid_input' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text || ':' || (p_request->>'idempotency_key'),0));
  select * into v_order from public.booking_orders
    where booked_by_user_id=p_actor and idempotency_key=(p_request->>'idempotency_key')::uuid for update;
  if found then
    if v_order.reservation_request is distinct from p_request
    then raise exception 'idempotency_conflict' using errcode='22023'; end if;
    return public.booking_order_reservation_result(v_order.id);
  end if;
  if p_lines is null then return null; end if;
  if jsonb_typeof(p_request->'participants') is distinct from 'array' or jsonb_typeof(p_lines) is distinct from 'array'
  then raise exception 'invalid_input' using errcode='22023'; end if;
  v_count := jsonb_array_length(p_request->'participants');
  if v_count<1 or v_count>10 or jsonb_array_length(p_lines)<>v_count or
    (select count(distinct x->>'participant_passport_id') from jsonb_array_elements(p_request->'participants') x)<>v_count
  then raise exception 'invalid_input' using errcode='22023'; end if;

  if exists(select 1 from jsonb_array_elements(p_request->'participants') x
    where coalesce(x->>'category_id',p_request->>'category_id') is null)
  then raise exception 'category_required' using errcode='22023'; end if;
  -- All admissions take the event lock before category and checkout rows.
  perform 1 from public.events where id=(p_request->>'event_id')::uuid for update;
  if p_request->>'prescreening_batch_id' is not null then
    if not exists(select 1 from public.prescreening_batches b where b.id=(p_request->>'prescreening_batch_id')::uuid
      and b.booked_by_user_id=p_actor and b.event_id=(p_request->>'event_id')::uuid
      and b.status='ready' and b.checkout_intent='entry' and b.payment_deadline_at>statement_timestamp()) or
      (select count(*) from public.prescreening_applications where batch_id=(p_request->>'prescreening_batch_id')::uuid and released_at is null)<>v_count or
      exists(select 1 from jsonb_array_elements(p_request->'participants') x where not exists(
        select 1 from public.prescreening_applications a where a.batch_id=(p_request->>'prescreening_batch_id')::uuid and a.released_at is null
          and a.participant_passport_id=(x->>'participant_passport_id')::uuid
          and a.category_id=coalesce(x->>'category_id',p_request->>'category_id')::uuid
          and a.decision in ('approved','not_required'))) then
      raise exception 'prescreening_group_not_payable' using errcode='23514'; end if;
  end if;
  -- Stable category lock order is shared by reservation, capture and refunds.
  perform 1 from public.categories c where c.id in (
    select distinct coalesce(x->>'category_id',p_request->>'category_id')::uuid
    from jsonb_array_elements(p_request->'participants') x
  ) order by c.id for update;
  select count(distinct coalesce(x->>'category_id',p_request->>'category_id')::uuid)
    into v_distinct_categories
    from jsonb_array_elements(p_request->'participants') x;
  select coalesce(x->>'category_id',p_request->>'category_id')::uuid into v_header_category
    from jsonb_array_elements(p_request->'participants') x
    order by coalesce(x->>'category_id',p_request->>'category_id')::uuid limit 1;
  if (select count(*) from public.categories c where c.id in (
      select distinct coalesce(x->>'category_id',p_request->>'category_id')::uuid
      from jsonb_array_elements(p_request->'participants') x)
      and c.event_id=(p_request->>'event_id')::uuid)<>v_distinct_categories
  then raise exception 'category_not_found' using errcode='22023'; end if;
  select * into v_category from public.categories where id=v_header_category;
  select * into v_event from public.events where id=(p_request->>'event_id')::uuid for share;
  if not found or v_event.org_id<>v_category.org_id or exists(select 1 from public.categories c where c.id in (
      select distinct coalesce(x->>'category_id',p_request->>'category_id')::uuid
      from jsonb_array_elements(p_request->'participants') x) and c.org_id<>v_event.org_id)
  then raise exception 'category_not_found' using errcode='22023'; end if;
  if v_event.status not in ('open','almost_full') or v_event.registration_closes_at<=statement_timestamp()
  then raise exception 'registration_closed' using errcode='22023'; end if;
  perform 1 from public.organizations where id=v_event.org_id and is_active for share;
  if not found then raise exception 'org_suspended' using errcode='22023'; end if;
  if v_event.waiver_version_id is null or v_event.waiver_version_id is distinct from (p_request->>'waiver_version_id')::uuid
  then raise exception 'waiver_version_changed' using errcode='22023'; end if;

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
    v_category_id:=coalesce(v_line->>'category_id',p_request->>'category_id')::uuid;
    select * into v_category from public.categories where id=v_category_id;
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
    v_total:=v_total+v_category.base_price+v_addon_total;
  end loop;
  if v_total>2147483647 then raise exception 'order_amount_too_large' using errcode='22023'; end if;

  update public.registrations r set status='expired',expires_at=null
    where r.event_id=v_event.id and r.status='pending' and r.expires_at<=statement_timestamp()
      and r.participant_passport_id in (select (x->>'participant_passport_id')::uuid from jsonb_array_elements(p_request->'participants') x);
  if exists(select 1 from public.registrations r where r.event_id=v_event.id and r.status in ('pending','paid')
    and r.participant_passport_id in (select (x->>'participant_passport_id')::uuid from jsonb_array_elements(p_request->'participants') x))
  then raise exception 'participant_already_registered' using errcode='23505'; end if;
  for v_category_id,v_category_total in
    select coalesce(x->>'category_id',p_request->>'category_id')::uuid,count(*)::integer
    from jsonb_array_elements(p_request->'participants') x group by 1 order by 1
  loop
    select * into v_category from public.categories where id=v_category_id;
    if (select count(*) from public.registrations r where r.category_id=v_category_id and
      (r.status='paid' or (r.status='pending' and (r.expires_at is null or r.expires_at>statement_timestamp()))))+v_category_total>v_category.slots_total
    then raise exception 'category_capacity_exhausted' using errcode='23514',detail=v_category_id::text; end if;
  end loop;

  v_expiry:=coalesce((select payment_deadline_at from public.prescreening_batches where id=(p_request->>'prescreening_batch_id')::uuid),statement_timestamp()+interval '24 hours');
  select * into v_category from public.categories where id=v_header_category;
  insert into public.booking_orders(org_id,event_id,category_id,booked_by_user_id,idempotency_key,
    status,expires_at,reservation_request,entry_base_price_cents,entry_total_cents)
  values(v_event.org_id,v_event.id,case when v_distinct_categories=1 then v_header_category else null end,p_actor,
    (p_request->>'idempotency_key')::uuid,'pending',v_expiry,p_request,
    case when v_distinct_categories=1 then v_category.base_price else null end,v_total) returning * into v_order;
  for v_line in select x from jsonb_array_elements(p_request->'participants') x order by x->>'participant_passport_id' loop
    v_category_id:=coalesce(v_line->>'category_id',p_request->>'category_id')::uuid;
    select * into v_category from public.categories where id=v_category_id;
    select * into v_passport from public.runner_passports where id=(v_line->>'participant_passport_id')::uuid;
    select x into v_validated from jsonb_array_elements(p_lines) x where x->>'participant_passport_id'=v_passport.id::text;
    select coalesce(sum(price),0) into v_addon_total from public.addons
      where id in (select x::uuid from jsonb_array_elements_text(v_line->'addon_ids') x);
    insert into public.registrations(org_id,event_id,category_id,user_id,booked_by_user_id,
      participant_passport_id,booking_order_id,status,total_amount,custom_data,
      waiver_version_id,waiver_acceptance_method,idempotency_key,expires_at)
    values(v_event.org_id,v_event.id,v_category_id,v_passport.claimed_user_id,p_actor,
      v_passport.id,v_order.id,'pending',v_category.base_price+v_addon_total,v_validated->'custom_data',
      v_event.waiver_version_id,v_line->>'waiver_acceptance_method','group:'||v_order.id::text,v_expiry)
    returning id into v_registration;
    insert into public.registration_addons(registration_id,addon_id,price)
      select v_registration,id,price from public.addons where id in
      (select x::uuid from jsonb_array_elements_text(v_line->'addon_ids') x);
  end loop;
  if p_request->>'prescreening_batch_id' is not null then
    update public.prescreening_batches set booking_order_id=v_order.id where id=(p_request->>'prescreening_batch_id')::uuid;
  end if;
  update public.booking_orders set expires_at=(select min(expires_at) from public.registrations where booking_order_id=v_order.id) where id=v_order.id;
  return public.booking_order_reservation_result(v_order.id);
end $$;
revoke all on function public.booking_order_reserve(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.booking_order_reserve(uuid,jsonb,jsonb,jsonb) to service_role;
