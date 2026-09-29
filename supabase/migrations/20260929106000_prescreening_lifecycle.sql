-- Local-only until hosted acceptance. A review hold has no expiry. Payable
-- holds expire only after every local provider record has a terminal outcome.
create function public.prescreening_cancel(p_batch uuid) returns void
language plpgsql security definer set search_path='' as $$
declare b public.prescreening_batches%rowtype;
begin
  select * into b from public.prescreening_batches where id=p_batch and booked_by_user_id=auth.uid();
  if not found then raise exception 'forbidden' using errcode='42501'; end if;
  perform 1 from public.events where id=b.event_id for update;
  select * into b from public.prescreening_batches where id=p_batch for update;
  if b.status in ('cancelled','expired') then return; end if;
  if b.status='completed' then raise exception 'payment_already_started' using errcode='23514'; end if;
  if b.event_reservation_id is not null or exists(select 1 from public.registrations r
    join public.prescreening_applications a on a.id=r.prescreening_application_id where a.batch_id=b.id
    and (r.booking_order_id is null or r.status='paid')) then
    raise exception 'payment_already_started' using errcode='23514'; end if;
  if b.booking_order_id is not null then perform public.booking_order_cancel(auth.uid(),b.booking_order_id); end if;
  update public.prescreening_applications set released_at=statement_timestamp() where batch_id=b.id and released_at is null;
  update public.prescreening_batches set status='cancelled' where id=b.id;
end $$;
revoke all on function public.prescreening_cancel(uuid) from public,anon;
grant execute on function public.prescreening_cancel(uuid) to authenticated;

create function public.prescreening_finish_expiry(p_batch uuid) returns text
language plpgsql security definer set search_path='' as $$
declare b public.prescreening_batches%rowtype;
begin
  select * into b from public.prescreening_batches where id=p_batch;
  if not found then return 'not_found'; end if;
  perform 1 from public.events where id=b.event_id for update;
  select * into b from public.prescreening_batches where id=p_batch for update;
  if b.status<>'ready' then return b.status; end if;
  if b.payment_deadline_at>statement_timestamp() then return 'not_due'; end if;
  perform 1 from public.booking_orders where id=b.booking_order_id for update;
  perform 1 from public.booking_payment_attempts where booking_order_id=b.booking_order_id order by id for update;
  perform 1 from public.event_reservations where id=b.event_reservation_id for update;
  perform 1 from public.registrations r join public.prescreening_applications a on a.id=r.prescreening_application_id
    where a.batch_id=b.id order by r.id for update of r;
  if exists(select 1 from public.booking_orders where id=b.booking_order_id and status in ('paid','reconciliation_required')) or
    exists(select 1 from public.booking_payment_attempts where booking_order_id=b.booking_order_id and status not in ('prepared','failed','expired')) or
    exists(select 1 from public.event_reservations where id=b.event_reservation_id and status<>'expired') or
    exists(select 1 from public.registrations r join public.prescreening_applications a on a.id=r.prescreening_application_id
      where a.batch_id=b.id and (r.status='paid' or exists(select 1 from public.payments p where p.registration_id=r.id and
      (p.status='paid' or (p.status='pending' and p.provider='paymongo' and (p.provider_ref is not null or p.checkout_request is not null)))))) then
    return 'payment_unresolved'; end if;
  update public.booking_payment_attempts set status='expired' where booking_order_id=b.booking_order_id and status='prepared';
  update public.registrations r set status='expired',expires_at=null from public.prescreening_applications a
    where a.id=r.prescreening_application_id and a.batch_id=b.id and r.status='pending';
  update public.payments p set status='failed' from public.registrations r join public.prescreening_applications a on a.id=r.prescreening_application_id
    where p.registration_id=r.id and a.batch_id=b.id and p.status='pending';
  update public.booking_orders set status='expired',expires_at=null where id=b.booking_order_id and status='pending';
  update public.prescreening_applications set released_at=statement_timestamp() where batch_id=b.id and released_at is null;
  update public.prescreening_batches set status='expired' where id=b.id;
  return 'expired';
end $$;
revoke all on function public.prescreening_finish_expiry(uuid) from public,anon,authenticated;
grant execute on function public.prescreening_finish_expiry(uuid) to service_role;

-- Periodic readiness also covers reopening an event or reactivating an org.
-- A deadline conflict leaves an organizer-visible reviewing batch, never a
-- shortened payment window. One batch cannot block the rest of the queue.
alter table public.prescreening_batches add column maintenance_checked_at timestamptz;

