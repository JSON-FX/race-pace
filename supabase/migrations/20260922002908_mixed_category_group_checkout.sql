-- Local-only until this branch reaches hosted staging. Mixed-category group
-- checkout keeps one event/order/payment while each
-- registration owns its category. Existing same-category orders retain the
-- header category and legacy reservation payload shape.
alter table public.booking_orders alter column category_id drop not null;

create or replace function public.booking_order_scope_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.events e where e.id=new.event_id and e.org_id=new.org_id)
 then raise exception 'order_scope_mismatch' using errcode='23514'; end if;
 if new.category_id is not null and not exists(select 1 from public.categories c
   where c.id=new.category_id and c.event_id=new.event_id and c.org_id=new.org_id)
 then raise exception 'order_scope_mismatch' using errcode='23514'; end if;
 if TG_OP='UPDATE' and (new.org_id,new.event_id,new.category_id,new.booked_by_user_id,new.idempotency_key)
   is distinct from (old.org_id,old.event_id,old.category_id,old.booked_by_user_id,old.idempotency_key)
 then raise exception 'order_identity_immutable' using errcode='23514'; end if;
 return new;
end $$;

create or replace function public.registration_order_scope_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' and new.booking_order_id is distinct from old.booking_order_id
 then raise exception 'registration_order_immutable' using errcode='23514'; end if;
 if new.booking_order_id is not null and not exists(select 1 from public.booking_orders o
   join public.categories c on c.id=new.category_id
   where o.id=new.booking_order_id and o.org_id=new.org_id and o.event_id=new.event_id
     and o.booked_by_user_id=new.booked_by_user_id and c.org_id=o.org_id and c.event_id=o.event_id
     and (o.category_id is null or o.category_id=new.category_id))
 then raise exception 'registration_order_scope_mismatch' using errcode='23514'; end if;
 return new;
end $$;

create or replace function public.booking_order_reservation_result(p_order_id uuid) returns jsonb
language sql set search_path='' as $$
  select jsonb_build_object(
    'order_id',o.id,
    'status',case when o.status='pending' and o.expires_at<=statement_timestamp() then 'expired' else o.status end,
    'expires_at',o.expires_at, 'entry_total_cents',o.entry_total_cents,
    'registrations',coalesce((select jsonb_agg(jsonb_build_object(
      'registration_id',r.id,'participant_passport_id',r.participant_passport_id,
      'category_id',r.category_id,'entry_total_cents',r.total_amount) order by r.participant_passport_id)
      from public.registrations r where r.booking_order_id=o.id),'[]'::jsonb))
  from public.booking_orders o where o.id=p_order_id;
$$;

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

  v_expiry:=statement_timestamp()+interval '24 hours';
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
  return public.booking_order_reservation_result(v_order.id);
end $$;

