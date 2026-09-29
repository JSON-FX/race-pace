-- Local-only until hosted acceptance. Provider GET must prove a checkout closed
-- before a timer is allowed to turn its places back into available capacity.
create function public.prescreening_expire_group_attempt(p_attempt uuid,p_session text,p_evidence jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare a public.booking_payment_attempts%rowtype; o public.booking_orders%rowtype;
begin
  select * into a from public.booking_payment_attempts where id=p_attempt;
  if not found then return 'not_found'; end if;
  perform 1 from public.events where id=(select event_id from public.booking_orders where id=a.booking_order_id) for update;
  select * into o from public.booking_orders where id=a.booking_order_id for update;
  select * into a from public.booking_payment_attempts where id=p_attempt for update;
  if o.status<>'pending' or o.expires_at>statement_timestamp() then return 'not_due'; end if;
  if p_evidence->>'status' is distinct from 'expired' or p_evidence->>'source' is distinct from 'paymongo_get' or
    not exists(select 1 from public.booking_payment_dispatches where attempt_id=a.id and session_id=p_session) then return 'session_mismatch'; end if;
  if a.status='paid' or exists(select 1 from public.booking_payment_captures where attempt_id=a.id) then return 'capture_unresolved'; end if;
  update public.booking_payment_attempts set status='expired' where id=a.id;
  if not exists(select 1 from public.booking_payment_attempts where booking_order_id=o.id and status not in ('expired','failed','prepared')) then
    update public.registrations set status='expired',expires_at=null where booking_order_id=o.id and status='pending';
    update public.booking_orders set status='expired',expires_at=null where id=o.id;
  end if;
  return 'expired';
end $$;
revoke all on function public.prescreening_expire_group_attempt(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.prescreening_expire_group_attempt(uuid,text,jsonb) to service_role;

create or replace function public.coming_soon_expiry_candidates(p_limit integer default 50)
returns setof uuid language sql stable security invoker set search_path='' as $$
  select r.id from public.event_reservations r join public.events e on e.id=r.event_id
  where (r.status='pending' and r.checkout_expires_at<=statement_timestamp()) or
    (r.status='paid' and (exists(select 1 from public.event_reservation_places p left join public.categories c on c.id=p.category_id
      where p.reservation_id=r.id and p.status='held' and
        coalesce(greatest(p.entry_payment_deadline_at,c.entry_payment_deadline_at),r.registration_deadline_at)<=statement_timestamp()
        and (p.category_id is not null or e.status<>'coming_soon'))
      or (r.reservation_request is null and r.registration_deadline_at<=statement_timestamp() and e.status<>'coming_soon'
        and not exists(select 1 from public.event_reservation_places where reservation_id=r.id))))
  order by r.created_at,r.id limit greatest(1,least(coalesce(p_limit,50),100));
$$;
revoke all on function public.coming_soon_expiry_candidates(integer) from public,anon,authenticated;
grant execute on function public.coming_soon_expiry_candidates(integer) to service_role;

create or replace function public.expire_event_reservation(p_reservation_id uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare r public.event_reservations%rowtype; e public.events%rowtype; n integer;
begin
  select * into r from public.event_reservations where id=p_reservation_id;
  if not found then return 'not_found'; end if;
  select * into e from public.events where id=r.event_id for update;
  select * into r from public.event_reservations where id=p_reservation_id for update;
  if r.status in ('expired','converted') then return 'already'; end if;
  if r.status='review_required' then return 'review_required'; end if;
  if r.status='pending' then
    if r.checkout_expires_at>statement_timestamp() then return 'not_due'; end if;
    if exists(select 1 from public.reservation_payments where reservation_id=r.id and status='pending'
      and (provider_ref is not null or checkout_request is not null)) then return 'provider_unresolved'; end if;
  end if;
  if exists(select 1 from public.event_reservation_places where reservation_id=r.id) then
    update public.event_reservation_places p set status='expired',expired_at=statement_timestamp()
    where p.reservation_id=r.id and p.status='held' and (r.status='pending' or
      (coalesce(greatest(p.entry_payment_deadline_at,(select c.entry_payment_deadline_at from public.categories c where c.id=p.category_id)),r.registration_deadline_at)<=statement_timestamp()
      and (p.category_id is not null or e.status<>'coming_soon')))
      and not exists(select 1 from public.event_capacity_claims(e.id) q where q.participant_passport_id=p.participant_passport_id and q.registration_id is not null);
    get diagnostics n=row_count;
    if exists(select 1 from public.event_reservation_places where reservation_id=r.id and status='held') then
      return case when n>0 then 'partially_expired' else 'entry_unresolved' end; end if;
    update public.event_reservations set status=case when exists(select 1 from public.event_reservation_places where reservation_id=r.id and status='converted') then 'converted' else 'expired' end,
      expired_at=statement_timestamp() where id=r.id;
  else
    if r.status='paid' and (e.status='coming_soon' or r.registration_deadline_at>statement_timestamp()) then return 'not_due'; end if;
    if exists(select 1 from public.event_capacity_claims(e.id) q join public.registrations reg on reg.id=q.registration_id where reg.event_reservation_id=r.id) then return 'entry_unresolved'; end if;
    update public.event_reservations set status='expired',expired_at=statement_timestamp() where id=r.id;
  end if;
  update public.reservation_payments set status='failed' where reservation_id=r.id and status='pending';
  return 'expired';
end $$;
revoke all on function public.expire_event_reservation(uuid) from public,anon,authenticated;
grant execute on function public.expire_event_reservation(uuid) to service_role;

create function public.finish_reservation_checkout_expiry(p_reservation uuid,p_session text,p_evidence jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare r public.event_reservations%rowtype; p public.reservation_payments%rowtype;
begin
  perform 1 from public.events where id=(select event_id from public.event_reservations where id=p_reservation) for update;
  select * into r from public.event_reservations where id=p_reservation for update;
  select * into p from public.reservation_payments where reservation_id=p_reservation for update;
  if r.status<>'pending' or r.checkout_expires_at>statement_timestamp() or p.status<>'pending' then return 'not_due'; end if;
  if p.provider_ref is distinct from p_session or p_session is null or p_evidence->>'source' is distinct from 'paymongo_get'
    or p_evidence->>'status' is distinct from 'expired' then return 'session_mismatch'; end if;
  if exists(select 1 from public.reservation_capture_events where reservation_id=r.id) then return 'capture_unresolved'; end if;
  update public.reservation_payments set status='failed',raw=coalesce(raw,'{}')||jsonb_build_object('expiry',p_evidence) where id=p.id;
  return public.expire_event_reservation(r.id);
end $$;
revoke all on function public.finish_reservation_checkout_expiry(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.finish_reservation_checkout_expiry(uuid,text,jsonb) to service_role;

-- Prepared attempts have never been dispatched. Recheck under the same event
-- lock as dispatch so an expiry cannot race a new provider checkout.
create function public.finish_group_checkout_expiry(p_order uuid) returns text
language plpgsql security definer set search_path='' as $$
declare o public.booking_orders%rowtype;
begin
  perform 1 from public.events where id=(select event_id from public.booking_orders where id=p_order) for update;
  select * into o from public.booking_orders where id=p_order for update;
  if not found then return 'not_found'; end if;
  if o.status<>'pending' or o.expires_at>statement_timestamp() then return 'not_due'; end if;
  perform 1 from public.booking_payment_attempts where booking_order_id=o.id order by id for update;
  if exists(select 1 from public.booking_payment_attempts where booking_order_id=o.id and status not in ('prepared','failed','expired'))
    or exists(select 1 from public.booking_payment_captures c join public.booking_payment_attempts a on a.id=c.attempt_id where a.booking_order_id=o.id)
    then return 'provider_unresolved'; end if;
  update public.booking_payment_attempts set status='expired' where booking_order_id=o.id and status='prepared';
  update public.registrations set status='expired',expires_at=null where booking_order_id=o.id and status='pending';
  update public.booking_orders set status='expired',expires_at=null where id=o.id;
  return 'expired';
end $$;
revoke all on function public.finish_group_checkout_expiry(uuid) from public,anon,authenticated;
grant execute on function public.finish_group_checkout_expiry(uuid) to service_role;
