-- Expand the Coming Soon reservation sale to one place per selected
-- Passport. The existing header and ledger stay one row per provider checkout.
alter table public.event_reservations
  add column quantity integer not null default 1 check (quantity between 1 and 10);

create table public.event_reservation_places (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  event_id uuid not null references public.events(id),
  reservation_id uuid not null references public.event_reservations(id),
  participant_passport_id uuid not null references public.runner_passports(id),
  participant_name text not null,
  is_managed boolean not null,
  status text not null default 'held' check (status in ('held','converted','expired')),
  converted_registration_id uuid unique references public.registrations(id),
  converted_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  unique (reservation_id,participant_passport_id)
);
create unique index event_reservation_places_active_passport
  on public.event_reservation_places(event_id,participant_passport_id)
  where status='held';
create index event_reservation_places_reservation_status
  on public.event_reservation_places(reservation_id,status);
alter table public.event_reservation_places enable row level security;
revoke all on public.event_reservation_places from public,anon,authenticated;
grant select on public.event_reservation_places to authenticated;
grant all on public.event_reservation_places to service_role;
create policy event_reservation_places_read on public.event_reservation_places
  for select to authenticated using (exists (
    select 1 from public.event_reservations r where r.id=reservation_id
      and (r.user_id=(select auth.uid()) or public.auth_can_admin_org(r.org_id))
  ));

-- A failed provider handoff expires the header directly. Its child places
-- must release in the same transaction for the active-Passport index.
create function public.expire_event_reservation_places_with_header() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.status is distinct from 'expired' and new.status='expired' then
    update public.event_reservation_places set status='expired',expired_at=now()
      where reservation_id=new.id and status='held';
  end if;
  return new;
end $$;
revoke all on function public.expire_event_reservation_places_with_header()
  from public,anon,authenticated;
create trigger expire_event_reservation_places_with_header
  after update of status on public.event_reservations for each row
  execute function public.expire_event_reservation_places_with_header();

-- The old index forbids two places from one checkout. Passport-level uniqueness
-- and the capacity guard now provide the correct boundary.
drop index public.registrations_one_active_per_event_reservation;
create unique index registrations_one_active_per_reserved_passport
  on public.registrations(event_reservation_id,participant_passport_id)
  where event_reservation_id is not null and status in ('pending','paid');
drop index public.event_reservation_one_active_per_runner;

create or replace function public.event_reservation_capacity_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_event public.events%rowtype; v_reg_count bigint; v_res_count bigint;
begin
  select * into v_event from public.events where id=new.event_id for update;
  if not found or v_event.org_id<>new.org_id then
    raise exception 'reservation_event_scope_mismatch' using errcode='23514';
  end if;
  if tg_op='UPDATE' and
    (new.org_id,new.event_id,new.user_id,new.idempotency_key,new.quantity,
     new.reservation_fee_cents,new.platform_fee_cents)
    is distinct from
    (old.org_id,old.event_id,old.user_id,old.idempotency_key,old.quantity,
     old.reservation_fee_cents,old.platform_fee_cents) then
    raise exception 'reservation_identity_immutable' using errcode='23514';
  end if;
  if new.status not in ('pending','paid','review_required') then return new; end if;
  if tg_op='UPDATE' and old.status in ('pending','paid','review_required') then return new; end if;
  if v_event.status<>'coming_soon' or not v_event.coming_soon_reserve_enabled then
    raise exception 'reservations_not_open' using errcode='23514';
  end if;
  if v_event.reservation_deadline_at<=now() then
    raise exception 'reservation_deadline_passed' using errcode='23514';
  end if;
  select count(*) into v_reg_count from public.registrations r
    where r.event_id=new.event_id and (r.status='paid' or
      (r.status='pending' and (r.expires_at is null or r.expires_at>now())));
  select coalesce(sum(case when exists (
      select 1 from public.event_reservation_places p where p.reservation_id=q.id
    ) then (
      select count(*) from public.event_reservation_places p
      where p.reservation_id=q.id and p.status='held'
        and not exists (select 1 from public.registrations r
          where r.event_reservation_id=q.id and r.participant_passport_id=p.participant_passport_id
            and (r.status='paid' or (r.status='pending' and (r.expires_at is null or r.expires_at>now()))))
    ) else case when exists (select 1 from public.registrations r
      where r.event_reservation_id=q.id and (r.status='paid' or
        (r.status='pending' and (r.expires_at is null or r.expires_at>now())))) then 0 else 1 end end),0)
    into v_res_count from public.event_reservations q
    where q.event_id=new.event_id and q.id<>new.id
      and q.status in ('pending','paid','review_required');
  if v_reg_count+v_res_count+new.quantity>v_event.total_event_slots then
    raise exception 'event_capacity_exhausted' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function public.event_reservation_capacity_guard() from public,anon,authenticated;

