-- Local-only until hosted acceptance. Keep all admissions and money mutations
-- on the same event-first lock order. Existing financial bodies are preserved.

CREATE OR REPLACE FUNCTION public.booking_order_prepare_payment(p_actor uuid, p_order uuid, p_method text, p_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.booking_orders%rowtype; v_org public.organizations%rowtype;
  v_attempt public.booking_payment_attempts%rowtype; v_rate public.processor_rates%rowtype;
  v_method text := case when p_method='maya' then 'paymaya' else p_method end;
  v_lines jsonb; v_count bigint; v_base bigint; v_commission bigint;
  v_target bigint; v_gross bigint; v_surcharge bigint; v_predicted bigint;
  v_terms jsonb;
begin
  perform 1 from public.events where id=(select event_id from public.booking_orders where id=p_order) for update;
  if p_key is null or p_order is null or v_method is null or v_method not in ('card','gcash','paymaya','qrph')
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
end $function$;

revoke all on function public.booking_order_prepare_payment(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.booking_order_prepare_payment(uuid,uuid,text,uuid) to service_role;

CREATE OR REPLACE FUNCTION public.booking_order_cancel(p_actor uuid, p_order uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.booking_orders%rowtype;
begin
  perform 1 from public.events where id=(select event_id from public.booking_orders where id=p_order) for update;
  if p_actor is null or p_order is null then
    raise exception 'invalid_input' using errcode='22023';
  end if;

  perform 1 from auth.users
    where id=p_actor and email_confirmed_at is not null and not coalesce(is_anonymous,false)
    for share;
  if not found then raise exception 'booking_email_unverified' using errcode='42501'; end if;

  select * into v_order from public.booking_orders
    where id=p_order and booked_by_user_id=p_actor for update;
  if not found then raise exception 'order_not_found' using errcode='42501'; end if;
  if v_order.status='cancelled' then
    return jsonb_build_object('order_id',v_order.id,'status','cancelled');
  end if;
  if v_order.status<>'pending' then
    raise exception 'order_not_cancellable' using errcode='22023';
  end if;

  perform 1 from public.booking_payment_attempts
    where booking_order_id=p_order order by id for update;
  if exists(
    select 1 from public.booking_payment_attempts a
    left join public.booking_payment_dispatches d on d.attempt_id=a.id
    left join public.booking_payment_captures c on c.attempt_id=a.id
    where a.booking_order_id=p_order
      and (a.status not in ('prepared','failed','expired') or d.attempt_id is not null or c.id is not null)
  ) then
    raise exception 'payment_already_started' using errcode='22023';
  end if;

  perform 1 from public.registrations
    where booking_order_id=p_order order by id for update;
  if exists(select 1 from public.registrations
    where booking_order_id=p_order and status not in ('pending','expired'))
  then raise exception 'order_entries_changed' using errcode='22023'; end if;

  update public.booking_payment_attempts set status='expired'
    where booking_order_id=p_order and status='prepared';
  update public.registrations set status='cancelled',expires_at=null
    where booking_order_id=p_order and status in ('pending','expired');
  update public.booking_orders set status='cancelled',expires_at=null where id=p_order;

  return jsonb_build_object('order_id',p_order,'status','cancelled');
end $function$;

revoke all on function public.booking_order_cancel(uuid,uuid) from public,anon,authenticated;
grant execute on function public.booking_order_cancel(uuid,uuid) to service_role;

CREATE OR REPLACE FUNCTION public.booking_payment_claim_dispatch(p_actor uuid, p_attempt uuid, p_request jsonb, p_livemode boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.booking_payment_attempts%rowtype; o public.booking_orders%rowtype; d public.booking_payment_dispatches%rowtype;
begin
  perform 1 from public.events where id=(select lock_order.event_id from public.booking_orders lock_order join public.booking_payment_attempts lock_attempt on lock_attempt.booking_order_id=lock_order.id where lock_attempt.id=p_attempt) for update;
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
end $function$;

revoke all on function public.booking_payment_claim_dispatch(uuid,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.booking_payment_claim_dispatch(uuid,uuid,jsonb,boolean) to service_role;

CREATE OR REPLACE FUNCTION public.booking_payment_confirm(p_attempt uuid, p_capture jsonb, p_tokens jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.booking_payment_attempts%rowtype; o public.booking_orders%rowtype; d public.booking_payment_dispatches%rowtype;
  c public.booking_payment_captures%rowtype; v_n integer; v_reason text; v_fee integer;
  v_provider_managed boolean; v_excess integer:=0; v_reserved_paid_at timestamptz;
begin
  perform 1 from public.events where id=(select lock_order.event_id from public.booking_orders lock_order join public.booking_payment_attempts lock_attempt on lock_attempt.booking_order_id=lock_order.id where lock_attempt.id=p_attempt) for update;
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
  -- Group fulfillment must use the provider's capture time for every held
  -- Passport place. Without a verified paidAt, reconcile instead of issuing
  -- tickets after a reservation deadline.
  if v_reason is null and exists (
    select 1 from public.registrations r where r.booking_order_id=o.id
      and r.event_reservation_id is not null
  ) then
    if coalesce(p_capture->>'paidAt','') !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      v_reason:='reservation_capture_time_missing';
    else
      begin
        v_reserved_paid_at:=(p_capture->>'paidAt')::timestamptz;
      exception when invalid_datetime_format or datetime_field_overflow then
        v_reason:='invalid_capture_time';
      end;
    end if;
    if v_reason is null and exists (
      select 1 from public.registrations r
        left join public.event_reservations er on er.id=r.event_reservation_id
        where r.booking_order_id=o.id and r.event_reservation_id is not null
          and (er.id is null or er.status<>'paid' or er.user_id<>o.booked_by_user_id
            or v_reserved_paid_at>coalesce((select greatest(p.entry_payment_deadline_at,cat.entry_payment_deadline_at)
              from public.event_reservation_places p join public.categories cat on cat.id=p.category_id
              where p.reservation_id=er.id and p.participant_passport_id=r.participant_passport_id),er.registration_deadline_at)
            or (exists (select 1 from public.event_reservation_places p
                  where p.reservation_id=er.id)
              and not exists (select 1 from public.event_reservation_places p
                where p.reservation_id=er.id and p.participant_passport_id=r.participant_passport_id
                  and p.status='held')))
    ) then v_reason:='reservation_deadline_passed'; end if;
  end if;
  -- A provider callback can arrive later than its capture. Require an actual
  -- capture time within the original window and a hold that was never released.
  if v_reason is null and o.reservation_request->>'prescreening_batch_id' is not null then
    begin
      v_reserved_paid_at:=(p_capture->>'paidAt')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      v_reserved_paid_at:=null;
    end;
    if v_reserved_paid_at is null or not exists(select 1 from public.prescreening_batches b
      where b.id=(o.reservation_request->>'prescreening_batch_id')::uuid and b.booking_order_id=o.id
      and b.status='ready' and b.checkout_intent='entry' and v_reserved_paid_at<=b.payment_deadline_at
      and not exists(select 1 from public.prescreening_applications a where a.batch_id=b.id
        and a.decision<>'rejected' and (a.released_at is not null or a.decision not in ('approved','not_required')))) then
      v_reason:='prescreening_payment_window_ended';
    end if;
  end if;
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
end $function$;

revoke all on function public.booking_payment_confirm(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.booking_payment_confirm(uuid,jsonb,jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.confirm_payment_tx(p_registration_id uuid, p_method text, p_fee integer, p_net integer, p_token text, p_raw jsonb, p_processor_fee integer DEFAULT 0, p_processor_fee_predicted integer DEFAULT NULL::integer, p_processor_fee_source text DEFAULT 'none'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_status public.registration_status;
  v_category uuid;
  v_org uuid;
  v_event uuid;
  v_participant uuid;
  v_amount int;
  v_live integer;
  v_constraint text;
begin
  perform 1 from public.events where id=(select event_id from public.registrations where id=p_registration_id) for update;
  select status, category_id, org_id, event_id, participant_passport_id, total_amount
    into v_status, v_category, v_org, v_event, v_participant, v_amount
    from public.registrations where id = p_registration_id for update;
  if not found then return 'not_found'; end if;
  if v_status = 'paid' then return 'already'; end if;

  if v_status = 'expired' then
    select count(*) into v_live
      from public.registrations
     where event_id = v_event
       and participant_passport_id = v_participant
       and id <> p_registration_id
       and status in ('pending', 'paid');
    if v_live > 0 then
      return 'conflict';
    end if;
  elsif v_status <> 'pending' then
    return 'not_pending';  -- refunded/cancelled: never re-confirm (replay-safe)
  end if;

  begin
    update public.payments
       set status = 'paid', paid_at = coalesce(paid_at, now()), method = p_method, platform_fee = p_fee,
           net_to_org = p_net, raw = p_raw,
           processor_fee_cents           = coalesce(p_processor_fee, 0),
           processor_fee_predicted_cents = p_processor_fee_predicted,
           processor_fee_source          = coalesce(p_processor_fee_source, 'none')
     where registration_id = p_registration_id returning amount into v_amount;

    update public.registrations
       set status = 'paid', ticket_token = p_token, expires_at = null
     where id = p_registration_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'registrations_one_live_per_event' then
      return 'conflict';
    end if;
    raise;  -- some other constraint: a real bug, must not be swallowed
  end;

  update public.categories set slots_taken = slots_taken + 1 where id = v_category;

  insert into public.registration_audit
    (registration_id, org_id, event_id, action, detail, actor_role)
  values (p_registration_id, v_org, v_event, 'paid',
          jsonb_build_object('method', p_method, 'amount', v_amount, 'amount_basis', 'captured_gross'), 'system');

  return 'paid';
end;
$function$;

revoke all on function public.confirm_payment_tx(uuid,text,integer,integer,text,jsonb,integer,integer,text) from public,anon,authenticated;
grant execute on function public.confirm_payment_tx(uuid,text,integer,integer,text,jsonb,integer,integer,text) to service_role;

CREATE OR REPLACE FUNCTION public.confirm_reserved_registration_tx(p_registration_id uuid, p_method text, p_fee integer, p_net integer, p_token text, p_raw jsonb, p_processor_fee integer, p_processor_fee_predicted integer, p_processor_fee_source text, p_provider_paid_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_res public.event_reservations%rowtype; v_reg public.registrations%rowtype;
begin
  perform 1 from public.events where id=(select event_id from public.registrations where id=p_registration_id) for update;
  select * into v_reg from public.registrations where id=p_registration_id for update;
  if not found then return 'not_found'; end if;
  if v_reg.status='paid' then return 'already'; end if;
  select * into v_res from public.event_reservations where id=v_reg.event_reservation_id for update;
  if not found or v_res.status<>'paid' or v_res.user_id<>v_reg.booked_by_user_id
    or p_provider_paid_at is null or p_provider_paid_at>coalesce((select greatest(p.entry_payment_deadline_at,c.entry_payment_deadline_at)
      from public.event_reservation_places p join public.categories c on c.id=p.category_id
      where p.reservation_id=v_res.id and p.participant_passport_id=v_reg.participant_passport_id
      and p.category_id=v_reg.category_id),v_res.registration_deadline_at) then
    return 'reservation_deadline_passed'; end if;
  if exists (select 1 from public.event_reservation_places where reservation_id=v_res.id)
    and not exists (select 1 from public.event_reservation_places
      where reservation_id=v_res.id and participant_passport_id=v_reg.participant_passport_id
        and status='held') then return 'reservation_deadline_passed'; end if;
  return public.confirm_payment_tx(p_registration_id,p_method,p_fee,p_net,p_token,p_raw,
    p_processor_fee,p_processor_fee_predicted,p_processor_fee_source);
end $function$;

revoke all on function public.confirm_reserved_registration_tx(uuid,text,integer,integer,text,jsonb,integer,integer,text,timestamp with time zone) from public,anon,authenticated;
grant execute on function public.confirm_reserved_registration_tx(uuid,text,integer,integer,text,jsonb,integer,integer,text,timestamp with time zone) to service_role;

CREATE OR REPLACE FUNCTION public.finish_paymongo_checkout_expiry(p_registration_id uuid, p_session_id text, p_provider_evidence jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.registrations%rowtype; p public.payments%rowtype;
begin
  perform 1 from public.events where id=(select event_id from public.registrations where id=p_registration_id) for update;
  if p_session_id is null or p_session_id !~ '^cs_[A-Za-z0-9_-]+$' then return 'invalid_session'; end if;
  perform pg_advisory_xact_lock(hashtextextended('single_capture:'||p_registration_id::text,0));
  select * into r from public.registrations where id=p_registration_id for update;
  select * into p from public.payments where registration_id=p_registration_id for update;
  if r.id is null or p.id is null or p.provider<>'paymongo' or
     p.provider_ref is distinct from p_session_id then return 'mismatch'; end if;
  if r.status<>'pending' or p.status<>'pending' then return 'already_final'; end if;
  if exists(select 1 from public.single_payment_captures where registration_id=p_registration_id)
    then return 'capture_pending'; end if;
  update public.registrations set status='expired',expires_at=null where id=p_registration_id;
  update public.payments set status='failed' where id=p.id;
  perform public.record_paymongo_expiry_attempt(
    p_registration_id,p_session_id,'expired',p_provider_evidence
  );
  return 'expired';
end $function$;

revoke all on function public.finish_paymongo_checkout_expiry(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.finish_paymongo_checkout_expiry(uuid,text,jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.refund_registration_tx(p_registration_id uuid, p_refunded_by uuid, p_note text, p_provider_refund jsonb, p_refunded_amount integer DEFAULT NULL::integer, p_retained_net integer DEFAULT 0)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_status   public.registration_status;
  v_category uuid;
  v_org      uuid;
  v_event    uuid;
  v_raw      jsonb;
  v_net      int;
  v_partial  boolean;
begin
  perform 1 from public.events where id=(select event_id from public.registrations where id=p_registration_id) for update;
  select r.status, r.category_id, r.org_id, r.event_id
    into v_status, v_category, v_org, v_event
    from public.registrations r where r.id = p_registration_id for update;
  if not found then return 'not_found'; end if;
  if v_status = 'refunded' then return 'already'; end if;
  if v_status <> 'paid' then return 'not_paid'; end if;

  -- net_to_org, NOT amount: `amount` includes Race Pace's earned commission and
  -- PayMongo's non-returnable fee, and in pass_on mode is the grossed-up total
  -- the runner paid. Neither is ours to hand back.
  select p.net_to_org, p.raw into v_net, v_raw
    from public.payments p where p.registration_id = p_registration_id;

  -- Nothing can refund more than the organizer received. A caller still
  -- computing from `amount` overdraws here rather than silently paying the
  -- runner out of the commission.
  if p_refunded_amount is not null and p_refunded_amount > v_net then
    raise exception 'refund_exceeds_net_to_org: % > %', p_refunded_amount, v_net
      using errcode = '22003';
  end if;

  -- p_refunded_amount null means "refund everything", which now means the whole
  -- of net_to_org — see the provenance note above. It therefore cancels the
  -- entry and frees the slot, so a caller that ALSO names a retention is
  -- self-contradictory: taking the full branch would silently discard the
  -- retention both parties agreed to. The likeliest such caller is
  -- payments-webhook settling a flat-fee refund parked before this migration, so
  -- this must raise rather than resolve one way or the other.
  if p_refunded_amount is null and coalesce(p_retained_net, 0) > 0 then
    raise exception 'refund_retention_without_amount: retained % with no refunded amount', p_retained_net
      using errcode = '22003';
  end if;

  v_partial := p_refunded_amount is not null and p_refunded_amount < v_net;

  -- THE SPLIT MUST BALANCE. `net_to_org` is written from p_retained_net
  -- unvalidated, and the identity below is exactly what this function's own
  -- guarantee — and payout_open_statement's `Σ net_to_org` — rests on:
  --
  --   refunded_amount + net_to_org + platform_fee + processor_fee_cents = amount
  --
  -- which reduces to `p_refunded_amount + p_retained_net = v_net` because the
  -- other two terms are immutable here. Without this check a caller carrying a
  -- pre-2026-08-11 split (refund struck off `amount`, retention off a re-struck
  -- commission) passes the over-refund guard, writes a row that is short or long
  -- by the difference, and is paid out on that figure with nothing to flag it.
  -- Raising makes that corruption structurally impossible rather than a runbook
  -- item.
  if v_partial and p_refunded_amount + coalesce(p_retained_net, 0) <> v_net then
    raise exception 'refund_split_mismatch: % + % <> %', p_refunded_amount, p_retained_net, v_net
      using errcode = '22003';
  end if;

  if v_partial then
    -- The entry SURVIVES: the runner keeps their place, so the registration
    -- stays 'paid' and the slot stays taken.
    --
    -- `amount` is NOT rewritten. The old version overwrote it with the retained
    -- figure and stashed the original in raw.original_amount, which under the
    -- three-party ledger would permanently break
    -- `amount - processor_fee_cents = the provider's net_amount`.
    -- platform_fee is untouched for the same reason: it was earned at capture.
    -- Only net_to_org moves, down to what the organizer kept.
    update public.payments
       set status          = 'partially_refunded',
           refunded_amount = p_refunded_amount,
           net_to_org      = p_retained_net,
           raw = coalesce(v_raw, '{}'::jsonb) || jsonb_build_object(
                   'refunded_at', now(),
                   'refunded_by', p_refunded_by,
                   'note', p_note,
                   'partial', true,
                   'provider_refund', p_provider_refund)
     where registration_id = p_registration_id;

    insert into public.registration_audit
      (registration_id, org_id, event_id, action, detail, actor_id, actor_role)
    values (p_registration_id, v_org, v_event, 'partially_refunded',
            jsonb_build_object('amount', p_refunded_amount, 'note', p_note), p_refunded_by, 'admin');

    return 'partially_refunded';
  end if;

  update public.registrations set status = 'refunded' where id = p_registration_id;

  -- A fully refunded row KEEPS its amount/platform_fee/processor_fee_cents/
  -- net_to_org. That is deliberate and load-bearing: payout_open_statement reads
  -- net_to_org off refunded rows to size a clawback. See
  -- 20260807090300_payout_statements.sql.
  update public.payments
     set status = 'refunded',
         refunded_amount = v_net,
         raw = coalesce(v_raw, '{}'::jsonb) || jsonb_build_object(
                 'refunded_at', now(),
                 'refunded_by', p_refunded_by,
                 'note', p_note,
                 'provider_refund', p_provider_refund)
   where registration_id = p_registration_id;

  update public.categories set slots_taken = greatest(slots_taken - 1, 0) where id = v_category;

  insert into public.registration_audit
    (registration_id, org_id, event_id, action, detail, actor_id, actor_role)
  values (p_registration_id, v_org, v_event, 'refunded',
          jsonb_build_object('amount', v_net, 'note', p_note), p_refunded_by, 'admin');

  return 'refunded';
end;
$function$;

revoke all on function public.refund_registration_tx(uuid,uuid,text,jsonb,integer,integer) from public,anon,authenticated;
grant execute on function public.refund_registration_tx(uuid,uuid,text,jsonb,integer,integer) to service_role;

CREATE OR REPLACE FUNCTION public.admin_cancel_registration(p_registration_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org_id uuid;
  v_status public.registration_status;
  v_payment_status public.payment_status;
begin
  perform 1 from public.events where id=(select event_id from public.registrations where id=p_registration_id) for update;
  select r.org_id, r.status, p.status
    into v_org_id, v_status, v_payment_status
  from public.registrations r
  left join public.payments p on p.registration_id = r.id
  where r.id = p_registration_id
  for update of r;

  if not found then
    return 'not_found';
  end if;

  if not public.auth_can_admin_org(v_org_id) then
    return 'unauthorized';
  end if;

  if v_status = 'cancelled' then
    return 'already';
  end if;

  if v_status <> 'pending' then
    return 'not_cancellable';
  end if;

  -- Non-terminal: the checkout could still complete out from under us.
  if v_payment_status = 'pending' then
    return 'payment_in_flight';
  end if;

  -- Terminal, but money already moved (or moved and came back) — belongs to
  -- refund_registration_tx, not here. Not expected to coexist with
  -- registrations.status = 'pending' today, but rejected explicitly rather
  -- than assumed unreachable.
  if v_payment_status in ('paid', 'refunded') then
    return 'not_cancellable';
  end if;

  -- v_payment_status is null (no payments row at all) or 'failed' (checkout
  -- never captured money): safe. No slot to release — see header comment.
  update public.registrations set status = 'cancelled' where id = p_registration_id;

  return 'cancelled';
end;
$function$;

revoke all on function public.admin_cancel_registration(uuid) from public,anon;
grant execute on function public.admin_cancel_registration(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.booking_refund_claim(p_actor uuid, p_order uuid, p_registration_ids uuid[], p_key uuid, p_expected_amount integer, p_preview boolean, p_provider_scope text, p_livemode boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ begin
  perform 1 from public.events where id=(select event_id from public.booking_orders where id=p_order) for update;
 perform pg_advisory_xact_lock(76120260917);
 return public.booking_refund_claim_before_reporting(p_actor,p_order,p_registration_ids,p_key,p_expected_amount,p_preview,p_provider_scope,p_livemode);
end $function$;

revoke all on function public.booking_refund_claim(uuid,uuid,uuid[],uuid,integer,boolean,text,boolean) from public,anon,authenticated;
grant execute on function public.booking_refund_claim(uuid,uuid,uuid[],uuid,integer,boolean,text,boolean) to service_role;

create function public.registration_lock_event_first() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.events where id=new.event_id for update;
  return new;
end $$;
revoke all on function public.registration_lock_event_first() from public,anon,authenticated;
create trigger a0_registration_event_lock before insert on public.registrations
  for each row execute function public.registration_lock_event_first();

create function public.confirm_screened_registration_tx(
  p_registration_id uuid,p_method text,p_fee integer,p_net integer,p_token text,p_raw jsonb,
  p_processor_fee integer,p_processor_fee_predicted integer,p_processor_fee_source text,p_provider_paid_at timestamptz
) returns text language plpgsql security definer set search_path='' as $$
declare r public.registrations%rowtype; b public.prescreening_batches%rowtype;
begin
  perform 1 from public.events where id=(select event_id from public.registrations where id=p_registration_id) for update;
  select * into r from public.registrations where id=p_registration_id for update;
  if not found then return 'not_found'; end if;
  if r.status='paid' then return 'already'; end if;
  select pb.* into b from public.prescreening_batches pb join public.prescreening_applications a on a.batch_id=pb.id
    where a.id=r.prescreening_application_id and a.released_at is null and a.decision in ('approved','not_required')
    and a.category_id=r.category_id and a.participant_passport_id=r.participant_passport_id and a.booked_by_user_id=r.booked_by_user_id;
  if not found or b.status<>'ready' or b.checkout_intent<>'entry' or p_provider_paid_at is null or p_provider_paid_at>b.payment_deadline_at then
    return 'reservation_deadline_passed'; end if;
  return public.confirm_payment_tx(p_registration_id,p_method,p_fee,p_net,p_token,p_raw,p_processor_fee,p_processor_fee_predicted,p_processor_fee_source);
end $$;
revoke all on function public.confirm_screened_registration_tx(uuid,text,integer,integer,text,jsonb,integer,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.confirm_screened_registration_tx(uuid,text,integer,integer,text,jsonb,integer,integer,text,timestamptz) to service_role;
