-- An expired provider session is not an expired admission hold. Retain every
-- replaced session so delayed captures still reach reconciliation, never a new
-- participant or a renewed payment deadline.
alter table public.reservation_payments add column checkout_generation integer not null default 0 check(checkout_generation>=0);
alter table public.reservation_payments add column checkout_requested_at timestamptz;
update public.reservation_payments set checkout_requested_at=created_at where checkout_request is not null;
create function public.reservation_checkout_request_clock() returns trigger language plpgsql set search_path='' as $$
begin
  if new.checkout_request is null then new.checkout_requested_at:=null;
  elsif old.checkout_request is null then new.checkout_requested_at:=statement_timestamp();
  else new.checkout_requested_at:=old.checkout_requested_at; end if;
  return new;
end $$;
revoke all on function public.reservation_checkout_request_clock() from public,anon,authenticated;
create trigger reservation_checkout_request_clock before update on public.reservation_payments
  for each row execute function public.reservation_checkout_request_clock();
create table public.reservation_checkout_history (
  reservation_id uuid not null references public.event_reservations(id) on delete cascade,
  generation integer not null,
  provider_ref text unique,
  checkout_request jsonb not null,
  evidence jsonb not null,
  closed_at timestamptz not null default statement_timestamp(),
  primary key(reservation_id,generation)
);
alter table public.reservation_checkout_history enable row level security;
revoke all on public.reservation_checkout_history from public,anon,authenticated;
grant select,insert on public.reservation_checkout_history to service_role;
grant select,update(checkout_generation) on public.reservation_payments to service_role;

create function public.reservation_retry_checkout(p_reservation uuid,p_generation integer,p_session text,p_evidence jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.event_reservations%rowtype; p public.reservation_payments%rowtype;
begin
  perform 1 from public.events where id=(select event_id from public.event_reservations where id=p_reservation) for update;
  select * into r from public.event_reservations where id=p_reservation for update;
  select * into p from public.reservation_payments where reservation_id=p_reservation for update;
  if r.id is null or p.id is null or r.status<>'pending' or p.status<>'pending' or r.checkout_expires_at<=statement_timestamp()
    or p.checkout_generation<>p_generation or p.checkout_request is null then return false; end if;
  if exists(select 1 from public.reservation_capture_events where reservation_id=r.id) then return false; end if;
  if ((p_evidence->>'source'='paymongo_get' and p_evidence->>'status'='expired'
      and p_session is not null and p.provider_ref=p_session)
    or (p_evidence->>'source'='paymongo_create' and p_evidence->>'status'='rejected'
      and p.provider_ref is null and p_session is null)) is not true then return false; end if;
  insert into public.reservation_checkout_history(reservation_id,generation,provider_ref,checkout_request,evidence)
    values(r.id,p.checkout_generation,p.provider_ref,p.checkout_request,p_evidence);
  update public.reservation_payments set provider_ref=null,checkout_url=null,checkout_request=null,
    checkout_generation=checkout_generation+1 where id=p.id;
  return true;
end $$;
revoke all on function public.reservation_retry_checkout(uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.reservation_retry_checkout(uuid,integer,text,jsonb) to service_role;

-- Close only this provider attempt. The order and every participant's hold keep
-- their original expiry; prepare_payment can then create a fresh attempt.
create function public.booking_payment_retry_expired(p_attempt uuid,p_session text,p_evidence jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare a public.booking_payment_attempts%rowtype; o public.booking_orders%rowtype;
begin
  select * into a from public.booking_payment_attempts where id=p_attempt;
  if not found then return false; end if;
  perform 1 from public.events where id=(select event_id from public.booking_orders where id=a.booking_order_id) for update;
  select * into o from public.booking_orders where id=a.booking_order_id for update;
  select * into a from public.booking_payment_attempts where id=p_attempt for update;
  if o.status<>'pending' or o.expires_at<=statement_timestamp() or a.status not in ('ready','creating','creation_unknown') then return false; end if;
  if p_evidence->>'source' is distinct from 'paymongo_get' or p_evidence->>'status' is distinct from 'expired'
    or not exists(select 1 from public.booking_payment_dispatches where attempt_id=a.id and session_id=p_session)
    or exists(select 1 from public.booking_payment_captures where attempt_id=a.id) then return false; end if;
  update public.booking_payment_attempts set status='expired' where id=a.id;
  return true;
end $$;
revoke all on function public.booking_payment_retry_expired(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.booking_payment_retry_expired(uuid,text,jsonb) to service_role;
