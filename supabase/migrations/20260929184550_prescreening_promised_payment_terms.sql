-- Disabling future sales must not erase the payment path promised to existing
-- applicants. Event edits must also preserve an already-started 72-hour window.
create function public.category_prescreening_terms_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.events where id=new.event_id for update;
  if (new.reservation_fee_cents is null or new.entry_payment_deadline_at is null) and exists(
    select 1 from public.prescreening_applications a join public.prescreening_batches b on b.id=a.batch_id
    where a.category_id=new.id and a.released_at is null and b.checkout_intent='reservation'
      and b.status in ('reviewing','ready')) then
    raise exception 'category_reservation_terms_required_for_existing_requests' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function public.category_prescreening_terms_guard() from public,anon,authenticated;
create trigger category_prescreening_terms_guard before update of reservation_fee_cents,entry_payment_deadline_at on public.categories
  for each row execute function public.category_prescreening_terms_guard();

create function public.event_prescreening_deadline_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.registration_closes_at is not null and new.registration_closes_at is distinct from old.registration_closes_at
    and exists(select 1 from public.prescreening_batches b where b.event_id=new.id and b.status='ready'
      and b.checkout_intent='entry' and b.payment_deadline_at>statement_timestamp()
      and b.payment_deadline_at>new.registration_closes_at) then
    raise exception 'event_deadline_below_promised_window' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function public.event_prescreening_deadline_guard() from public,anon,authenticated;
create trigger event_prescreening_deadline_guard before update of registration_closes_at on public.events
  for each row execute function public.event_prescreening_deadline_guard();
