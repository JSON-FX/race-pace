-- Checkout preparation previously wrote the payment row without the event lock.
-- Expiry could read no provider request, release the places, then race that
-- write and the outgoing provider call. Both paths now serialize on the event.
create function public.reservation_prepare_checkout(p_actor uuid,p_reservation uuid,p_generation integer,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.event_reservations%rowtype; p public.reservation_payments%rowtype;
begin
  perform 1 from public.events where id=(select event_id from public.event_reservations where id=p_reservation) for update;
  select * into r from public.event_reservations where id=p_reservation for update;
  select * into p from public.reservation_payments where reservation_id=p_reservation for update;
  if r.id is null or r.user_id is distinct from p_actor then
    raise exception 'forbidden' using errcode='42501'; end if;
  if r.status<>'pending' or r.checkout_expires_at<=clock_timestamp() or p.id is null or p.status<>'pending'
    or p.provider<>'paymongo' or p.checkout_generation is distinct from p_generation or p.provider_ref is not null then
    raise exception 'reservation_not_payable' using errcode='23514'; end if;
  if p.checkout_request is not null then
    -- Replays use the persisted request, within the provider idempotency window.
    if p.checkout_requested_at is null or p.checkout_requested_at+interval '23 hours'<=clock_timestamp() then
      raise exception 'checkout_reconciliation_required' using errcode='23514'; end if;
    return p.checkout_request;
  end if;
  if jsonb_typeof(p_request) is distinct from 'object' then
    raise exception 'invalid_input' using errcode='22023'; end if;
  update public.reservation_payments set checkout_request=p_request where id=p.id;
  return p_request;
end $$;
revoke all on function public.reservation_prepare_checkout(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.reservation_prepare_checkout(uuid,uuid,integer,jsonb) to service_role;
