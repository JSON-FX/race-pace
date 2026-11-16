-- The admission RPCs have already checked ownership and locked the roster.
-- Reject the write in the same transaction as capacity and notification jobs.
create function public.require_admission_passport() returns trigger
language plpgsql security definer set search_path='' as $$
declare p public.runner_passports%rowtype;
begin
  select * into strict p from public.runner_passports where id=new.participant_passport_id for share;
  if (p.first_name ~ '[^[:space:]]' and p.last_name ~ '[^[:space:]]'
    and p.date_of_birth <= (statement_timestamp() at time zone 'UTC')::date
    and p.gender in ('Male','Female')
    and regexp_replace(p.contact_number,'[[:space:]().-]','','g') ~ '^(\+?[1-9][0-9]{7,14}|0[0-9]{8,10})$'
    and p.emergency_contact_name ~ '[^[:space:]]'
    and regexp_replace(p.emergency_contact_number,'[[:space:]().-]','','g') ~ '^(\+?[1-9][0-9]{7,14}|0[0-9]{8,10})$'
    and p.emergency_contact_relationship ~ '[^[:space:]]'
    and p.shipping_barangay_code ~ '^[0-9]{9}$' and p.shipping_zip_code ~ '^[0-9]{4}$'
    and p.shipping_address_line ~ '[^[:space:]]') is not true then
    raise exception 'passport_incomplete' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function public.require_admission_passport() from public,anon,authenticated;
create trigger require_admission_passport before insert on public.prescreening_applications
  for each row execute function public.require_admission_passport();
create trigger require_admission_passport before insert on public.event_reservation_places
  for each row when (new.status='held') execute function public.require_admission_passport();

-- A status-only event has no scheduled close. PostgreSQL infinity preserves
-- ordering in checkout, provider capture reconciliation and expiry workers.
create function public.prescreening_deadline(p_batch public.prescreening_batches, p_event public.events)
returns timestamptz language sql stable set search_path='' as $$
  select least(coalesce(p_event.registration_closes_at,
    case when p_batch.checkout_intent='reservation' then (
      select min(c.entry_payment_deadline_at) from public.prescreening_applications a
      join public.categories c on c.id=a.category_id
      where a.batch_id=p_batch.id and a.released_at is null) end, 'infinity'::timestamptz),
    case when p_event.status not in ('open','almost_full')
      and not (p_event.status='coming_soon' and p_batch.checkout_intent='reservation')
      then statement_timestamp() end)
$$;
revoke all on function public.prescreening_deadline(public.prescreening_batches,public.events) from public,anon,authenticated;

alter table public.prescreening_batches drop constraint prescreening_payment_window;
alter table public.prescreening_batches add constraint prescreening_payment_window check (
  (payment_ready_at is null) = (payment_deadline_at is null));

create or replace function public.prescreening_window_immutable() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.payment_ready_at is not null and new.payment_ready_at is distinct from old.payment_ready_at then
    raise exception 'prescreening_payment_window_immutable' using errcode='23514';
  end if;
  return new;
end $$;

