-- Follow-up only: PayMongo determines pass-on fees at the chosen method's
-- checkout. New group pass-on quotes are pre-processing subtotals. The captured
-- payment must return an actual, balanced fee before any ticket or payout is
-- created. Existing prepared v1 attempts keep their frozen request/terms.

create or replace function public.booking_order_prepare_payment(p_actor uuid,p_order uuid,p_method text,p_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_order public.booking_orders%rowtype; v_org public.organizations%rowtype;
  v_attempt public.booking_payment_attempts%rowtype; v_rate public.processor_rates%rowtype;
  v_method text := case when p_method='maya' then 'paymaya' else p_method end;
  v_lines jsonb; v_count bigint; v_base bigint; v_commission bigint;
  v_target bigint; v_gross bigint; v_surcharge bigint; v_predicted bigint;
  v_terms jsonb;
begin
  if p_key is null or p_order is null or v_method is null or v_method not in ('card','gcash','paymaya')
  then raise exception 'invalid_input' using errcode='22023'; end if;
  perform 1 from auth.users where id=p_actor and email_confirmed_at is not null and not coalesce(is_anonymous,false) for share;
  if not found then raise exception 'booking_email_unverified' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('payment:'||p_actor::text||':'||p_key::text,0));
  select * into v_order from public.booking_orders where id=p_order and booked_by_user_id=p_actor for update;
  if not found then raise exception 'order_not_found' using errcode='42501'; end if;
  if v_order.status<>'pending' then raise exception 'order_not_pending' using errcode='22023'; end if;
  if v_order.expires_at is null or v_order.expires_at<=statement_timestamp()
  then raise exception 'hold_expired' using errcode='22023'; end if;
  perform 1 from public.events where id=v_order.event_id and org_id=v_order.org_id and status in ('open','almost_full') for share;
  if not found then raise exception 'registration_closed' using errcode='22023'; end if;
  select * into v_org from public.organizations where id=v_order.org_id for share;
  if not v_org.is_active then raise exception 'org_suspended' using errcode='22023'; end if;
  perform 1 from public.registrations where booking_order_id=p_order order by id for share;
  select count(*),coalesce(sum(total_amount),0) into v_count,v_base from public.registrations where booking_order_id=p_order;
  if v_count<1 or v_count>10 or v_count is distinct from jsonb_array_length(v_order.reservation_request->'participants')
    or v_base is distinct from v_order.entry_total_cents or exists(select 1 from public.registrations r where booking_order_id=p_order
      and (r.status<>'pending' or r.expires_at is null or r.expires_at<=statement_timestamp() or r.total_amount<0
        or r.category_id<>v_order.category_id or r.event_id<>v_order.event_id or r.org_id<>v_order.org_id))
  then raise exception 'order_entries_changed' using errcode='22023'; end if;

  select * into v_attempt from public.booking_payment_attempts where booked_by_user_id=p_actor and idempotency_key=p_key for update;
  if found then
    if v_attempt.booking_order_id<>p_order or v_attempt.method<>v_method
    then raise exception 'idempotency_conflict' using errcode='22023'; end if;
    return public.booking_payment_preparation_result(v_attempt.id);
  end if;
  if exists(select 1 from public.booking_payment_attempts where booking_order_id=p_order and status not in ('failed','expired'))
  then raise exception 'payment_attempt_in_progress' using errcode='22023'; end if;
  if v_org.commission_rate<0 or v_org.commission_flat_cents<0
  then raise exception 'invalid_terms' using errcode='22023'; end if;
  select jsonb_agg(jsonb_build_object('id',r.id,'base',r.total_amount,'fee',
    least(r.total_amount,case when v_org.commission_type='fixed' then v_org.commission_flat_cents
      else round(r.total_amount::numeric*coalesce(v_org.commission_rate,0.10))::bigint end)) order by r.id)
    into v_lines from public.registrations r where r.booking_order_id=p_order;
  select sum((x->>'fee')::bigint) into v_commission from jsonb_array_elements(v_lines) x;
  if v_base>0 and v_org.fee_mode='absorb' then
    select * into v_rate from public.processor_rates where provider='paymongo' and method=v_method and scope='local'
      and effective_from<=statement_timestamp() and (effective_to is null or effective_to>statement_timestamp())
      order by effective_from desc,id limit 1 for share;
    if not found then raise exception 'rate_card_missing' using errcode='22023'; end if;
    if v_rate.percent_bps>=10000 then raise exception 'invalid_processor_rate' using errcode='22023'; end if;
  end if;
  v_target := v_base+case when v_org.fee_mode='pass_on' then v_commission else 0 end;
  v_gross := case when v_base=0 then 0 when v_org.fee_mode='absorb' then v_base else v_target end;
  v_surcharge := case when v_org.fee_mode='pass_on' then v_gross-v_target else 0 end;
  v_predicted := case when v_gross=0 or v_org.fee_mode='pass_on' then 0
    else (v_gross*v_rate.percent_bps+5000)/10000+v_rate.fixed_cents end;
  if greatest(v_base,v_commission,v_gross,v_surcharge,v_predicted)>2147483647
  then raise exception 'order_amount_too_large' using errcode='22023'; end if;
  v_terms := jsonb_build_object('fee_mode',v_org.fee_mode,'commission_type',v_org.commission_type,
    'commission_bps',round(coalesce(v_org.commission_rate,0.10)*10000),'commission_flat_cents',v_org.commission_flat_cents,
    'rate_id',v_rate.id,'percent_bps',coalesce(v_rate.percent_bps,0),'fixed_cents',coalesce(v_rate.fixed_cents,0),
    'provider_managed_fee',v_org.fee_mode='pass_on');
  insert into public.booking_payment_attempts(org_id,booking_order_id,booked_by_user_id,idempotency_key,method,
    terms_snapshot,base_cents,platform_fee_cents,processor_surcharge_cents,gross_cents,processor_fee_predicted_cents,net_to_org_predicted_cents)
  values(v_order.org_id,p_order,p_actor,p_key,v_method,v_terms,v_base,v_commission,v_surcharge,v_gross,v_predicted,v_gross-v_commission-v_predicted)
  returning * into v_attempt;

  -- First allocate surcharge on pre-processor payable weights, then allocate
  -- predicted processor cost on final gross. Stable UUID ties preserve centavos.
  with entries as (
    select (x->>'id')::uuid id,(x->>'base')::bigint base,(x->>'fee')::bigint fee,
      (x->>'base')::bigint+case when v_org.fee_mode='pass_on' then (x->>'fee')::bigint else 0 end weight
    from jsonb_array_elements(v_lines) x
  ), surcharge_floor as (
    select *,case when v_target=0 then 0 else v_surcharge*weight/v_target end part,
      case when v_target=0 then 0 else v_surcharge*weight%v_target end remainder from entries
  ), surcharge_ranked as (
    select *,row_number() over(order by remainder desc,id) rn,sum(part) over() parts from surcharge_floor
  ), gross_lines as (
    select *,part+case when rn<=v_surcharge-parts then 1 else 0 end surcharge,
      weight+part+case when rn<=v_surcharge-parts then 1 else 0 end gross from surcharge_ranked
  ), fee_floor as (
    select *,case when v_gross=0 then 0 else v_predicted*gross/v_gross end fee_part,
      case when v_gross=0 then 0 else v_predicted*gross%v_gross end fee_remainder from gross_lines
  ), fee_ranked as (
    select *,row_number() over(order by fee_remainder desc,id) fee_rn,sum(fee_part) over() fee_parts from fee_floor
  ), final as (
    select *,fee_part+case when fee_rn<=v_predicted-fee_parts then 1 else 0 end processor from fee_ranked
  ) insert into public.booking_payment_quote_lines(attempt_id,org_id,registration_id,base_cents,platform_fee_cents,
    processor_surcharge_cents,gross_cents,processor_fee_predicted_cents,net_to_org_predicted_cents)
    select v_attempt.id,v_order.org_id,id,base,fee,surcharge,gross,processor,gross-fee-processor from final;
  return public.booking_payment_preparation_result(v_attempt.id);