create function public.prescreening_maintenance(p_limit integer default 50) returns integer
language plpgsql security definer set search_path='' as $$
declare b record; n integer:=0;
begin
  -- Select fairly, then lock events in a stable order across concurrent workers.
  for b in select q.id,q.event_id from (select id,event_id from public.prescreening_batches
    where status in ('reviewing','ready') order by maintenance_checked_at nulls first,created_at,id
    limit greatest(1,least(p_limit,200))) q order by q.event_id,q.id loop
    begin
      perform 1 from public.events where id=b.event_id for update;
      update public.prescreening_batches set maintenance_checked_at=statement_timestamp() where id=b.id;
      perform public.prescreening_refresh_ready(b.id);
      perform public.prescreening_finish_expiry(b.id);
      n:=n+1;
    exception when check_violation or lock_not_available or deadlock_detected then null;
    end;
  end loop;
  return n;
end $$;
revoke all on function public.prescreening_maintenance(integer) from public,anon,authenticated;
grant execute on function public.prescreening_maintenance(integer) to service_role;
select cron.schedule('prescreening-readiness-and-expiry','* * * * *',$$select public.prescreening_maintenance(200)$$);

-- Existing paid reservations retain their approval when converting. Match
-- the category and honor later organizer extensions without rewriting prices.
create or replace function public.registration_attach_reserved_passport() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_reservation uuid;
begin
  if new.event_reservation_id is not null or new.participant_passport_id is null
    or new.booked_by_user_id is null then return new; end if;
  perform 1 from public.events where id=new.event_id for update;
  select r.id into v_reservation from public.event_reservations r
    join public.event_reservation_places p on p.reservation_id=r.id
    left join public.categories c on c.id=p.category_id
    where r.event_id=new.event_id and r.org_id=new.org_id and r.user_id=new.booked_by_user_id and r.status='paid'
      and p.participant_passport_id=new.participant_passport_id and p.status='held'
      and (p.category_id is null or p.category_id=new.category_id)
      and coalesce(greatest(p.entry_payment_deadline_at,c.entry_payment_deadline_at),r.registration_deadline_at)>statement_timestamp()
    order by r.created_at,r.id limit 1 for update of r;
  if v_reservation is null then
    select r.id into v_reservation from public.event_reservations r
      where r.event_id=new.event_id and r.org_id=new.org_id and r.user_id=new.booked_by_user_id and r.status='paid'
        and r.registration_deadline_at>statement_timestamp() and new.user_id=new.booked_by_user_id
        and r.reservation_request is null
        and not exists(select 1 from public.event_reservation_places p where p.reservation_id=r.id)
      order by r.created_at,r.id limit 1 for update of r;
  end if;
  if v_reservation is not null then new.event_reservation_id:=v_reservation;
  elsif exists(select 1 from public.event_reservation_places p join public.event_reservations r on r.id=p.reservation_id
    where p.event_id=new.event_id and p.participant_passport_id=new.participant_passport_id and p.status='held'
    and r.status in ('pending','paid','review_required')) then
    raise exception 'participant_already_reserved' using errcode='23505';
  end if;
  return new;
end $$;
revoke all on function public.registration_attach_reserved_passport() from public,anon,authenticated;

-- Once payment owns a place, releasing/refunding that payment must never
-- resurrect the old free screening hold.
create function public.prescreening_payment_completed() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_batch uuid;
begin
  if new.status::text<>'paid' then return new; end if;
  if tg_table_name='registrations' then
    if new.prescreening_application_id is null then return new; end if;
    update public.prescreening_applications set released_at=coalesce(released_at,statement_timestamp())
      where id=new.prescreening_application_id returning batch_id into v_batch;
  else
    select id into v_batch from public.prescreening_batches where event_reservation_id=new.id;
    update public.prescreening_applications set released_at=coalesce(released_at,statement_timestamp()) where batch_id=v_batch;
  end if;
  if v_batch is not null and not exists(select 1 from public.prescreening_applications where batch_id=v_batch and released_at is null) then
    update public.prescreening_batches set status='completed' where id=v_batch;
  end if;
  return new;
end $$;
revoke all on function public.prescreening_payment_completed() from public,anon,authenticated;
create trigger zz_prescreening_payment_completed after insert or update of status on public.registrations
  for each row execute function public.prescreening_payment_completed();
create trigger zz_prescreening_payment_completed after update of status on public.event_reservations
  for each row execute function public.prescreening_payment_completed();