create or replace function public.prescreening_refresh_ready(p_batch uuid) returns void
language plpgsql security definer set search_path='' as $$
declare b public.prescreening_batches%rowtype; e public.events%rowtype; v_deadline timestamptz;
begin
  select * into b from public.prescreening_batches where id=p_batch;
  if not found then raise exception 'request_not_found' using errcode='22023'; end if;
  select * into e from public.events where id=b.event_id for update;
  select * into b from public.prescreening_batches where id=p_batch for update;
  if b.status<>'reviewing' or b.payment_ready_at is not null then return; end if;
  if not exists(select 1 from public.prescreening_applications where batch_id=b.id and released_at is null) then
    update public.prescreening_batches set status='cancelled' where id=b.id; return;
  end if;
  if exists(select 1 from public.prescreening_applications where batch_id=b.id and released_at is null and decision='pending') then return; end if;
  if not exists(select 1 from public.organizations where id=e.org_id and is_active) then return; end if;
  if b.checkout_intent='entry' and e.status not in ('open','almost_full') then return; end if;
  if b.checkout_intent='reservation' and e.status not in ('coming_soon','open','almost_full') then return; end if;
  v_deadline:=public.prescreening_deadline(b,e);
  if v_deadline<=statement_timestamp() then
    raise exception 'extend_payment_deadline_before_approval' using errcode='23514';
  end if;
  update public.prescreening_batches set status='ready',payment_ready_at=statement_timestamp(),payment_deadline_at=v_deadline where id=b.id;
  insert into public.transactional_email_jobs(type,user_id,event_id,dedup_key,payload)
  values('prescreening_ready',b.booked_by_user_id,b.event_id,'prescreening_ready:'||b.id,
    jsonb_build_object('batch_id',b.id,'payment_deadline_at',v_deadline)) on conflict(dedup_key) do nothing;
end $$;
revoke all on function public.prescreening_refresh_ready(uuid) from public,anon,authenticated;
grant execute on function public.prescreening_refresh_ready(uuid) to service_role;

create or replace function public.reserve_category_passports(p_actor uuid,p_request jsonb,p_provider text) returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.events%rowtype; o public.organizations%rowtype; c public.categories%rowtype; p public.runner_passports%rowtype;
  b public.prescreening_batches%rowtype; a public.prescreening_applications%rowtype; r public.event_reservations%rowtype;
  v_line jsonb; v_lines jsonb:='[]'; v_count integer; v_fee integer; v_base bigint:=0; v_platform bigint:=0;
  v_deadline timestamptz; v_earliest_deadline timestamptz; v_checkout_deadline timestamptz; v_email text;