-- Replace the latest provider-managed-fee confirmation with per-category
-- capacity accounting. Payment and ticket allocation semantics stay unchanged.
create or replace function public.booking_payment_confirm(p_attempt uuid,p_capture jsonb,p_tokens jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare a public.booking_payment_attempts%rowtype; o public.booking_orders%rowtype; d public.booking_payment_dispatches%rowtype;
  c public.booking_payment_captures%rowtype; v_n integer; v_reason text; v_fee integer;
  v_provider_managed boolean; v_excess integer:=0;
begin
  select * into a from public.booking_payment_attempts where id=p_attempt;
  if not found then raise exception 'attempt_not_found' using errcode='22023'; end if;
  select * into o from public.booking_orders where id=a.booking_order_id;
  perform 1 from public.categories cat where cat.id in
    (select distinct r.category_id from public.registrations r where r.booking_order_id=o.id)
    order by cat.id for update;
  select * into o from public.booking_orders where id=a.booking_order_id for update;
  select * into a from public.booking_payment_attempts where id=p_attempt for update;
  v_provider_managed:=coalesce((a.terms_snapshot->>'provider_managed_fee')::boolean,false);
  select * into d from public.booking_payment_dispatches where attempt_id=p_attempt;
  if p_capture->>'paymentId' is null or p_capture->>'paymentId' !~ '^pay_'
  then raise exception 'invalid_capture_identity' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('capture:'||(p_capture->>'paymentId'),0));
  select * into c from public.booking_payment_captures where payment_id=p_capture->>'paymentId';
  if found then
    if c.attempt_id<>a.id then raise exception 'capture_identity_conflict' using errcode='23514'; end if;
    return c.state;
  end if;
  insert into public.booking_payment_captures(org_id,booking_order_id,attempt_id,payment_id,capture)
    values(o.org_id,o.id,a.id,p_capture->>'paymentId',p_capture) returning * into c;
  if exists(select 1 from public.booking_payment_captures where booking_order_id=o.id and state='fulfilled')
  then v_reason:='extra_capture';
  elsif p_capture->>'invalidReason' is not null then v_reason:='invalid_provider_capture';
  elsif d.session_id is null or p_capture->>'sessionId' is distinct from d.session_id
    or p_capture->>'attemptId' is distinct from a.id::text or p_capture->>'orderId' is distinct from o.id::text
    or p_capture->>'currency' is distinct from 'PHP' or (p_capture->>'livemode')::boolean is distinct from d.livemode
    or (v_provider_managed and ((p_capture->>'amount')::bigint-(p_capture->>'feeCents')::bigint
      < a.gross_cents::bigint or (p_capture->>'amount')::bigint-(p_capture->>'feeCents')::bigint>a.gross_cents::bigint+1))
    or (not v_provider_managed and (p_capture->>'amount')::bigint is distinct from a.gross_cents::bigint)
  then v_reason:='capture_mismatch';
  elsif o.status not in ('pending','expired') then v_reason:='order_not_confirmable';
  end if;
  perform 1 from public.registrations where booking_order_id=o.id order by id for update;
  select count(*) into v_n from public.booking_payment_quote_lines where attempt_id=a.id;
  if v_reason is null and (v_n<1 or v_n>10 or v_n<>(select count(*) from public.registrations where booking_order_id=o.id)
    or exists(select 1 from public.booking_payment_quote_lines q left join public.registrations r on r.id=q.registration_id
      where q.attempt_id=a.id and (r.id is null or r.booking_order_id<>o.id or r.status not in ('pending','expired') or r.total_amount<>q.base_cents))
    or (select sum(gross_cents) from public.booking_payment_quote_lines where attempt_id=a.id)<>a.gross_cents)
  then v_reason:='order_entries_changed'; end if;
  if v_reason is null and (not exists(select 1 from public.events where id=o.event_id and status in ('open','almost_full'))
    or not exists(select 1 from public.organizations where id=o.org_id and is_active))
  then v_reason:='event_unavailable'; end if;
  if v_reason is null and exists(select 1 from public.registrations r join public.registrations other
    on other.event_id=r.event_id and other.participant_passport_id=r.participant_passport_id and other.id<>r.id
    where r.booking_order_id=o.id and other.status in ('pending','paid'))
  then v_reason:='participant_already_registered'; end if;
  if v_reason is null and exists(
    select 1 from public.categories cat
    join (select category_id,count(*)::integer needed from public.registrations where booking_order_id=o.id group by category_id) wanted
      on wanted.category_id=cat.id
    where (select count(*) from public.registrations other where other.category_id=cat.id
      and other.booking_order_id is distinct from o.id and (other.status='paid' or
        (other.status='pending' and (other.expires_at is null or other.expires_at>statement_timestamp()))))
      +wanted.needed>cat.slots_total)
  then v_reason:='capacity_unavailable'; end if;
  if v_reason is null and (jsonb_typeof(p_tokens) is distinct from 'object' or
    exists(select 1 from public.booking_payment_quote_lines where attempt_id=a.id and coalesce(length(p_tokens->>registration_id::text),0)<20))
  then raise exception 'ticket_tokens_required' using errcode='22023'; end if;
  v_fee:=(p_capture->>'feeCents')::integer;
  if v_reason is null and (v_fee is null or v_fee<0 or v_fee>(p_capture->>'amount')::bigint)
  then v_reason:='invalid_processor_fee'; end if;
  if v_reason is null and v_provider_managed then v_excess:=(p_capture->>'amount')::integer-v_fee-a.gross_cents; end if;
  if v_reason is null then
    begin
      update public.registrations set status='paid',expires_at=null,ticket_token=p_tokens->>id::text where booking_order_id=o.id;
      with used as (select category_id,count(*)::integer n from public.registrations where booking_order_id=o.id group by category_id)
      update public.categories cat set slots_taken=cat.slots_taken+used.n from used where cat.id=used.category_id;
      with parts as (
        select q.*,case when a.gross_cents=0 then 0 else v_fee::bigint*q.gross_cents/a.gross_cents end part,
          case when a.gross_cents=0 then 0 else v_fee::bigint*q.gross_cents%a.gross_cents end rem
        from public.booking_payment_quote_lines q where attempt_id=a.id
      ), ranked as (select *,row_number() over(order by rem desc,registration_id) rn,sum(part) over() parts from parts),
      allocated as (select *,part+case when rn<=v_fee-parts then 1 else 0 end fee from ranked)
      insert into public.booking_payment_allocations(capture_id,org_id,registration_id,gross_cents,platform_fee_cents,processor_fee_cents,net_to_org_cents)
        select c.id,o.org_id,registration_id,
          gross_cents+case when v_provider_managed then fee else 0 end+
            case when v_provider_managed and registration_id=(select q.registration_id from public.booking_payment_quote_lines q where q.attempt_id=a.id order by q.registration_id limit 1) then v_excess else 0 end,
          platform_fee_cents,fee,
          gross_cents::bigint+case when v_provider_managed then fee else 0 end+
            case when v_provider_managed and registration_id=(select q.registration_id from public.booking_payment_quote_lines q where q.attempt_id=a.id order by q.registration_id limit 1) then v_excess else 0 end-platform_fee_cents-fee
        from allocated;
      update public.booking_orders set status='paid',expires_at=null where id=o.id;
      update public.booking_payment_attempts set status='paid' where id=a.id;
      update public.booking_payment_captures set state='fulfilled' where id=c.id;
      insert into public.booking_order_deliveries(booking_order_id,org_id) values(o.id,o.org_id);
      return 'fulfilled';
    exception when unique_violation or check_violation then v_reason:='fulfillment_conflict';
    end;
  end if;
  update public.booking_payment_captures set state='reconciliation_required',reason=v_reason where id=c.id;
  if o.status<>'paid' then
    update public.booking_orders set status='reconciliation_required' where id=o.id;
    update public.booking_payment_attempts set status='reconciliation_required' where id=a.id;
  end if;
  return 'reconciliation_required';
