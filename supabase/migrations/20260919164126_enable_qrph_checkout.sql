-- Local-only revision before hosted deployment.
-- QR Ph now ships in the server-owned PayMongo Hosted Checkout allowlist.
-- Keep the organizer forecast vocabulary aligned with that product fact. The
-- authoritative ledger still records PayMongo's captured fee; this row is only
-- the published estimate used by forecasts and fallback display calculations.
update public.processor_rates
   set offered = true
 where provider = 'paymongo'
   and method = 'qrph'
   and effective_to is null;

-- Group checkout persists the provider method, so both its table constraint and
-- security-definer procedure must accept exactly the same server-owned set.
alter table public.booking_payment_attempts
  drop constraint booking_payment_attempts_method_check,
  add constraint booking_payment_attempts_method_check
    check (method in ('card','gcash','paymaya','qrph'));

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
end $$;

revoke all on function public.booking_order_prepare_payment(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.booking_order_prepare_payment(uuid,uuid,text,uuid) to service_role;
