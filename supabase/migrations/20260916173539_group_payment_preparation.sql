-- Quote preparation only. No provider dispatch or paid-registration mutation.
create table public.booking_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  booking_order_id uuid not null references public.booking_orders(id),
  booked_by_user_id uuid not null references auth.users(id),
  idempotency_key uuid not null,
  provider text not null default 'paymongo' check(provider='paymongo'),
  method text not null check(method in ('card','gcash','paymaya')),
  currency text not null default 'PHP' check(currency='PHP'),
  status text not null default 'prepared' check(status in
    ('prepared','creating','ready','creation_unknown','failed','paid','reconciliation_required','expired')),
  terms_snapshot jsonb not null,
  base_cents integer not null check(base_cents>=0),
  platform_fee_cents integer not null check(platform_fee_cents>=0),
  processor_surcharge_cents integer not null check(processor_surcharge_cents>=0),
  gross_cents integer not null check(gross_cents>=0),
  processor_fee_predicted_cents integer not null check(processor_fee_predicted_cents>=0),
  net_to_org_predicted_cents integer not null,
  created_at timestamptz not null default now(),
  unique(booked_by_user_id,idempotency_key),
  unique(id,org_id),
  check(net_to_org_predicted_cents=gross_cents::bigint-platform_fee_cents-processor_fee_predicted_cents)
);
-- Unknown outcomes remain live. Only proven terminal failed/expired attempts
-- may be replaced; local hold expiry alone is not proof of provider expiration.
create unique index booking_payment_attempts_one_live on public.booking_payment_attempts(booking_order_id)
  where status not in ('failed','expired');
create table public.booking_payment_quote_lines (
  attempt_id uuid not null,
  org_id uuid not null,
  registration_id uuid not null references public.registrations(id),
  base_cents integer not null check(base_cents>=0),
  platform_fee_cents integer not null check(platform_fee_cents>=0),
  processor_surcharge_cents integer not null check(processor_surcharge_cents>=0),
  gross_cents integer not null check(gross_cents>=0),
  processor_fee_predicted_cents integer not null check(processor_fee_predicted_cents>=0),
  net_to_org_predicted_cents integer not null,
  primary key(attempt_id,registration_id),
  foreign key(attempt_id,org_id) references public.booking_payment_attempts(id,org_id) on delete cascade,
  check(net_to_org_predicted_cents=gross_cents::bigint-platform_fee_cents-processor_fee_predicted_cents)
);
create index booking_payment_quote_lines_registration on public.booking_payment_quote_lines(registration_id);
alter table public.booking_payment_attempts enable row level security;
alter table public.booking_payment_quote_lines enable row level security;
revoke all on public.booking_payment_attempts,public.booking_payment_quote_lines from public,anon,authenticated;
grant all on public.booking_payment_attempts,public.booking_payment_quote_lines to service_role;
grant select on public.booking_payment_attempts,public.booking_payment_quote_lines to authenticated;
create policy booking_payment_attempts_read on public.booking_payment_attempts for select to authenticated
 using(booked_by_user_id=(select auth.uid()) or public.auth_can_admin_org(org_id));
create policy booking_payment_quote_lines_read on public.booking_payment_quote_lines for select to authenticated
 using(public.auth_can_admin_org(org_id) or exists(select 1 from public.booking_payment_attempts a
   where a.id=attempt_id and a.booked_by_user_id=(select auth.uid())) or exists(
   select 1 from public.registrations r where r.id=registration_id and r.user_id=(select auth.uid())));

create function public.booking_payment_attempt_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if TG_OP='UPDATE' and (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status')
  then raise exception 'payment_terms_immutable' using errcode='23514'; end if;
  if not exists(select 1 from public.booking_orders o where o.id=new.booking_order_id
    and o.org_id=new.org_id and o.booked_by_user_id=new.booked_by_user_id)
  then raise exception 'payment_order_scope_mismatch' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function public.booking_payment_attempt_guard() from public,anon,authenticated;
grant execute on function public.booking_payment_attempt_guard() to service_role;
create trigger booking_payment_attempt_guard before insert or update on public.booking_payment_attempts
 for each row execute function public.booking_payment_attempt_guard();
create function public.booking_payment_quote_line_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if TG_OP='UPDATE' and new is distinct from old
  then raise exception 'payment_terms_immutable' using errcode='23514'; end if;
  if not exists(select 1 from public.registrations r join public.booking_payment_attempts a
    on a.booking_order_id=r.booking_order_id where a.id=new.attempt_id and r.id=new.registration_id
      and r.org_id=new.org_id and a.org_id=new.org_id and r.total_amount=new.base_cents)
  then raise exception 'payment_line_scope_mismatch' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function public.booking_payment_quote_line_guard() from public,anon,authenticated;
grant execute on function public.booking_payment_quote_line_guard() to service_role;
create trigger booking_payment_quote_line_guard before insert or update on public.booking_payment_quote_lines
 for each row execute function public.booking_payment_quote_line_guard();

create function public.booking_payment_preparation_result(p_attempt uuid) returns jsonb
language sql set search_path='' as $$
  select to_jsonb(a) || jsonb_build_object('lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.registration_id)
    from public.booking_payment_quote_lines l where l.attempt_id=a.id),'[]'::jsonb))
    from public.booking_payment_attempts a where a.id=p_attempt;
$$;
revoke all on function public.booking_payment_preparation_result(uuid) from public,anon,authenticated;
grant execute on function public.booking_payment_preparation_result(uuid) to service_role;

-- Verified actor comes from the edge, not JSON input. SECURITY DEFINER permits
-- the auth.users recheck; the routine itself is not executable by clients.
create function public.booking_order_prepare_payment(p_actor uuid,p_order uuid,p_method text,p_key uuid)
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
  if v_base>0 then
    select * into v_rate from public.processor_rates where provider='paymongo' and method=v_method and scope='local'
      and effective_from<=statement_timestamp() and (effective_to is null or effective_to>statement_timestamp())
      order by effective_from desc,id limit 1 for share;
    if not found then raise exception 'rate_card_missing' using errcode='22023'; end if;
    if v_rate.percent_bps>=10000 then raise exception 'invalid_processor_rate' using errcode='22023'; end if;
  end if;
  v_target := v_base+case when v_org.fee_mode='pass_on' then v_commission else 0 end;
  v_gross := case when v_base=0 then 0 when v_org.fee_mode='absorb' then v_base
    else ((v_target+v_rate.fixed_cents)*10000+9999-v_rate.percent_bps)/(10000-v_rate.percent_bps) end;
  v_surcharge := case when v_org.fee_mode='pass_on' then v_gross-v_target else 0 end;
  v_predicted := case when v_gross=0 then 0 else (v_gross*v_rate.percent_bps+5000)/10000+v_rate.fixed_cents end;
  if greatest(v_base,v_commission,v_gross,v_surcharge,v_predicted)>2147483647
  then raise exception 'order_amount_too_large' using errcode='22023'; end if;
  v_terms := jsonb_build_object('fee_mode',v_org.fee_mode,'commission_type',v_org.commission_type,
    'commission_bps',round(coalesce(v_org.commission_rate,0.10)*10000),'commission_flat_cents',v_org.commission_flat_cents,
    'rate_id',v_rate.id,'percent_bps',coalesce(v_rate.percent_bps,0),'fixed_cents',coalesce(v_rate.fixed_cents,0));
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
