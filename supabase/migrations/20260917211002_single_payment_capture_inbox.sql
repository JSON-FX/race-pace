-- A paid PayMongo callback is evidence of money movement even when its
-- registration cannot be fulfilled. Keep each capture before attempting the
-- legacy confirmation RPC, and prevent payout while any capture needs review.
create table public.single_payment_captures (
  provider_payment_id text primary key check (provider_payment_id ~ '^pay_[A-Za-z0-9_-]+$'),
  registration_id uuid not null references public.registrations(id),
  org_id uuid not null references public.organizations(id),
  event_id uuid not null references public.events(id),
  session_id text,
  amount_cents integer,
  fee_cents integer,
  net_cents integer,
  livemode boolean,
  provider_resource jsonb not null,
  review_resource jsonb,
  state text not null check (state in ('observed','settled','reconciliation_required')),
  reason text,
  delivery_count integer not null default 1 check (delivery_count > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  settled_at timestamptz
);
create index single_payment_captures_event_state on public.single_payment_captures(event_id,state);
create index single_payment_captures_registration on public.single_payment_captures(registration_id);
alter table public.single_payment_captures enable row level security;
revoke all on public.single_payment_captures from public, anon, authenticated;
grant select, insert, update on public.single_payment_captures to service_role;

create function public.single_paid_id_from_raw(p_raw jsonb) returns text
language sql immutable security invoker set search_path = '' as $$
  with candidate as (
    select coalesce(
      p_raw#>'{session,data,attributes,payments}',
      p_raw#>'{event,data,attributes,data,attributes,payments}',
      p_raw#>'{data,attributes,payments}'
    ) as payments
  )
  select item->>'id' from candidate,
    jsonb_array_elements(case when jsonb_typeof(payments)='array' then payments else '[]'::jsonb end) item
  where item#>>'{attributes,status}'='paid' limit 1;
$$;

create function public.single_capture_observe(
  p_registration_id uuid, p_payment_id text, p_session_id text,
  p_amount integer, p_fee integer, p_net integer, p_livemode boolean,
  p_invalid_reason text, p_resource jsonb
) returns text
language plpgsql security invoker set search_path = '' as $$
declare r public.registrations%rowtype; p public.payments%rowtype;
  c public.single_payment_captures%rowtype; v_reason text; v_state text;
begin
  if p_payment_id is null or p_payment_id !~ '^pay_[A-Za-z0-9_-]+$' then return 'invalid_identity'; end if;
  perform pg_advisory_xact_lock(hashtextextended('single_capture:'||p_registration_id::text,0));
  select * into r from public.registrations where id=p_registration_id for update;
  if not found then return 'registration_missing'; end if;
  select * into p from public.payments where registration_id=r.id for update;
  if not found then return 'payment_missing'; end if;
  select * into c from public.single_payment_captures where provider_payment_id=p_payment_id for update;
  if found then
    if c.registration_id<>r.id or c.session_id is distinct from p_session_id or
       c.amount_cents is distinct from p_amount or c.fee_cents is distinct from p_fee or
       c.net_cents is distinct from p_net or c.livemode is distinct from p_livemode then
      update public.single_payment_captures set state='reconciliation_required',
        reason='payment_identity_conflict', review_resource=p_resource,
        delivery_count=delivery_count+1,last_seen_at=now() where provider_payment_id=p_payment_id;
      return 'reconciliation_required';
    end if;
    update public.single_payment_captures set delivery_count=delivery_count+1,last_seen_at=now()
      where provider_payment_id=p_payment_id;
    return c.state;
  end if;

  if exists(select 1 from public.single_payment_captures where registration_id=r.id)
    then v_reason:='extra_capture';
  elsif p.provider<>'paymongo' then v_reason:='provider_mismatch';
  elsif p_invalid_reason is not null then v_reason:=p_invalid_reason;
  elsif p_session_id is null or p_session_id is distinct from p.provider_ref
    then v_reason:='session_mismatch';
  elsif p_amount is null or p_fee is null or p_net is null or p_amount<=0 or
        p_fee<0 or p_net<0 or p_amount-p_fee<>p_net
    then v_reason:='fee_integrity';
  elsif p.checkout_fee_mode='absorb' and p_amount<>r.total_amount
    then v_reason:='fixed_price_mismatch';
  elsif r.status::text not in ('pending','expired') then
    if r.status::text in ('paid','refunded') and
       public.single_paid_id_from_raw(p.raw)=p_payment_id then
      v_state:='settled';
    else v_reason:='registration_not_confirmable'; end if;
  end if;
  v_state:=coalesce(v_state,case when v_reason is null then 'observed' else 'reconciliation_required' end);
  insert into public.single_payment_captures(
    provider_payment_id,registration_id,org_id,event_id,session_id,
    amount_cents,fee_cents,net_cents,livemode,provider_resource,state,reason,settled_at
  ) values (
    p_payment_id,r.id,r.org_id,r.event_id,p_session_id,
    p_amount,p_fee,p_net,p_livemode,coalesce(p_resource,'{}'::jsonb),v_state,v_reason,
    case when v_state='settled' then now() else null end
  );
  return v_state;
end $$;

create function public.single_capture_settle(p_registration_id uuid,p_payment_id text) returns text
language plpgsql security invoker set search_path = '' as $$
declare c public.single_payment_captures%rowtype; p public.payments%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('single_capture:'||p_registration_id::text,0));
  select * into c from public.single_payment_captures
    where provider_payment_id=p_payment_id and registration_id=p_registration_id for update;
  if not found then return 'not_found'; end if;
  if c.state='settled' then return 'settled'; end if;
  if c.state='reconciliation_required' then return c.state; end if;
  select * into p from public.payments where registration_id=p_registration_id for update;
  if p.status::text in ('paid','partially_refunded','refunded') and
     public.single_paid_id_from_raw(p.raw)=p_payment_id then
    update public.single_payment_captures set state='settled',settled_at=now()
      where provider_payment_id=p_payment_id;
    return 'settled';
  end if;
  update public.single_payment_captures set state='reconciliation_required',reason='ledger_capture_mismatch'
    where provider_payment_id=p_payment_id;
  return 'reconciliation_required';
