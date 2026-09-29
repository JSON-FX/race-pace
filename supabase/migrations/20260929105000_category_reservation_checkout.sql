-- Local-only until reviewed staging deployment. Legacy headers keep unit prices;
-- new headers also retain immutable totals for heterogeneous category fees.
alter table public.event_reservations
  add column reservation_request jsonb,
  add column reservation_total_fee_cents integer check (reservation_total_fee_cents>0),
  add column reservation_total_platform_fee_cents integer check (reservation_total_platform_fee_cents>=0),
  add constraint category_reservation_totals check (reservation_request is null or
    (reservation_total_fee_cents is not null and reservation_total_platform_fee_cents is not null));

create or replace function public.event_reservation_capacity_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare e public.events%rowtype;
begin
  select * into e from public.events where id=new.event_id for update;
  if not found or e.org_id<>new.org_id then raise exception 'reservation_event_scope_mismatch' using errcode='23514'; end if;
  if tg_op='UPDATE' and
    (new.org_id,new.event_id,new.user_id,new.idempotency_key,new.quantity,new.reservation_fee_cents,new.platform_fee_cents,
     new.reservation_request,new.reservation_total_fee_cents,new.reservation_total_platform_fee_cents) is distinct from
    (old.org_id,old.event_id,old.user_id,old.idempotency_key,old.quantity,old.reservation_fee_cents,old.platform_fee_cents,
     old.reservation_request,old.reservation_total_fee_cents,old.reservation_total_platform_fee_cents) then
    raise exception 'reservation_identity_immutable' using errcode='23514'; end if;
  if new.status not in ('pending','paid','review_required') then return new; end if;
  if tg_op='UPDATE' and old.status in ('pending','paid','review_required') then return new; end if;
  if new.reservation_request is not null then
    if e.status not in ('coming_soon','open','almost_full') then raise exception 'reservations_not_open' using errcode='23514'; end if;
    -- The category RPC inserts guarded places in this same transaction.
    return new;
  end if;
  if e.status<>'coming_soon' or not e.coming_soon_reserve_enabled or e.reservation_deadline_at<=statement_timestamp() then
    raise exception 'reservations_not_open' using errcode='23514'; end if;
  if exists(select 1 from public.categories where event_id=e.id and (prescreening_enabled or reservation_enabled)) then
    raise exception 'category_reservation_required' using errcode='23514'; end if;
  if (select count(*) from public.event_capacity_claims(e.id) q where q.reservation_place_id is distinct from new.id)+new.quantity>e.total_event_slots then
    raise exception 'event_capacity_exhausted' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function public.event_reservation_capacity_guard() from public,anon,authenticated;

create function public.category_reservation_place_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if (new.category_id,new.reservation_id,new.participant_passport_id,new.org_id,new.event_id,
      new.prescreening_application_id,new.reservation_fee_cents,new.platform_fee_cents,new.entry_payment_deadline_at) is distinct from
      (old.category_id,old.reservation_id,old.participant_passport_id,old.org_id,old.event_id,
      old.prescreening_application_id,old.reservation_fee_cents,old.platform_fee_cents,old.entry_payment_deadline_at) then
      raise exception 'reservation_place_identity_immutable' using errcode='23514'; end if;
  elsif new.category_id is not null then
    if new.reservation_fee_cents is null or new.platform_fee_cents is null or new.entry_payment_deadline_at is null then
      raise exception 'category_reservation_snapshot_required' using errcode='23514'; end if;
    perform public.assert_category_capacity(new.category_id,'reservation',1,null,new.prescreening_application_id);
  end if;
  return new;
end $$;
revoke all on function public.category_reservation_place_guard() from public,anon,authenticated;
create trigger category_reservation_place_guard before insert or update on public.event_reservation_places
  for each row execute function public.category_reservation_place_guard();