create or replace function public.registration_event_capacity_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_event public.events%rowtype; v_reg_count bigint; v_res_count bigint;
  v_owner uuid; v_deadline timestamptz; v_place public.event_reservation_places%rowtype;
begin
  if new.status not in ('pending','paid') or
    (new.status='pending' and new.expires_at is not null and new.expires_at<=now()) then return new; end if;
  select * into v_event from public.events where id=new.event_id for update;
  if v_event.total_event_slots is null then return new; end if;
  if tg_op='UPDATE' and old.event_id=new.event_id and
    old.event_reservation_id is not distinct from new.event_reservation_id and
    old.participant_passport_id is not distinct from new.participant_passport_id and
    (old.status='paid' or (old.status='pending' and (old.expires_at is null or old.expires_at>now())))
  then return new; end if;
  if new.event_reservation_id is not null then
    select user_id,registration_deadline_at into v_owner,v_deadline from public.event_reservations
      where id=new.event_reservation_id and event_id=new.event_id and org_id=new.org_id and status='paid';
    if not found or v_owner<>new.booked_by_user_id or v_deadline<=now() then
      raise exception 'invalid_event_reservation' using errcode='23514';
    end if;
    select * into v_place from public.event_reservation_places
      where reservation_id=new.event_reservation_id and participant_passport_id=new.participant_passport_id;
    if found then
      if v_place.status<>'held' or v_place.event_id<>new.event_id or v_place.org_id<>new.org_id then
        raise exception 'invalid_event_reservation' using errcode='23514';
      end if;
    elsif exists (select 1 from public.event_reservation_places where reservation_id=new.event_reservation_id)
      or new.user_id is distinct from v_owner then
      raise exception 'invalid_event_reservation' using errcode='23514';
    end if;
  end if;
  select count(*) into v_reg_count from public.registrations r
    where r.event_id=new.event_id and r.id<>new.id and (r.status='paid' or
      (r.status='pending' and (r.expires_at is null or r.expires_at>now())));
  select coalesce(sum(case when exists (
      select 1 from public.event_reservation_places p where p.reservation_id=q.id
    ) then (
      select count(*) from public.event_reservation_places p
      where p.reservation_id=q.id and p.status='held'
        and (q.id<>coalesce(new.event_reservation_id,'00000000-0000-0000-0000-000000000000'::uuid)
          or p.participant_passport_id<>new.participant_passport_id)
        and not exists (select 1 from public.registrations r
          where r.event_reservation_id=q.id and r.id<>new.id
            and r.participant_passport_id=p.participant_passport_id
            and (r.status='paid' or (r.status='pending' and (r.expires_at is null or r.expires_at>now()))))
    ) else case when q.id=new.event_reservation_id or exists (
      select 1 from public.registrations r where r.event_reservation_id=q.id and r.id<>new.id
        and (r.status='paid' or (r.status='pending' and (r.expires_at is null or r.expires_at>now()))))
      then 0 else 1 end end),0)
    into v_res_count from public.event_reservations q
    where q.event_id=new.event_id and q.status in ('pending','paid','review_required');
  if v_reg_count+v_res_count+1>v_event.total_event_slots then
    raise exception 'event_capacity_exhausted' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function public.registration_event_capacity_guard() from public,anon,authenticated;