end $$;

create function public.single_capture_blockers(p_event uuid) returns integer
language sql stable security invoker set search_path = '' as $$
  select (
    (select count(*) from public.single_payment_captures c
      where c.event_id=p_event and c.state<>'settled')
    + (select count(*) from public.payments p
       join public.registrations r on r.id=p.registration_id
       where r.event_id=p_event and p.provider='paymongo'
         and p.checkout_request is not null
         and p.status::text in ('paid','partially_refunded','refunded')
         and not exists(select 1 from public.single_payment_captures c
           where c.registration_id=r.id and c.state='settled'))
  )::integer;
$$;

-- Preserve the existing group and event-date gates. The new wrappers add a
-- single-payment hold without changing statement arithmetic.
alter function public.payout_open_statement(uuid) rename to payout_open_statement_before_single_captures;
create function public.payout_open_statement(p_event_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if not public.auth_is_super_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(76120260917);
  if public.single_capture_blockers(p_event_id)>0 then raise exception 'single_capture_reconciliation_required'; end if;
  return public.payout_open_statement_before_single_captures(p_event_id);
end $$;

alter function public.payout_refresh_statement(uuid) rename to payout_refresh_statement_before_single_captures;
create function public.payout_refresh_statement(p_statement_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare ev uuid;
begin
  if not public.auth_is_super_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(76120260917);
  select event_id into ev from public.payout_statements where id=p_statement_id;
  if public.single_capture_blockers(ev)>0 then return 'unreconciled'; end if;
  return public.payout_refresh_statement_before_single_captures(p_statement_id);
end $$;

alter function public.payout_mark_paid(uuid,text,text,integer) rename to payout_mark_paid_before_single_captures;
create function public.payout_mark_paid(
  p_statement_id uuid,p_reference text,p_note text,p_expected_revision integer
) returns text language plpgsql security definer set search_path = '' as $$
declare ev uuid;
begin
  if not public.auth_is_super_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(76120260917);
  select event_id into ev from public.payout_statements where id=p_statement_id;
  if public.single_capture_blockers(ev)>0 then return 'unreconciled'; end if;
  return public.payout_mark_paid_before_single_captures(p_statement_id,p_reference,p_note,p_expected_revision);
end $$;

alter function public.payout_unreconciled_count(uuid) rename to payout_unreconciled_count_before_single_captures;
create function public.payout_unreconciled_count(p_event_id uuid) returns integer
language plpgsql stable security definer set search_path = '' as $$
begin
  return public.payout_unreconciled_count_before_single_captures(p_event_id)
    + public.single_capture_blockers(p_event_id);
end $$;

revoke all on function public.single_paid_id_from_raw(jsonb),
  public.single_capture_observe(uuid,text,text,integer,integer,integer,boolean,text,jsonb),
  public.single_capture_settle(uuid,text),public.single_capture_blockers(uuid),
  public.payout_open_statement_before_single_captures(uuid),
  public.payout_refresh_statement_before_single_captures(uuid),
  public.payout_mark_paid_before_single_captures(uuid,text,text,integer),
  public.payout_unreconciled_count_before_single_captures(uuid)
  from public,anon,authenticated;
grant execute on function public.single_paid_id_from_raw(jsonb),
  public.single_capture_observe(uuid,text,text,integer,integer,integer,boolean,text,jsonb),
  public.single_capture_settle(uuid,text),public.single_capture_blockers(uuid)
  to service_role;
revoke all on function public.payout_open_statement(uuid),public.payout_refresh_statement(uuid),
  public.payout_mark_paid(uuid,text,text,integer),public.payout_unreconciled_count(uuid)
  from public,anon;
grant execute on function public.payout_open_statement(uuid),public.payout_refresh_statement(uuid),
  public.payout_mark_paid(uuid,text,text,integer),public.payout_unreconciled_count(uuid)
  to authenticated,service_role;