create function public.reserve_category_passports(p_actor uuid,p_request jsonb,p_provider text) returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.events%rowtype; o public.organizations%rowtype; c public.categories%rowtype; p public.runner_passports%rowtype;
  b public.prescreening_batches%rowtype; a public.prescreening_applications%rowtype; r public.event_reservations%rowtype;
  v_line jsonb; v_lines jsonb:='[]'; v_count integer; v_fee integer; v_base bigint:=0; v_platform bigint:=0;
  v_deadline timestamptz; v_checkout_deadline timestamptz; v_email text;
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
    if c.reservation_fee_cents is null or c.entry_payment_deadline_at<=statement_timestamp() then
      raise exception 'reservation_deadline_passed' using errcode='23514'; end if;
    perform public.assert_category_capacity(c.id,'reservation',1,null,a.id);
    v_fee:=case when o.reservation_commission_type='fixed' then o.reservation_commission_flat_cents
      else round(c.reservation_fee_cents*o.reservation_commission_rate)::integer end;
    v_base:=v_base+c.reservation_fee_cents; v_platform:=v_platform+v_fee;
    v_deadline:=greatest(v_deadline,c.entry_payment_deadline_at);
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('category_id',c.id,'passport_id',p.id,'application_id',a.id,
      'name',coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),nullif(btrim(p.legacy_full_name),''),'My Race Passport'),
      'is_managed',p.claimed_user_id is distinct from p_actor,'fee',c.reservation_fee_cents,'platform',v_fee,'deadline',c.entry_payment_deadline_at));
  end loop;
  if v_base+v_platform>2147483647 then raise exception 'order_amount_too_large' using errcode='22023'; end if;
  v_checkout_deadline:=coalesce(b.payment_deadline_at,least(v_deadline,statement_timestamp()+interval '24 hours'));
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

create or replace function public.event_capacity_claims(p_event uuid)
returns table(category_id uuid,participant_passport_id uuid,registration_id uuid,
  reservation_place_id uuid,application_id uuid,pool text)
language sql stable security definer set search_path='' as $$
  with active_entries as (
    select r.* from public.registrations r where r.event_id=p_event and (
      r.status='paid' or (r.status='pending' and (r.expires_at is null or r.expires_at>statement_timestamp())) or
      (r.status in ('pending','expired') and (
        exists(select 1 from public.payments p where p.registration_id=r.id and p.provider='paymongo'
          and p.status='pending' and (p.provider_ref is not null or p.checkout_request is not null)) or
        exists(select 1 from public.booking_payment_attempts a where a.booking_order_id=r.booking_order_id
          and a.status in ('creating','ready','creation_unknown','reconciliation_required'))
      ))
    )
  ), held_places as (
    select p.* from public.event_reservation_places p join public.event_reservations q on q.id=p.reservation_id
    where p.event_id=p_event and p.status='held' and q.status in ('pending','paid','review_required')
      and not exists(select 1 from active_entries r where r.event_reservation_id=p.reservation_id
        and r.participant_passport_id=p.participant_passport_id)
  )
  select r.category_id,r.participant_passport_id,r.id,null::uuid,r.prescreening_application_id,
    case when exists(select 1 from public.event_reservation_places p where p.reservation_id=r.event_reservation_id
      and p.participant_passport_id=r.participant_passport_id and p.category_id=r.category_id)
      or exists(select 1 from public.prescreening_applications a join public.prescreening_batches b on b.id=a.batch_id
        where a.id=r.prescreening_application_id and b.checkout_intent='reservation')
      then 'reservation' else 'general' end
  from active_entries r
  union all
  select p.category_id,p.participant_passport_id,null::uuid,p.id,p.prescreening_application_id,'reservation' from held_places p
  union all
  select a.category_id,a.participant_passport_id,null::uuid,null::uuid,a.id,
    case when b.checkout_intent='reservation' then 'reservation' else 'general' end
  from public.prescreening_applications a join public.prescreening_batches b on b.id=a.batch_id
  where a.event_id=p_event and a.released_at is null
    and not exists(select 1 from active_entries r where r.prescreening_application_id=a.id)
    and not exists(select 1 from held_places p where p.prescreening_application_id=a.id)
  union all
  -- Older reservations may have neither a category nor child Passport places.
  select null::uuid,null::uuid,null::uuid,q.id,null::uuid,'reservation'
  from public.event_reservations q where q.event_id=p_event and q.reservation_request is null and q.status in ('pending','paid','review_required')
    and not exists(select 1 from public.event_reservation_places p where p.reservation_id=q.id)
    and not exists(select 1 from active_entries r where r.event_reservation_id=q.id);