create or replace function public.coming_soon_event_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_active bigint; v_category_slots bigint; v_reg_count bigint; v_res_count bigint;
begin
  if new.status='coming_soon' and (
    nullif(trim(new.name),'') is null or nullif(trim(new.slug),'') is null or
    nullif(trim(new.hero_image_url),'') is null or nullif(trim(new.description),'') is null or
    new.discipline is null
  ) then raise exception 'coming_soon_fields_required' using errcode='23514'; end if;
  if tg_op='UPDATE' then
    if new.status='coming_soon' and old.status not in ('draft','coming_soon') and exists (
      select 1 from public.registrations r where r.event_id=new.id and r.status in ('pending','paid')
    ) then raise exception 'event_has_registrations' using errcode='23514'; end if;
    if old.status='coming_soon' and new.status in ('open','almost_full') and
      old.coming_soon_reserve_enabled and new.reservation_deadline_at<=now() then
      new.reservation_deadline_at := now()+interval '14 days';
    end if;
    if old.status='coming_soon' and new.status in ('open','almost_full') and old.coming_soon_reserve_enabled then
      select coalesce(sum(slots_total),0) into v_category_slots from public.categories where event_id=new.id;
      if v_category_slots<new.total_event_slots then
        raise exception 'event_categories_below_total_capacity' using errcode='23514';
      end if;
    end if;
    select count(*) into v_active from public.event_reservations
      where event_id=old.id and status in ('pending','paid','review_required');
    if new.total_event_slots is not null then
      select count(*) into v_reg_count from public.registrations r where r.event_id=new.id
        and (r.status='paid' or (r.status='pending' and (r.expires_at is null or r.expires_at>now())));
      select coalesce(sum(case when exists (
        select 1 from public.event_reservation_places p where p.reservation_id=q.id
      ) then (
        select count(*) from public.event_reservation_places p where p.reservation_id=q.id
          and p.status='held' and not exists (select 1 from public.registrations r
            where r.event_reservation_id=q.id and r.participant_passport_id=p.participant_passport_id
              and (r.status='paid' or (r.status='pending' and (r.expires_at is null or r.expires_at>now()))))
      ) else case when exists (select 1 from public.registrations r where r.event_reservation_id=q.id
        and (r.status='paid' or (r.status='pending' and (r.expires_at is null or r.expires_at>now()))))
        then 0 else 1 end end),0) into v_res_count
        from public.event_reservations q where q.event_id=new.id
          and q.status in ('pending','paid','review_required');
      if v_reg_count+v_res_count>new.total_event_slots then
        raise exception 'event_capacity_below_existing_places' using errcode='23514';
      end if;
    end if;
    if v_active>0 then
      if old.reservation_fee_cents is distinct from new.reservation_fee_cents or
         (old.coming_soon_reserve_enabled and not new.coming_soon_reserve_enabled) or
         (new.total_event_slots is not null and new.total_event_slots<old.total_event_slots) or
         (new.reservation_deadline_at is not null and new.reservation_deadline_at<old.reservation_deadline_at) then
        raise exception 'active_reservations_lock_settings' using errcode='23514';
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.coming_soon_event_guard() from public,anon,authenticated;

