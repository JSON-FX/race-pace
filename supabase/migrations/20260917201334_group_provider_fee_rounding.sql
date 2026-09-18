-- Local-only revision before hosted deployment. PayMongo may round a passed-on fee up by one centavo. Allocate that
-- actual excess to one stable participant and retain exact capture totals.
create or replace function public.booking_payment_confirm(p_attempt uuid,p_capture jsonb,p_tokens jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare a public.booking_payment_attempts%rowtype; o public.booking_orders%rowtype; d public.booking_payment_dispatches%rowtype;
  c public.booking_payment_captures%rowtype; v_limit integer; v_n integer; v_reason text; v_fee integer;
  v_provider_managed boolean; v_excess integer := 0;
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
    or (v_provider_managed and ((p_capture->>'amount')::bigint-(p_capture->>'feeCents')::bigint
      < a.gross_cents::bigint or (p_capture->>'amount')::bigint-(p_capture->>'feeCents')::bigint > a.gross_cents::bigint+1))
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
  if v_reason is null and v_provider_managed then
    v_excess:=(p_capture->>'amount')::integer-v_fee-a.gross_cents;
  end if;
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
