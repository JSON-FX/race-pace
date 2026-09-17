-- Internal only. Public activation additionally requires refund/report/delivery workers.
create table public.booking_payment_dispatches (
  attempt_id uuid primary key references public.booking_payment_attempts(id),
  org_id uuid not null references public.organizations(id),
  request_body jsonb not null,
  livemode boolean not null,
  started_at timestamptz not null default statement_timestamp(),
  state text not null default 'creating' check(state in ('creating','ready','unknown')),
  session_id text unique,
  checkout_url text,
  check((session_id is null)=(checkout_url is null))
);
create table public.booking_payment_captures (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  booking_order_id uuid not null references public.booking_orders(id),
  attempt_id uuid not null references public.booking_payment_attempts(id),
  payment_id text not null unique,
  capture jsonb not null,
  state text not null default 'received' check(state in ('received','fulfilled','reconciliation_required')),
  reason text,
  created_at timestamptz not null default statement_timestamp()
);
create unique index booking_payment_captures_one_fulfillment on public.booking_payment_captures(booking_order_id) where state='fulfilled';
create table public.booking_payment_allocations (
  capture_id uuid not null references public.booking_payment_captures(id),
  org_id uuid not null references public.organizations(id),
  registration_id uuid not null references public.registrations(id),
  gross_cents integer not null check(gross_cents>=0),
  platform_fee_cents integer not null check(platform_fee_cents>=0),
  processor_fee_cents integer check(processor_fee_cents>=0),
  net_to_org_cents integer,
  primary key(capture_id,registration_id),
  check((processor_fee_cents is null)=(net_to_org_cents is null)),
  check(net_to_org_cents=gross_cents::bigint-platform_fee_cents-processor_fee_cents)
);
create table public.booking_order_deliveries (
  booking_order_id uuid primary key references public.booking_orders(id),
  org_id uuid not null references public.organizations(id),
  state text not null default 'pending' check(state in ('pending','sent')),
  created_at timestamptz not null default statement_timestamp()
);
-- These ledgers remain private until their reporting/refund consumers are integrated.
alter table public.booking_payment_dispatches enable row level security;
alter table public.booking_payment_captures enable row level security;
alter table public.booking_payment_allocations enable row level security;
alter table public.booking_order_deliveries enable row level security;
revoke all on public.booking_payment_dispatches,public.booking_payment_captures,public.booking_payment_allocations,public.booking_order_deliveries from public,anon,authenticated;
grant all on public.booking_payment_dispatches,public.booking_payment_captures,public.booking_payment_allocations,public.booking_order_deliveries to service_role;

create function public.booking_payment_claim_dispatch(p_actor uuid,p_attempt uuid,p_request jsonb,p_livemode boolean)
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
    or (select sum((x->>'amount')::bigint*(x->>'quantity')::bigint) from jsonb_array_elements(p_request#>'{data,attributes,line_items}') x) is distinct from a.gross_cents::numeric
    or exists(select 1 from jsonb_array_elements(p_request#>'{data,attributes,line_items}') x
      where x->>'currency' is distinct from 'PHP' or (x->>'amount')::bigint<0 or (x->>'quantity')::integer<>1)
  then raise exception 'invalid_provider_request' using errcode='22023'; end if;
  insert into public.booking_payment_dispatches(attempt_id,org_id,request_body,livemode) values(a.id,a.org_id,p_request,p_livemode);
  update public.booking_payment_attempts set status='creating' where id=a.id;
  return jsonb_build_object('action','dispatch');
end $$;
revoke all on function public.booking_payment_claim_dispatch(uuid,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.booking_payment_claim_dispatch(uuid,uuid,jsonb,boolean) to service_role;

create function public.booking_payment_bind_session(p_attempt uuid,p_session text,p_url text)
returns void language plpgsql set search_path='' as $$
declare d public.booking_payment_dispatches%rowtype;
begin
  select * into d from public.booking_payment_dispatches where attempt_id=p_attempt for update;
  if not found or p_session is null or p_session !~ '^cs_' or p_url is null or p_url !~ '^https://'
  then raise exception 'invalid_session' using errcode='22023'; end if;
  if d.session_id is not null and (d.session_id,d.checkout_url) is distinct from (p_session,p_url)
  then raise exception 'session_identity_conflict' using errcode='22023'; end if;
  update public.booking_payment_dispatches set state='ready',session_id=p_session,checkout_url=p_url where attempt_id=p_attempt;
  update public.booking_payment_attempts set status='ready' where id=p_attempt and status in ('creating','creation_unknown');
end $$;
revoke all on function public.booking_payment_bind_session(uuid,text,text) from public,anon,authenticated;
grant execute on function public.booking_payment_bind_session(uuid,text,text) to service_role;
create function public.booking_payment_dispatch_unknown(p_attempt uuid) returns void language plpgsql set search_path='' as $$
begin
  -- A response recorded by another path must not be downgraded by a timeout.
  update public.booking_payment_dispatches set state='unknown' where attempt_id=p_attempt and session_id is null;
  if found then update public.booking_payment_attempts set status='creation_unknown' where id=p_attempt and status='creating'; end if;
end $$;
revoke all on function public.booking_payment_dispatch_unknown(uuid) from public,anon,authenticated;
grant execute on function public.booking_payment_dispatch_unknown(uuid) to service_role;

create function public.booking_payment_confirm(p_attempt uuid,p_capture jsonb,p_tokens jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare a public.booking_payment_attempts%rowtype; o public.booking_orders%rowtype; d public.booking_payment_dispatches%rowtype;
  c public.booking_payment_captures%rowtype; v_limit integer; v_n integer; v_reason text; v_fee integer;
begin
  select * into a from public.booking_payment_attempts where id=p_attempt;
  if not found then raise exception 'attempt_not_found' using errcode='22023'; end if;
  select * into o from public.booking_orders where id=a.booking_order_id;
  -- Capacity lock is shared with legacy inserts. No provider I/O inside this boundary.
  select slots_total into v_limit from public.categories where id=o.category_id for update;
  select * into o from public.booking_orders where id=a.booking_order_id for update;
  select * into a from public.booking_payment_attempts where id=p_attempt for update;
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
    or (p_capture->>'amount')::bigint is distinct from a.gross_cents::bigint
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
  if v_reason is null and (v_fee<0 or v_fee>a.gross_cents) then v_reason:='invalid_processor_fee'; end if;
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
        select c.id,o.org_id,registration_id,gross_cents,platform_fee_cents,fee,gross_cents::bigint-platform_fee_cents-fee from allocated;
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
revoke all on function public.booking_payment_confirm(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.booking_payment_confirm(uuid,jsonb,jsonb) to service_role;