create function public.reserve_event_passports(
  p_event_id uuid,p_user_id uuid,p_idempotency_key uuid,p_provider text,p_passport_ids uuid[]
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_event public.events%rowtype; v_org public.organizations%rowtype;
  v_id uuid; v_fee integer; v_count bigint; v_email text; v_quantity integer;
  v_existing uuid[]; v_existing_quantity integer; v_passport uuid;
  v_record public.runner_passports%rowtype;
begin
  if p_provider not in ('paymongo','fake') then raise exception 'invalid_provider' using errcode='22023'; end if;
  v_quantity:=coalesce(array_length(p_passport_ids,1),0);
  if v_quantity<1 or v_quantity>10 or array_position(p_passport_ids,null) is not null or
    (select count(distinct x) from unnest(p_passport_ids) x)<>v_quantity
  then raise exception 'invalid_passports' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text||':'||p_idempotency_key::text,0));
  select id,quantity into v_id,v_existing_quantity from public.event_reservations
    where event_id=p_event_id and user_id=p_user_id and idempotency_key=p_idempotency_key;
  if found then
    select array_agg(participant_passport_id order by participant_passport_id) into v_existing
      from public.event_reservation_places where reservation_id=v_id;
    if (v_existing is distinct from (select array_agg(x order by x) from unnest(p_passport_ids) x)
      and not (v_existing is null and v_existing_quantity=1 and v_quantity=1
        and exists (select 1 from public.runner_passports p where p.id=p_passport_ids[1]
          and p.claimed_user_id=p_user_id)))
      or not exists (select 1 from public.reservation_payments
        where reservation_id=v_id and provider=p_provider)
    then raise exception 'idempotency_conflict' using errcode='22023'; end if;
    return v_id;
  end if;
  select * into v_event from public.events where id=p_event_id for update;
  if not found or v_event.status<>'coming_soon' or not v_event.coming_soon_reserve_enabled
    or v_event.reservation_deadline_at<=now() then
    raise exception 'reservations_not_open' using errcode='23514';
  end if;
  select * into v_org from public.organizations where id=v_event.org_id;
  if not v_org.is_active then raise exception 'org_suspended' using errcode='23514'; end if;
  select email into v_email from auth.users where id=p_user_id and email_confirmed_at is not null
    and not coalesce(is_anonymous,false);
  if v_email is null then raise exception 'verified_email_required' using errcode='23514'; end if;
  perform 1 from public.runner_passports p where p.id=any(p_passport_ids) order by p.id for share;
  perform 1 from public.passport_managers m where m.user_id=p_user_id and m.passport_id=any(p_passport_ids)
    order by m.passport_id for share;
  foreach v_passport in array p_passport_ids loop
    select * into v_record from public.runner_passports where id=v_passport;
    if not found or (v_record.claimed_user_id is distinct from p_user_id and
      (v_record.claimed_user_id is not null or not exists(select 1 from public.passport_managers m
        where m.passport_id=v_passport and m.user_id=p_user_id))) then
      raise exception 'participant_not_accessible' using errcode='42501';
    end if;
    if exists (select 1 from public.event_reservation_places p
      where p.event_id=p_event_id and p.participant_passport_id=v_passport and p.status='held') or
      exists (select 1 from public.registrations r
        where r.event_id=p_event_id and r.participant_passport_id=v_passport
          and (r.status='paid' or (r.status='pending' and
            (r.expires_at is null or r.expires_at>now())))) or
      exists (select 1 from public.event_reservations q
        where q.event_id=p_event_id and q.user_id=p_user_id
          and q.status in ('pending','paid','review_required')
          and not exists (select 1 from public.event_reservation_places p where p.reservation_id=q.id)
          and v_record.claimed_user_id=p_user_id) then
      raise exception 'participant_already_reserved' using errcode='23505';
    end if;
  end loop;
  select count(*) into v_count from public.registrations r where r.event_id=p_event_id
    and (r.status='paid' or (r.status='pending' and (r.expires_at is null or r.expires_at>now())));
  select v_count+coalesce(sum(case when exists (
      select 1 from public.event_reservation_places p where p.reservation_id=q.id
    ) then (
      select count(*) from public.event_reservation_places p where p.reservation_id=q.id
        and p.status='held' and not exists (select 1 from public.registrations r
          where r.event_reservation_id=q.id and r.participant_passport_id=p.participant_passport_id
            and (r.status='paid' or (r.status='pending' and (r.expires_at is null or r.expires_at>now()))))
    ) else case when exists (select 1 from public.registrations r where r.event_reservation_id=q.id
      and (r.status='paid' or (r.status='pending' and (r.expires_at is null or r.expires_at>now()))))
      then 0 else 1 end end),0) into v_count
    from public.event_reservations q where q.event_id=p_event_id
      and q.status in ('pending','paid','review_required');
  if v_count+v_quantity>v_event.total_event_slots then
    raise exception 'event_capacity_exhausted' using errcode='23514'; end if;
  v_fee:=case when v_org.reservation_commission_type='fixed'
    then v_org.reservation_commission_flat_cents
    else round(v_event.reservation_fee_cents*v_org.reservation_commission_rate)::integer end;
  if (v_event.reservation_fee_cents::bigint+v_fee)*v_quantity>2147483647 then
    raise exception 'reservation_amount_too_large' using errcode='22023'; end if;
  insert into public.event_reservations(
    org_id,event_id,user_id,email,idempotency_key,quantity,reservation_fee_cents,platform_fee_cents,
    registration_deadline_at,checkout_expires_at
  ) values (
    v_event.org_id,p_event_id,p_user_id,v_email,p_idempotency_key,v_quantity,
    v_event.reservation_fee_cents,v_fee,v_event.reservation_deadline_at,
    least(v_event.reservation_deadline_at,now()+interval '24 hours')
  ) returning id into v_id;
  insert into public.event_reservation_places(
    org_id,event_id,reservation_id,participant_passport_id,participant_name,is_managed
  ) select v_event.org_id,p_event_id,v_id,p.id,
      coalesce(nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),
        nullif(trim(p.legacy_full_name),''),
        case when p.claimed_user_id=p_user_id then 'My Race Passport' else 'Managed Race Passport' end),
      p.claimed_user_id is distinct from p_user_id
    from public.runner_passports p where p.id=any(p_passport_ids) order by p.id;
  insert into public.reservation_payments(
    org_id,event_id,reservation_id,provider,amount_cents,platform_fee_cents
  ) values (
    v_event.org_id,p_event_id,v_id,p_provider,
    (v_event.reservation_fee_cents+v_fee)*v_quantity,v_fee*v_quantity
  );
  return v_id;