$$;
revoke all on function public.event_capacity_claims(uuid) from public,anon,authenticated;
grant execute on function public.event_capacity_claims(uuid) to service_role;

create or replace function public.confirm_reservation_payment(
  p_reservation_id uuid,p_provider_ref text,p_provider_payment_id text,
  p_amount_cents integer,p_processor_fee_cents integer,p_provider_net_cents integer,
  p_method text,p_raw jsonb
) returns text language plpgsql security invoker set search_path = '' as $$
declare v_payment public.reservation_payments%rowtype; v_res public.event_reservations%rowtype;
  v_outcome text; v_base bigint; v_paid_at timestamptz; v_batch public.prescreening_batches%rowtype;
begin
  perform 1 from public.events where id=(select event_id from public.event_reservations where id=p_reservation_id) for update;
  select * into v_res from public.event_reservations where id=p_reservation_id for update;
  select * into v_payment from public.reservation_payments where reservation_id=p_reservation_id for update;
  if not found then raise exception 'reservation_payment_missing' using errcode='23503'; end if;
  if exists (select 1 from public.reservation_capture_events where provider_payment_id=p_provider_payment_id) then
    return case when v_payment.provider_payment_id=p_provider_payment_id and v_payment.status='paid'
      then 'already_paid' else 'review_required' end;
  end if;
  v_base:=(coalesce(v_res.reservation_total_fee_cents,v_res.reservation_fee_cents::bigint*v_res.quantity)+coalesce(v_res.reservation_total_platform_fee_cents,v_res.platform_fee_cents::bigint*v_res.quantity));
  select * into v_batch from public.prescreening_batches where event_reservation_id=v_res.id;
  if v_batch.id is not null then
    begin v_paid_at:=(p_raw->>'racepace_provider_paid_at')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then v_paid_at:=null; end;
    if v_payment.provider='fake' then v_paid_at:=statement_timestamp(); end if;
  end if;
  v_outcome:=case
    when (v_batch.id is not null and (v_batch.status<>'ready' or v_paid_at is null or v_paid_at>v_batch.payment_deadline_at))
      or v_payment.provider_ref is distinct from p_provider_ref or v_res.status not in ('pending','paid')
      or v_payment.status not in ('pending','paid') or v_payment.provider_payment_id is not null
      or p_amount_cents is null or p_processor_fee_cents is null or p_provider_net_cents is null
      or p_amount_cents<0 or p_processor_fee_cents<0 or p_provider_net_cents<0
      or p_amount_cents-p_processor_fee_cents<>p_provider_net_cents
      or p_provider_net_cents<v_base or p_provider_net_cents>v_base+1
    then 'review_required' else 'settled' end;
  insert into public.reservation_capture_events(
    provider_payment_id,reservation_id,provider_ref,amount_cents,processor_fee_cents,provider_net_cents,outcome,raw
  ) values (p_provider_payment_id,p_reservation_id,p_provider_ref,p_amount_cents,
    p_processor_fee_cents,p_provider_net_cents,v_outcome,p_raw);
  if v_outcome='review_required' then
    update public.event_reservations set status='review_required' where id=p_reservation_id and status='pending';
    update public.reservation_payments set status='review_required',raw=p_raw where id=v_payment.id and status='pending';
    return v_outcome;
  end if;
  update public.reservation_payments set status='paid',provider_payment_id=p_provider_payment_id,
    method=p_method,amount_cents=p_amount_cents,processor_fee_cents=p_processor_fee_cents,
    processor_fee_source='actual',net_to_org_cents=p_amount_cents-p_processor_fee_cents-coalesce(v_res.reservation_total_platform_fee_cents,v_res.platform_fee_cents*v_res.quantity),
    raw=p_raw,paid_at=now() where id=v_payment.id;
  update public.event_reservations set status='paid',paid_at=now() where id=p_reservation_id;
  return 'paid';
end $$;
revoke all on function public.confirm_reservation_payment(uuid,text,text,integer,integer,integer,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.confirm_reservation_payment(uuid,text,text,integer,integer,integer,text,jsonb)
  to service_role;
