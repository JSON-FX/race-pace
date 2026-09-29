-- Local-only migration; not applied to either hosted project.
-- A single ledger projection counts each place once while ownership moves
-- from review to checkout to a paid reservation and then a race entry.
create or replace function public.event_capacity_claims(p_event uuid)
returns table(category_id uuid,participant_passport_id uuid,registration_id uuid,
  reservation_place_id uuid,application_id uuid,pool text)
language sql stable security definer set search_path='' as $$
  with active_entries as (
    select r.* from public.registrations r where r.event_id=p_event and (
      r.status='paid' or (r.status='pending' and (r.expires_at is null or r.expires_at>statement_timestamp())) or
      (r.status in ('pending','expired') and (
        exists(select 1 from public.payments p where p.registration_id=r.id and p.provider='paymongo'
          and p.status='pending' and (p.provider_ref is not null or p.checkout_request is not null)) or
        exists(select 1 from public.booking_payment_attempts a where a.booking_order_id=r.booking_order_id
          and a.status in ('creating','ready','creation_unknown','reconciliation_required'))
      ))
    )
  ), held_places as (
    select p.* from public.event_reservation_places p join public.event_reservations q on q.id=p.reservation_id
    where p.event_id=p_event and p.status='held' and q.status in ('pending','paid','review_required')
      and not exists(select 1 from active_entries r where r.event_reservation_id=p.reservation_id
        and r.participant_passport_id=p.participant_passport_id)
  )
  select r.category_id,r.participant_passport_id,r.id,null::uuid,r.prescreening_application_id,
    case when exists(select 1 from public.event_reservation_places p where p.reservation_id=r.event_reservation_id
      and p.participant_passport_id=r.participant_passport_id and p.category_id=r.category_id)
      or exists(select 1 from public.prescreening_applications a join public.prescreening_batches b on b.id=a.batch_id
        where a.id=r.prescreening_application_id and b.checkout_intent='reservation')
      then 'reservation' else 'general' end
  from active_entries r
  union all
  select p.category_id,p.participant_passport_id,null::uuid,p.id,p.prescreening_application_id,'reservation' from held_places p
  union all
  select a.category_id,a.participant_passport_id,null::uuid,null::uuid,a.id,
    case when b.checkout_intent='reservation' then 'reservation' else 'general' end
  from public.prescreening_applications a join public.prescreening_batches b on b.id=a.batch_id
  where a.event_id=p_event and a.released_at is null
    and not exists(select 1 from active_entries r where r.prescreening_application_id=a.id)
    and not exists(select 1 from held_places p where p.prescreening_application_id=a.id)
  union all
  -- Older reservations may have neither a category nor child Passport places.
  select null::uuid,null::uuid,null::uuid,q.id,null::uuid,'reservation'
  from public.event_reservations q where q.event_id=p_event and q.status in ('pending','paid','review_required')
    and not exists(select 1 from public.event_reservation_places p where p.reservation_id=q.id)
    and not exists(select 1 from active_entries r where r.event_reservation_id=q.id);
$$;
revoke all on function public.event_capacity_claims(uuid) from public,anon,authenticated;
grant execute on function public.event_capacity_claims(uuid) to service_role;

create or replace function public.assert_category_capacity(p_category uuid,p_pool text,p_quantity integer,
  p_registration uuid default null,p_application uuid default null,p_place uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare c public.categories%rowtype; v_total bigint; v_general bigint; v_reserved bigint; v_event_total bigint; v_event_limit integer;
begin
  select * into c from public.categories where id=p_category;
  if not found or p_pool not in ('general','reservation') or p_quantity<0 then
    raise exception 'invalid_capacity_request' using errcode='22023'; end if;
  -- Callers acquire the parent first, then category rows in UUID order.
  select total_event_slots into v_event_limit from public.events where id=c.event_id for update;
  select * into c from public.categories where id=p_category for update;
  select count(*),count(*) filter(where q.pool='general'),count(*) filter(where q.pool='reservation')
    into v_total,v_general,v_reserved from public.event_capacity_claims(c.event_id) q
    where q.category_id=c.id and (p_registration is null or q.registration_id is distinct from p_registration)
      and (p_application is null or q.application_id is distinct from p_application)
      and (p_place is null or q.reservation_place_id is distinct from p_place);
  if v_total+p_quantity>c.slots_total then raise exception 'category_capacity_exhausted' using errcode='23514'; end if;
  if c.reservation_enabled and c.reservation_sales_close_at>statement_timestamp() then
    if (p_pool='general' and v_general+p_quantity>c.slots_total-c.reservation_slots) or
       (p_pool='reservation' and v_reserved+p_quantity>c.reservation_slots) then
      raise exception 'category_capacity_exhausted' using errcode='23514'; end if;
  end if;
  select count(*) into v_event_total from public.event_capacity_claims(c.event_id) q
    where (p_registration is null or q.registration_id is distinct from p_registration)
      and (p_application is null or q.application_id is distinct from p_application)
      and (p_place is null or q.reservation_place_id is distinct from p_place);
  if v_event_limit is not null and v_event_total+p_quantity>v_event_limit then
    raise exception 'event_capacity_exhausted' using errcode='23514'; end if;
end $$;
revoke all on function public.assert_category_capacity(uuid,text,integer,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.assert_category_capacity(uuid,text,integer,uuid,uuid,uuid) to service_role;