end $$;

create or replace function public.booking_refund_claim_before_reporting(
 p_actor uuid,p_order uuid,p_registration_ids uuid[],p_key uuid,p_expected_amount integer,
 p_preview boolean,p_provider_scope text,p_livemode boolean
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 o booking_orders; c booking_payment_captures; terms organizations; q booking_refund_requests;
 ids uuid[]; selection jsonb; amount integer; paid integer; lines jsonb; result jsonb;
begin
 select * into o from booking_orders where id=p_order;
 if not found then raise exception 'order_not_found'; end if;
 if not exists(select 1 from user_roles where user_id=p_actor and
   (role='super_admin' or (org_id=o.org_id and role in ('admin','editor')))) then raise exception 'forbidden'; end if;
 perform 1 from categories cat where cat.id in(select distinct category_id from registrations where booking_order_id=o.id)
   order by cat.id for update;
 perform 1 from booking_orders where id=p_order for update;
 perform pg_advisory_xact_lock(hashtextextended('group-refund:'||p_actor::text||':'||p_key::text,0));
 if p_key is null or p_preview is null then raise exception 'invalid_input'; end if;
 if p_registration_ids is not null and (cardinality(p_registration_ids) not between 1 and 10
   or array_position(p_registration_ids,null) is not null) then raise exception 'invalid_selection'; end if;
 select array_agg(distinct x order by x) into ids from unnest(p_registration_ids) x;
 selection:=case when p_registration_ids is null then '{"all":true}'::jsonb else to_jsonb(ids) end;
 select * into q from booking_refund_requests where actor_id=p_actor and idempotency_key=p_key for update;
 if found then
   if q.booking_order_id<>p_order or q.selection<>selection then raise exception 'idempotency_conflict'; end if;
   if not p_preview and p_expected_amount is distinct from q.refund_amount then raise exception 'refund_amount_changed'; end if;
   if not p_preview and (p_provider_scope is distinct from q.provider_scope or p_livemode is distinct from q.livemode) then raise exception 'provider_scope_changed'; end if;
   return jsonb_build_object('action',case when p_preview then 'preview' when q.status in ('succeeded','failed','review_required') then q.status
     when q.provider_refund_id is not null then 'reconcile' else 'pending' end,'request',to_jsonb(q),
     'refund_amount',q.refund_amount,'total_paid',q.total_paid,'retained_fees',q.total_paid-q.refund_amount);
 end if;
 select * into c from booking_payment_captures where booking_order_id=p_order and state='fulfilled' for update;
 if not found then raise exception 'fulfilled_capture_required'; end if;
 if exists(select 1 from booking_refund_requests where capture_id=c.id and status not in ('succeeded','failed')) then raise exception 'refund_in_progress'; end if;
 if p_registration_ids is null then
   select array_agg(r.id order by r.id) into ids from registrations r join booking_payment_allocations a on a.registration_id=r.id
     where a.capture_id=c.id and r.status='paid';
 end if;
 if coalesce(cardinality(ids),0)=0 then raise exception 'no_refundable_tickets'; end if;
 perform 1 from registrations where id=any(ids) order by id for update;
 if (select count(*) from registrations r join booking_payment_allocations a on a.registration_id=r.id
   where r.id=any(ids) and r.booking_order_id=p_order and r.status='paid' and a.capture_id=c.id)<>cardinality(ids)
   then raise exception 'tickets_not_refundable'; end if;
 if exists(select 1 from booking_payment_allocations where capture_id=c.id and registration_id=any(ids)
   and (net_to_org_cents is null or net_to_org_cents<0 or processor_fee_cents is null)) then raise exception 'actual_fees_required'; end if;
 select * into terms from organizations where id=o.org_id for share;
 if terms.refund_policy='none' then raise exception 'policy_forbids'; end if;
 select sum(a.net_to_org_cents-case when terms.refund_policy='flat_fee' then least(terms.refund_fee_cents,a.net_to_org_cents) else 0 end)::integer,
   sum(a.gross_cents)::integer,jsonb_agg(jsonb_build_object('registration_id',a.registration_id,
     'refund_amount',a.net_to_org_cents-case when terms.refund_policy='flat_fee' then least(terms.refund_fee_cents,a.net_to_org_cents) else 0 end,
     'retained_net',case when terms.refund_policy='flat_fee' then least(terms.refund_fee_cents,a.net_to_org_cents) else 0 end) order by a.registration_id)
 into amount,paid,lines from booking_payment_allocations a where a.capture_id=c.id and a.registration_id=any(ids);
 if amount between 1 and 99 then raise exception 'refund_below_provider_minimum'; end if;
 if amount+coalesce((select sum(refund_amount) from booking_refund_requests where capture_id=c.id and status<>'failed'),0)
   >(c.capture->>'amount')::bigint then raise exception 'refund_budget_exceeded'; end if;
 result:=jsonb_build_object('refund_amount',amount,'total_paid',paid,'retained_fees',paid-amount,'lines',lines);
 if p_preview then return result||jsonb_build_object('action','preview'); end if;
 if p_expected_amount is distinct from amount then raise exception 'refund_amount_changed'; end if;
 if coalesce(p_provider_scope,'')='' or p_livemode is distinct from (c.capture->>'livemode')::boolean then raise exception 'provider_scope_changed'; end if;
 insert into booking_refund_requests(org_id,booking_order_id,capture_id,actor_id,idempotency_key,selection,policy_snapshot,refund_amount,total_paid,provider_scope,livemode,payment_id)
 values(o.org_id,o.id,c.id,p_actor,p_key,selection,jsonb_build_object('policy',terms.refund_policy,'fee_cents',terms.refund_fee_cents),amount,paid,p_provider_scope,p_livemode,c.payment_id) returning * into q;
 insert into booking_refund_lines(request_id,org_id,capture_id,registration_id,refund_amount,retained_net)
 select q.id,o.org_id,c.id,(x->>'registration_id')::uuid,(x->>'refund_amount')::integer,(x->>'retained_net')::integer from jsonb_array_elements(lines) x;
 if amount=0 then
   update registrations set status='refunded',ticket_token=null where id=any(ids);
   with released as (select category_id,count(*)::integer n from registrations where id=any(ids) group by category_id)
   update categories cat set slots_taken=greatest(0,cat.slots_taken-released.n) from released where cat.id=released.category_id;
   update booking_refund_requests set status='succeeded',completed_at=now() where id=q.id returning * into q;
 end if;
 return result||jsonb_build_object('action',case when amount=0 then 'succeeded' else 'submit' end,'request',to_jsonb(q));
end $$;

create or replace function public.booking_refund_apply_before_reporting(p_request uuid,p_resource jsonb)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare q booking_refund_requests; o booking_orders; a jsonb; rid text; state text; n integer;
begin
 select * into q from booking_refund_requests where id=p_request;
 if not found then raise exception 'refund_not_found'; end if;
 select * into o from booking_orders where id=q.booking_order_id;
 perform 1 from categories cat where cat.id in(select distinct category_id from registrations where booking_order_id=o.id)
   order by cat.id for update;
 perform 1 from booking_orders where id=o.id for update;
 select * into q from booking_refund_requests where id=p_request for update;
 a:=p_resource->'attributes'; rid:=p_resource->>'id'; state:=a->>'status';
 if rid is null or rid !~ '^ref_[A-Za-z0-9_-]+$' or (q.provider_refund_id is not null and q.provider_refund_id<>rid)
   or (a->'amount') is distinct from to_jsonb(q.refund_amount)
   or (a->>'payment_id') is distinct from q.payment_id or (a->>'currency') is distinct from 'PHP'
   or (a->'livemode') is distinct from to_jsonb(q.livemode)
   or (a#>>'{metadata,refund_request_id}') is distinct from q.id::text
   or state is null or state not in ('pending','processing','succeeded','failed')
   or exists(select 1 from booking_refund_requests where provider_refund_id=rid and id<>q.id) then
   if q.status not in ('succeeded','failed') then update booking_refund_requests set status='review_required',provider_resource=p_resource where id=q.id; end if;
   return 'review_required';
 end if;
 if q.status='succeeded' then return 'succeeded'; end if;
 if q.status='failed' then
   if state='succeeded' then
     if exists(select 1 from booking_refund_requests where capture_id=q.capture_id and id<>q.id and status not in ('succeeded','failed')) then raise exception 'refund_terminal_conflict'; end if;
     update booking_refund_requests set status='review_required',provider_resource=p_resource where id=q.id;
     return 'review_required';
   end if;
   return 'failed';
 end if;
 if q.status='review_required' then return 'review_required'; end if;
 if state='succeeded' then
   perform 1 from registrations where id in(select registration_id from booking_refund_lines where request_id=q.id) order by id for update;
   select count(*) into n from booking_refund_lines where request_id=q.id;
   if n=0 or (select count(*) from registrations where status='paid' and id in(select registration_id from booking_refund_lines where request_id=q.id))<>n then
     update booking_refund_requests set status='review_required',provider_resource=p_resource where id=q.id;
     return 'review_required';
   end if;
   update registrations set status='refunded',ticket_token=null where id in(select registration_id from booking_refund_lines where request_id=q.id);
   with released as (select r.category_id,count(*)::integer n from registrations r
     join booking_refund_lines l on l.registration_id=r.id where l.request_id=q.id group by r.category_id)
   update categories cat set slots_taken=greatest(0,cat.slots_taken-released.n) from released where cat.id=released.category_id;
 end if;
 update booking_refund_requests set provider_refund_id=rid,provider_resource=p_resource,
   status=case when state='processing' then 'pending' else state end,
   completed_at=case when state in ('succeeded','failed') then now() else null end where id=q.id;
 return case when state='processing' then 'pending' else state end;
end $$;

revoke all on function public.booking_order_scope_guard(),public.registration_order_scope_guard(),
 public.booking_order_reservation_result(uuid),public.booking_order_reserve(uuid,jsonb,jsonb,jsonb),
 public.booking_payment_confirm(uuid,jsonb,jsonb),
 public.booking_refund_claim_before_reporting(uuid,uuid,uuid[],uuid,integer,boolean,text,boolean),
 public.booking_refund_apply_before_reporting(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.booking_order_scope_guard(),public.registration_order_scope_guard(),
 public.booking_order_reservation_result(uuid),public.booking_order_reserve(uuid,jsonb,jsonb,jsonb),
 public.booking_payment_confirm(uuid,jsonb,jsonb),
 public.booking_refund_claim_before_reporting(uuid,uuid,uuid[],uuid,integer,boolean,text,boolean),
 public.booking_refund_apply_before_reporting(uuid,jsonb) to service_role;