end $$;

create or replace function public.booking_payment_claim_dispatch(p_actor uuid,p_attempt uuid,p_request jsonb,p_livemode boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.booking_payment_attempts%rowtype; o public.booking_orders%rowtype; d public.booking_payment_dispatches%rowtype;
begin
  perform 1 from auth.users where id=p_actor and email_confirmed_at is not null and not coalesce(is_anonymous,false) for share;
  if not found then raise exception 'booking_email_unverified' using errcode='42501'; end if;
  select * into a from public.booking_payment_attempts where id=p_attempt and booked_by_user_id=p_actor;
  if not found then raise exception 'attempt_not_found' using errcode='42501'; end if;
  select * into o from public.booking_orders where id=a.booking_order_id for update;
  select * into a from public.booking_payment_attempts where id=p_attempt for update;
  if o.status<>'pending' or o.expires_at<=statement_timestamp() or o.expires_at is null
  then raise exception 'order_not_payable' using errcode='22023'; end if;
  if a.gross_cents=0 then raise exception 'free_order_requires_confirmation' using errcode='22023'; end if;
  perform 1 from public.organizations where id=o.org_id and is_active for share;
  if not found then raise exception 'org_suspended' using errcode='22023'; end if;
  perform 1 from public.events where id=o.event_id and status in ('open','almost_full') for share;
  if not found then raise exception 'registration_closed' using errcode='22023'; end if;
  perform 1 from public.registrations where booking_order_id=o.id order by id for share;
  if (select count(*) from public.registrations where booking_order_id=o.id) <>
      (select count(*) from public.booking_payment_quote_lines where attempt_id=a.id)
    or exists(select 1 from public.booking_payment_quote_lines q left join public.registrations r on r.id=q.registration_id
      where q.attempt_id=a.id and (r.id is null or r.status<>'pending' or r.expires_at is null or r.expires_at<=statement_timestamp()
      or r.total_amount<>q.base_cents or r.booking_order_id<>o.id))
  then raise exception 'order_entries_changed' using errcode='22023'; end if;
  select * into d from public.booking_payment_dispatches where attempt_id=a.id;
  if found then
    if d.request_body is distinct from p_request or d.livemode is distinct from p_livemode
    then raise exception 'dispatch_request_changed' using errcode='22023'; end if;
    return jsonb_build_object('action',case when d.state='ready' then 'ready' else 'pending' end,'checkout_url',d.checkout_url);
  end if;
  if a.status<>'prepared' then raise exception 'attempt_not_prepared' using errcode='22023'; end if;
  if p_request#>>'{data,attributes,metadata,booking_order_id}' is distinct from o.id::text
    or p_request#>>'{data,attributes,metadata,payment_attempt_id}' is distinct from a.id::text
    or p_request#>'{data,attributes,payment_method_types}' is distinct from jsonb_build_array(a.method)
    or coalesce((p_request#>>'{data,attributes,pass_on_fees}')::boolean,false) is distinct from
      coalesce((a.terms_snapshot->>'provider_managed_fee')::boolean,false)
    or (select sum((x->>'amount')::bigint*(x->>'quantity')::bigint) from jsonb_array_elements(p_request#>'{data,attributes,line_items}') x) is distinct from a.gross_cents::numeric
    or exists(select 1 from jsonb_array_elements(p_request#>'{data,attributes,line_items}') x
      where x->>'currency' is distinct from 'PHP' or (x->>'amount')::bigint<0 or (x->>'quantity')::integer<>1)
  then raise exception 'invalid_provider_request' using errcode='22023'; end if;
  insert into public.booking_payment_dispatches(attempt_id,org_id,request_body,livemode) values(a.id,a.org_id,p_request,p_livemode);
  update public.booking_payment_attempts set status='creating' where id=a.id;
  return jsonb_build_object('action','dispatch');
end $$;

create or replace function public.booking_payment_confirm(p_attempt uuid,p_capture jsonb,p_tokens jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare a public.booking_payment_attempts%rowtype; o public.booking_orders%rowtype; d public.booking_payment_dispatches%rowtype;
  c public.booking_payment_captures%rowtype; v_limit integer; v_n integer; v_reason text; v_fee integer;
  v_provider_managed boolean;
begin
  select * into a from public.booking_payment_attempts where id=p_attempt;
  if not found then raise exception 'attempt_not_found' using errcode='22023'; end if;
  select * into o from public.booking_orders where id=a.booking_order_id;
  -- Capacity lock is shared with legacy inserts. No provider I/O inside this boundary.
  select slots_total into v_limit from public.categories where id=o.category_id for update;
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
    or (v_provider_managed and (p_capture->>'amount')::bigint-(p_capture->>'feeCents')::bigint is distinct from a.gross_cents::bigint)
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
  if v_reason is null and (select count(*) from public.registrations r where r.category_id=o.category_id
    and r.booking_order_id is distinct from o.id and (r.status='paid' or (r.status='pending' and (r.expires_at is null or r.expires_at>statement_timestamp()))))+v_n>v_limit
  then v_reason:='capacity_unavailable'; end if;
  if v_reason is null and (jsonb_typeof(p_tokens) is distinct from 'object' or
    exists(select 1 from public.booking_payment_quote_lines where attempt_id=a.id and coalesce(length(p_tokens->>registration_id::text),0)<20))
  then raise exception 'ticket_tokens_required' using errcode='22023'; end if;
  v_fee:=(p_capture->>'feeCents')::integer;
  if v_reason is null and (v_fee is null or v_fee<0 or v_fee>(p_capture->>'amount')::bigint)
  then v_reason:='invalid_processor_fee'; end if;
  if v_reason is null then
    begin
      update public.registrations set status='paid',expires_at=null,ticket_token=p_tokens->>id::text where booking_order_id=o.id;
      update public.categories set slots_taken=slots_taken+v_n where id=o.category_id;
      with parts as (
        select q.*,case when v_fee is null then null when a.gross_cents=0 then 0 else v_fee::bigint*q.gross_cents/a.gross_cents end part,
          case when v_fee is null or a.gross_cents=0 then 0 else v_fee::bigint*q.gross_cents%a.gross_cents end rem
        from public.booking_payment_quote_lines q where attempt_id=a.id
      ), ranked as (select *,row_number() over(order by rem desc,registration_id) rn,sum(part) over() parts from parts),
      allocated as (select *,part+case when rn<=v_fee-parts then 1 else 0 end fee from ranked)
      insert into public.booking_payment_allocations(capture_id,org_id,registration_id,gross_cents,platform_fee_cents,processor_fee_cents,net_to_org_cents)
        select c.id,o.org_id,registration_id,gross_cents+case when v_provider_managed then fee else 0 end,
          platform_fee_cents,fee,gross_cents::bigint+case when v_provider_managed then fee else 0 end-platform_fee_cents-fee
        from allocated;
      update public.booking_orders set status='paid',expires_at=null where id=o.id;
      update public.booking_payment_attempts set status='paid' where id=a.id;
      update public.booking_payment_captures set state='fulfilled' where id=c.id;
      insert into public.booking_order_deliveries(booking_order_id,org_id) values(o.id,o.org_id);
      return 'fulfilled';
    exception when unique_violation or check_violation then
      -- Keep the external capture, but roll back ALL tickets/allocations/slots.
      v_reason:='fulfillment_conflict';
    end;
  end if;
  update public.booking_payment_captures set state='reconciliation_required',reason=v_reason where id=c.id;
  if o.status<>'paid' then
    update public.booking_orders set status='reconciliation_required' where id=o.id;
    update public.booking_payment_attempts set status='reconciliation_required' where id=a.id;
  end if;
  return 'reconciliation_required';
end $$;