end $$;
revoke all on function public.reserve_event_passports(uuid,uuid,uuid,text,uuid[])
  from public,anon,authenticated;
grant execute on function public.reserve_event_passports(uuid,uuid,uuid,text,uuid[])
  to service_role;

-- Old Edge clients keep a valid self-only reservation path during rollout.
create or replace function public.reserve_event_place(
  p_event_id uuid,p_user_id uuid,p_idempotency_key uuid,p_provider text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_passport uuid;
begin
  select id into v_passport from public.runner_passports where claimed_user_id=p_user_id;
  if v_passport is null then raise exception 'participant_not_accessible' using errcode='42501'; end if;
  return public.reserve_event_passports(p_event_id,p_user_id,p_idempotency_key,p_provider,array[v_passport]);
end $$;
revoke all on function public.reserve_event_place(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_event_place(uuid,uuid,uuid,text) to service_role;

create or replace function public.confirm_reservation_payment(
  p_reservation_id uuid,p_provider_ref text,p_provider_payment_id text,
  p_amount_cents integer,p_processor_fee_cents integer,p_provider_net_cents integer,
  p_method text,p_raw jsonb
) returns text language plpgsql security invoker set search_path = '' as $$
declare v_payment public.reservation_payments%rowtype; v_res public.event_reservations%rowtype;
  v_outcome text; v_base bigint;
begin
  select * into v_res from public.event_reservations where id=p_reservation_id for update;
  select * into v_payment from public.reservation_payments where reservation_id=p_reservation_id for update;
  if not found then raise exception 'reservation_payment_missing' using errcode='23503'; end if;
  if exists (select 1 from public.reservation_capture_events where provider_payment_id=p_provider_payment_id) then
    return case when v_payment.provider_payment_id=p_provider_payment_id and v_payment.status='paid'
      then 'already_paid' else 'review_required' end;
  end if;
  v_base:=(v_res.reservation_fee_cents::bigint+v_res.platform_fee_cents)*v_res.quantity;
  v_outcome:=case
    when v_payment.provider_ref is distinct from p_provider_ref or v_res.status not in ('pending','paid')
      or v_payment.status not in ('pending','paid') or v_payment.provider_payment_id is not null
      or p_amount_cents is null or p_processor_fee_cents is null or p_provider_net_cents is null
      or p_amount_cents<0 or p_processor_fee_cents<0 or p_provider_net_cents<0
      or p_amount_cents-p_processor_fee_cents<>p_provider_net_cents
      or p_provider_net_cents<v_base or p_provider_net_cents>v_base+1
    then 'review_required' else 'settled' end;
  insert into public.reservation_capture_events(
    provider_payment_id,reservation_id,provider_ref,amount_cents,processor_fee_cents,provider_net_cents,outcome,raw
  ) values (p_provider_payment_id,p_reservation_id,p_provider_ref,p_amount_cents,
    p_processor_fee_cents,p_provider_net_cents,v_outcome,p_raw);
  if v_outcome='review_required' then
    update public.event_reservations set status='review_required' where id=p_reservation_id and status='pending';
    update public.reservation_payments set status='review_required',raw=p_raw where id=v_payment.id and status='pending';
    return v_outcome;
  end if;
  update public.reservation_payments set status='paid',provider_payment_id=p_provider_payment_id,
    method=p_method,amount_cents=p_amount_cents,processor_fee_cents=p_processor_fee_cents,
    processor_fee_source='actual',net_to_org_cents=p_amount_cents-p_processor_fee_cents-v_res.platform_fee_cents*v_res.quantity,
    raw=p_raw,paid_at=now() where id=v_payment.id;
  update public.event_reservations set status='paid',paid_at=now() where id=p_reservation_id;
  return 'paid';
end $$;
revoke all on function public.confirm_reservation_payment(uuid,text,text,integer,integer,integer,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.confirm_reservation_payment(uuid,text,text,integer,integer,integer,text,jsonb)
  to service_role;

create or replace function public.convert_event_reservation_on_entry() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_res public.event_reservations%rowtype;
begin
  if old.status is distinct from 'paid' and new.status='paid' and new.event_reservation_id is not null then
    select * into v_res from public.event_reservations where id=new.event_reservation_id for update;
    if not found or v_res.event_id<>new.event_id or v_res.user_id<>new.booked_by_user_id
      or v_res.status<>'paid' then
      raise exception 'reservation_conversion_conflict' using errcode='23514'; end if;
    if exists (select 1 from public.event_reservation_places where reservation_id=v_res.id) then
      update public.event_reservation_places set status='converted',converted_at=now(),
        converted_registration_id=new.id where reservation_id=v_res.id
          and participant_passport_id=new.participant_passport_id and status='held';
      if not found then raise exception 'reservation_conversion_conflict' using errcode='23514'; end if;
      if not exists (select 1 from public.event_reservation_places
        where reservation_id=v_res.id and status='held') then
        update public.event_reservations set status='converted',converted_at=now() where id=v_res.id;
      end if;
    else
      update public.event_reservations set status='converted',converted_at=now()
        where id=v_res.id and status='paid';
      if not found then raise exception 'reservation_conversion_conflict' using errcode='23514'; end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.convert_event_reservation_on_entry() from public,anon,authenticated;

create or replace function public.confirm_reserved_registration_tx(
  p_registration_id uuid,p_method text,p_fee integer,p_net integer,p_token text,p_raw jsonb,
  p_processor_fee integer,p_processor_fee_predicted integer,p_processor_fee_source text,
  p_provider_paid_at timestamptz
) returns text language plpgsql security invoker set search_path = '' as $$
declare v_res public.event_reservations%rowtype; v_reg public.registrations%rowtype;
begin
  select * into v_reg from public.registrations where id=p_registration_id for update;
  if not found then return 'not_found'; end if;
  if v_reg.status='paid' then return 'already'; end if;
  select * into v_res from public.event_reservations where id=v_reg.event_reservation_id for update;
  if not found or v_res.status<>'paid' or v_res.user_id<>v_reg.booked_by_user_id
    or p_provider_paid_at is null or p_provider_paid_at>v_res.registration_deadline_at then
    return 'reservation_deadline_passed'; end if;
  if exists (select 1 from public.event_reservation_places where reservation_id=v_res.id)
    and not exists (select 1 from public.event_reservation_places
      where reservation_id=v_res.id and participant_passport_id=v_reg.participant_passport_id
        and status='held') then return 'reservation_deadline_passed'; end if;
  return public.confirm_payment_tx(p_registration_id,p_method,p_fee,p_net,p_token,p_raw,
    p_processor_fee,p_processor_fee_predicted,p_processor_fee_source);
end $$;
revoke all on function public.confirm_reserved_registration_tx(uuid,text,integer,integer,text,jsonb,integer,integer,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.confirm_reserved_registration_tx(uuid,text,integer,integer,text,jsonb,integer,integer,text,timestamptz)
  to service_role;

create or replace function public.expire_event_reservation(p_reservation_id uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare v_res public.event_reservations%rowtype; v_event public.events%rowtype;
  v_expired integer;
begin
  select * into v_res from public.event_reservations where id=p_reservation_id for update;
  if not found then return 'not_found'; end if;
  if v_res.status in ('expired','converted') then return 'already'; end if;
  if v_res.status='review_required' then return 'review_required'; end if;
  select * into v_event from public.events where id=v_res.event_id for update;
  if v_res.status='paid' and (v_event.status='coming_soon' or now()<=v_res.registration_deadline_at) then
    return 'not_due'; end if;
  if v_res.status='pending' and now()<=v_res.checkout_expires_at then return 'not_due'; end if;
  if exists (select 1 from public.event_reservation_places where reservation_id=v_res.id) then
    update public.event_reservation_places p set status='expired',expired_at=now()
      where p.reservation_id=v_res.id and p.status='held'
        and not exists (select 1 from public.registrations r
          where r.event_reservation_id=v_res.id and r.participant_passport_id=p.participant_passport_id
            and r.status in ('pending','paid'));
    get diagnostics v_expired=row_count;
    if exists (select 1 from public.event_reservation_places where reservation_id=v_res.id and status='held') then
      return case when v_expired>0 then 'partially_expired' else 'entry_unresolved' end;
    end if;
    update public.event_reservations set
      status=case when exists (select 1 from public.event_reservation_places
        where reservation_id=v_res.id and status='converted') then 'converted' else 'expired' end,
      converted_at=case when exists (select 1 from public.event_reservation_places
        where reservation_id=v_res.id and status='converted') then now() else converted_at end,
      expired_at=case when exists (select 1 from public.event_reservation_places
        where reservation_id=v_res.id and status='converted') then expired_at else now() end
      where id=v_res.id;
  else
    if exists (select 1 from public.registrations r where r.event_reservation_id=v_res.id
      and r.status in ('pending','paid')) then return 'entry_unresolved'; end if;
    update public.event_reservations set status='expired',expired_at=now() where id=v_res.id;
  end if;
  update public.reservation_payments set status='failed'
    where reservation_id=v_res.id and status='pending';
  return 'expired';
end $$;
revoke all on function public.expire_event_reservation(uuid) from public,anon,authenticated;
grant execute on function public.expire_event_reservation(uuid) to service_role;

-- Both ordinary and group entry creation pass through registrations. Attach a
-- paid place before the capacity guard runs, so a group's entries redeem their
-- own Passport places without an extra client-supplied reservation identity.
create function public.registration_attach_reserved_passport() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_reservation uuid;
begin
  if new.event_reservation_id is not null or new.participant_passport_id is null
    or new.booked_by_user_id is null then return new; end if;
  select r.id into v_reservation from public.event_reservations r
    join public.event_reservation_places p on p.reservation_id=r.id
    where r.event_id=new.event_id and r.org_id=new.org_id
      and r.user_id=new.booked_by_user_id and r.status='paid'
      and r.registration_deadline_at>now()
      and p.participant_passport_id=new.participant_passport_id and p.status='held'
    order by r.created_at,r.id limit 1 for update of r;
  if v_reservation is null then
    select r.id into v_reservation from public.event_reservations r
      where r.event_id=new.event_id and r.org_id=new.org_id
        and r.user_id=new.booked_by_user_id and r.status='paid'
        and r.registration_deadline_at>now()
        and new.user_id=new.booked_by_user_id
        and not exists (select 1 from public.event_reservation_places p where p.reservation_id=r.id)
      order by r.created_at,r.id limit 1 for update of r;
  end if;
  if v_reservation is not null then
    new.event_reservation_id:=v_reservation;
  elsif exists (select 1 from public.event_reservation_places p
    join public.event_reservations r on r.id=p.reservation_id
    where p.event_id=new.event_id and p.participant_passport_id=new.participant_passport_id
      and p.status='held' and r.status in ('pending','paid','review_required')) then
    raise exception 'participant_already_reserved' using errcode='23505';
  end if;
  return new;
end $$;
revoke all on function public.registration_attach_reserved_passport()
  from public,anon,authenticated;
create trigger x_registration_attach_reserved_passport before insert on public.registrations
  for each row execute function public.registration_attach_reserved_passport();


-- Group booking capture shares the same paid-before-deadline rule as single entry.
create or replace function public.booking_payment_confirm(p_attempt uuid,p_capture jsonb,p_tokens jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare a public.booking_payment_attempts%rowtype; o public.booking_orders%rowtype; d public.booking_payment_dispatches%rowtype;
  c public.booking_payment_captures%rowtype; v_n integer; v_reason text; v_fee integer;
  v_provider_managed boolean; v_excess integer:=0; v_reserved_paid_at timestamptz;
begin
  select * into a from public.booking_payment_attempts where id=p_attempt;
  if not found then raise exception 'attempt_not_found' using errcode='22023'; end if;
  select * into o from public.booking_orders where id=a.booking_order_id;
  perform 1 from public.categories cat where cat.id in
    (select distinct r.category_id from public.registrations r where r.booking_order_id=o.id)
    order by cat.id for update;
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
      < a.gross_cents::bigint or (p_capture->>'amount')::bigint-(p_capture->>'feeCents')::bigint>a.gross_cents::bigint+1))
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
  if v_reason is null and exists(
    select 1 from public.categories cat
    join (select category_id,count(*)::integer needed from public.registrations where booking_order_id=o.id group by category_id) wanted
      on wanted.category_id=cat.id
    where (select count(*) from public.registrations other where other.category_id=cat.id
      and other.booking_order_id is distinct from o.id and (other.status='paid' or
        (other.status='pending' and (other.expires_at is null or other.expires_at>statement_timestamp()))))
      +wanted.needed>cat.slots_total)
  then v_reason:='capacity_unavailable'; end if;
  -- Group fulfillment must use the provider's capture time for every held
  -- Passport place. Without a verified paidAt, reconcile instead of issuing
  -- tickets after a reservation deadline.
  if v_reason is null and exists (
    select 1 from public.registrations r where r.booking_order_id=o.id
      and r.event_reservation_id is not null
  ) then
    if coalesce(p_capture->>'paidAt','') !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      v_reason:='reservation_capture_time_missing';
    else
      begin
        v_reserved_paid_at:=(p_capture->>'paidAt')::timestamptz;
      exception when invalid_datetime_format or datetime_field_overflow then
        v_reason:='invalid_capture_time';
      end;
    end if;
    if v_reason is null and exists (
      select 1 from public.registrations r
        left join public.event_reservations er on er.id=r.event_reservation_id
        where r.booking_order_id=o.id and r.event_reservation_id is not null
          and (er.id is null or er.status<>'paid' or er.user_id<>o.booked_by_user_id
            or v_reserved_paid_at>er.registration_deadline_at
            or (exists (select 1 from public.event_reservation_places p
                  where p.reservation_id=er.id)
              and not exists (select 1 from public.event_reservation_places p
                where p.reservation_id=er.id and p.participant_passport_id=r.participant_passport_id
                  and p.status='held')))
    ) then v_reason:='reservation_deadline_passed'; end if;
  end if;
  if v_reason is null and (jsonb_typeof(p_tokens) is distinct from 'object' or
    exists(select 1 from public.booking_payment_quote_lines where attempt_id=a.id and coalesce(length(p_tokens->>registration_id::text),0)<20))
  then raise exception 'ticket_tokens_required' using errcode='22023'; end if;
  v_fee:=(p_capture->>'feeCents')::integer;
  if v_reason is null and (v_fee is null or v_fee<0 or v_fee>(p_capture->>'amount')::bigint)
  then v_reason:='invalid_processor_fee'; end if;
  if v_reason is null and v_provider_managed then v_excess:=(p_capture->>'amount')::integer-v_fee-a.gross_cents; end if;
  if v_reason is null then
    begin
      update public.registrations set status='paid',expires_at=null,ticket_token=p_tokens->>id::text where booking_order_id=o.id;
      with used as (select category_id,count(*)::integer n from public.registrations where booking_order_id=o.id group by category_id)
      update public.categories cat set slots_taken=cat.slots_taken+used.n from used where cat.id=used.category_id;
      with parts as (
        select q.*,case when a.gross_cents=0 then 0 else v_fee::bigint*q.gross_cents/a.gross_cents end part,
          case when a.gross_cents=0 then 0 else v_fee::bigint*q.gross_cents%a.gross_cents end rem
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
    exception when unique_violation or check_violation then v_reason:='fulfillment_conflict';
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