begin
  if p_provider not in ('paymongo','fake') or jsonb_typeof(p_request->'participants') is distinct from 'array' then
    raise exception 'invalid_input' using errcode='22023'; end if;
  v_count:=jsonb_array_length(p_request->'participants');
  if v_count<1 or v_count>10 or p_request->>'idempotency_key' is null or
    (select count(distinct x->>'participant_passport_id') from jsonb_array_elements(p_request->'participants') x)<>v_count then
    raise exception 'invalid_passports' using errcode='22023'; end if;
  select email into v_email from auth.users where id=p_actor and email_confirmed_at is not null and not coalesce(is_anonymous,false) for share;
  if not found then raise exception 'booking_email_unverified' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||':'||(p_request->>'idempotency_key'),0));
  select * into r from public.event_reservations where user_id=p_actor and idempotency_key=(p_request->>'idempotency_key')::uuid;
  if found then
    if r.reservation_request is distinct from p_request or not exists(select 1 from public.reservation_payments where reservation_id=r.id and provider=p_provider) then
      raise exception 'idempotency_conflict' using errcode='22023'; end if;
    return r.id;
  end if;
  select * into e from public.events where id=(p_request->>'event_id')::uuid for update;
  if not found or e.status not in ('coming_soon','open','almost_full') then raise exception 'reservations_not_open' using errcode='23514'; end if;
  select * into o from public.organizations where id=e.org_id and is_active for share;
  if not found then raise exception 'org_suspended' using errcode='23514'; end if;
  perform 1 from public.categories where id in(select (x->>'category_id')::uuid from jsonb_array_elements(p_request->'participants') x) order by id for update;
  perform 1 from public.runner_passports where id in(select (x->>'participant_passport_id')::uuid from jsonb_array_elements(p_request->'participants') x) order by id for share;
  perform 1 from public.passport_managers where user_id=p_actor and passport_id in(select (x->>'participant_passport_id')::uuid from jsonb_array_elements(p_request->'participants') x) order by passport_id for share;
  if p_request->>'prescreening_batch_id' is not null then
    select * into b from public.prescreening_batches where id=(p_request->>'prescreening_batch_id')::uuid
      and event_id=e.id and booked_by_user_id=p_actor for update;
    if not found or b.status<>'ready' or b.checkout_intent<>'reservation' or b.payment_deadline_at<=statement_timestamp() or
      (select count(*) from public.prescreening_applications where batch_id=b.id and released_at is null)<>v_count then
      raise exception 'prescreening_group_not_payable' using errcode='23514'; end if;
  end if;
  for v_line in select x from jsonb_array_elements(p_request->'participants') x order by x->>'participant_passport_id' loop
    select * into c from public.categories where id=(v_line->>'category_id')::uuid and event_id=e.id and org_id=e.org_id;
    if not found then raise exception 'category_not_found' using errcode='22023'; end if;
    select * into p from public.runner_passports where id=(v_line->>'participant_passport_id')::uuid;
    if not found or (p.claimed_user_id is distinct from p_actor and (p.claimed_user_id is not null or not exists(
      select 1 from public.passport_managers where passport_id=p.id and user_id=p_actor))) then
      raise exception 'participant_not_accessible' using errcode='42501'; end if;
    a:=null;
    if b.id is not null then
      select * into a from public.prescreening_applications where batch_id=b.id and participant_passport_id=p.id and category_id=c.id
        and decision in ('approved','not_required') and released_at is null;
      if not found then raise exception 'prescreening_approval_required' using errcode='23514'; end if;
    elsif c.prescreening_enabled then raise exception 'prescreening_approval_required' using errcode='23514';
    elsif not c.reservation_enabled or c.reservation_sales_close_at<=statement_timestamp() then
      raise exception 'reservations_not_open' using errcode='23514'; end if;
    if exists(select 1 from public.event_capacity_claims(e.id) q where q.participant_passport_id=p.id
      and (a.id is null or q.application_id is distinct from a.id or q.registration_id is not null or q.reservation_place_id is not null)) then
      raise exception 'participant_already_reserved' using errcode='23505'; end if;
    -- The deposit must still buy a convertible place through the approved event cutoff.
    if b.id is not null and e.registration_closes_at is not null then
      c.entry_payment_deadline_at:=greatest(c.entry_payment_deadline_at,e.registration_closes_at);
    end if;
    if c.reservation_fee_cents is null or c.entry_payment_deadline_at<=statement_timestamp() then
      raise exception 'reservation_deadline_passed' using errcode='23514'; end if;
    perform public.assert_category_capacity(c.id,'reservation',1,null,a.id);
    v_fee:=case when o.reservation_commission_type='fixed' then o.reservation_commission_flat_cents
      else round(c.reservation_fee_cents*o.reservation_commission_rate)::integer end;
    v_base:=v_base+c.reservation_fee_cents; v_platform:=v_platform+v_fee;
    v_deadline:=greatest(v_deadline,c.entry_payment_deadline_at);
    v_earliest_deadline:=least(v_earliest_deadline,c.entry_payment_deadline_at);
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('category_id',c.id,'passport_id',p.id,'application_id',a.id,
      'name',coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),nullif(btrim(p.legacy_full_name),''),'My Race Passport'),
      'is_managed',p.claimed_user_id is distinct from p_actor,'fee',c.reservation_fee_cents,'platform',v_fee,'deadline',c.entry_payment_deadline_at));
  end loop;
  if v_base+v_platform>2147483647 then raise exception 'order_amount_too_large' using errcode='22023'; end if;
  v_checkout_deadline:=coalesce(b.payment_deadline_at,least(v_earliest_deadline,statement_timestamp()+interval '24 hours'));
  insert into public.event_reservations(org_id,event_id,user_id,email,idempotency_key,quantity,reservation_fee_cents,platform_fee_cents,
    registration_deadline_at,checkout_expires_at,reservation_request,reservation_total_fee_cents,reservation_total_platform_fee_cents)
  values(e.org_id,e.id,p_actor,v_email,(p_request->>'idempotency_key')::uuid,v_count,(v_lines->0->>'fee')::integer,(v_lines->0->>'platform')::integer,
    v_deadline,v_checkout_deadline,p_request,v_base,v_platform) returning * into r;
  for v_line in select x from jsonb_array_elements(v_lines) x loop
    insert into public.event_reservation_places(org_id,event_id,reservation_id,participant_passport_id,participant_name,is_managed,
      category_id,prescreening_application_id,reservation_fee_cents,platform_fee_cents,entry_payment_deadline_at)
    values(e.org_id,e.id,r.id,(v_line->>'passport_id')::uuid,v_line->>'name',(v_line->>'is_managed')::boolean,
      (v_line->>'category_id')::uuid,(v_line->>'application_id')::uuid,(v_line->>'fee')::integer,(v_line->>'platform')::integer,(v_line->>'deadline')::timestamptz);
  end loop;
  insert into public.reservation_payments(org_id,event_id,reservation_id,provider,amount_cents,platform_fee_cents)
    values(e.org_id,e.id,r.id,p_provider,v_base+v_platform,v_platform);
  if b.id is not null then update public.prescreening_batches set event_reservation_id=r.id where id=b.id; end if;
  return r.id;
end $$;
revoke all on function public.reserve_category_passports(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.reserve_category_passports(uuid,jsonb,text) to service_role;

create or replace function public.category_reservation_place_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if (new.category_id,new.reservation_id,new.participant_passport_id,new.org_id,new.event_id,
      new.prescreening_application_id,new.reservation_fee_cents,new.platform_fee_cents) is distinct from
      (old.category_id,old.reservation_id,old.participant_passport_id,old.org_id,old.event_id,
      old.prescreening_application_id,old.reservation_fee_cents,old.platform_fee_cents) then
      raise exception 'reservation_place_identity_immutable' using errcode='23514'; end if;
    if new.entry_payment_deadline_at is distinct from old.entry_payment_deadline_at
      and not exists(select 1 from public.prescreening_batches b
        join public.prescreening_applications a on a.batch_id=b.id
        where a.id=new.prescreening_application_id and b.event_reservation_id=new.reservation_id
          and b.status='ready' and b.checkout_intent='reservation' and new.status='held'
          and new.entry_payment_deadline_at=b.payment_deadline_at
          and new.entry_payment_deadline_at>old.entry_payment_deadline_at) then
      raise exception 'reservation_place_identity_immutable' using errcode='23514';
    end if;
  elsif new.category_id is not null then
    if new.reservation_fee_cents is null or new.platform_fee_cents is null or new.entry_payment_deadline_at is null then
      raise exception 'category_reservation_snapshot_required' using errcode='23514'; end if;
    perform public.assert_category_capacity(new.category_id,'reservation',1,null,new.prescreening_application_id);
  end if;
  return new;
end $$;
revoke all on function public.category_reservation_place_guard() from public,anon,authenticated;

-- An organizer's deadline edit and the related pending checkout must move
-- together. Never re-open a lapsed hold; another runner may own its place.
create function public.sync_prescreening_deadlines(p_event uuid) returns void
language plpgsql security definer set search_path='' as $$
declare e public.events%rowtype; b public.prescreening_batches%rowtype; deadline timestamptz;
begin
  select * into strict e from public.events where id=p_event for update;
  for b in select * from public.prescreening_batches
    where event_id=e.id and status='ready' and payment_deadline_at>statement_timestamp()
    order by id for update loop
    deadline:=public.prescreening_deadline(b,e);
    if deadline=b.payment_deadline_at then continue; end if;
    -- A backdated edit closes an open hold now. It cannot invalidate a payment
    -- already made before the organizer changed the setting.
    deadline:=greatest(deadline,statement_timestamp());
    update public.prescreening_batches set payment_deadline_at=deadline where id=b.id;
    update public.booking_orders set expires_at=deadline where id=b.booking_order_id and status='pending';
    update public.event_reservations set checkout_expires_at=deadline,
      registration_deadline_at=greatest(registration_deadline_at,deadline)
      where id=b.event_reservation_id and status='pending';
    update public.event_reservation_places set entry_payment_deadline_at=deadline
      where reservation_id=b.event_reservation_id and status='held' and entry_payment_deadline_at<deadline;
    update public.registrations r set expires_at=deadline from public.prescreening_applications a
      where a.batch_id=b.id and a.id=r.prescreening_application_id and r.status='pending';
  end loop;
end $$;
revoke all on function public.sync_prescreening_deadlines(uuid) from public,anon,authenticated;

create or replace function public.category_capacity_update_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_event uuid; v_used bigint; v_general bigint; v_reserved bigint;
begin
  v_event:=case when tg_op='DELETE' then old.event_id else new.event_id end;
  perform 1 from public.events where id=v_event for update;
  -- Parent deletion has already passed its own authorization/money guards.
  -- Its cascade may reach categories before the remaining registrations.
  if not found and tg_op='DELETE' then return old; end if;
  if tg_op='UPDATE' and (new.org_id,new.event_id) is distinct from (old.org_id,old.event_id) then
    raise exception 'category_scope_immutable' using errcode='23514'; end if;
  if tg_op='DELETE' then
    if exists(select 1 from public.event_capacity_claims(v_event) q where q.category_id=old.id) then
      raise exception 'category_has_existing_places' using errcode='23514'; end if;
    return old;
  end if;
  if not exists(select 1 from public.events where id=new.event_id and org_id=new.org_id) then
    raise exception 'category_scope_mismatch' using errcode='23514'; end if;
  select count(*),count(*) filter(where pool='general'),count(*) filter(where pool='reservation') into v_used,v_general,v_reserved
    from public.event_capacity_claims(v_event) q where q.category_id=new.id;
  if new.slots_total<v_used or (new.reservation_enabled and new.reservation_sales_close_at>statement_timestamp() and
    (new.slots_total-new.reservation_slots<v_general or new.reservation_slots<v_reserved)) then
    raise exception 'category_capacity_below_existing_places' using errcode='23514'; end if;
  if tg_op='UPDATE' and new.entry_payment_deadline_at<old.entry_payment_deadline_at and exists(
    select 1 from public.prescreening_applications a join public.prescreening_batches b on b.id=a.batch_id
      join public.events e on e.id=b.event_id
      where a.category_id=new.id and a.released_at is null and b.checkout_intent='reservation'
        and e.registration_closes_at is null and b.payment_deadline_at>new.entry_payment_deadline_at) then
    raise exception 'category_deadline_below_promised_window' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function public.category_capacity_update_guard() from public,anon,authenticated;

drop trigger event_prescreening_deadline_guard on public.events;
drop function public.event_prescreening_deadline_guard();
create function public.sync_event_screening_deadlines() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='events' then perform public.sync_prescreening_deadlines(new.id);
  else perform public.sync_prescreening_deadlines(new.event_id); end if;
  return null;
end $$;
revoke all on function public.sync_event_screening_deadlines() from public,anon,authenticated;
create trigger sync_event_screening_deadlines after update of registration_closes_at,status on public.events
  for each row when ((old.registration_closes_at,old.status) is distinct from (new.registration_closes_at,new.status))
  execute function public.sync_event_screening_deadlines();
create trigger sync_category_screening_deadlines after update of entry_payment_deadline_at on public.categories
  for each row when (old.entry_payment_deadline_at is distinct from new.entry_payment_deadline_at)
  execute function public.sync_event_screening_deadlines();

select public.sync_prescreening_deadlines(e.id) from public.events e
where exists (select 1 from public.prescreening_batches b where b.event_id=e.id and b.status='ready')
order by e.id;
