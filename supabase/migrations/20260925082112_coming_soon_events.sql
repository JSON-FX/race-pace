-- A reservation is its own sale. It does not issue a race ticket and its fee
-- is not a deposit against the later registration.
alter table public.events
  add column coming_soon_notify_enabled boolean not null default false,
  add column coming_soon_reserve_enabled boolean not null default false,
  add column reservation_fee_cents integer check (reservation_fee_cents > 0),
  add column reservation_deadline_at timestamptz,
  add column total_event_slots integer check (total_event_slots > 0),
  add constraint coming_soon_reservation_settings check (
    not coming_soon_reserve_enabled or
    (reservation_fee_cents is not null and reservation_deadline_at is not null and total_event_slots is not null)
  );

alter table public.organizations
  add column reservation_commission_type text not null default 'fixed'
    check (reservation_commission_type in ('percent','fixed')),
  add column reservation_commission_rate numeric(5,4) not null default 0
    check (reservation_commission_rate between 0 and 1),
  add column reservation_commission_flat_cents integer not null default 0
    check (reservation_commission_flat_cents >= 0);

-- organizations has column-scoped UPDATE grants. RLS alone cannot restrict a
-- commercial column because the branding policy also grants an org admin
-- UPDATE access to their own row.
grant update (reservation_commission_type,reservation_commission_rate,reservation_commission_flat_cents)
  on public.organizations to authenticated;

create function public.guard_reservation_commission_terms() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if (new.reservation_commission_type,new.reservation_commission_rate,new.reservation_commission_flat_cents)
     is not distinct from
     (old.reservation_commission_type,old.reservation_commission_rate,old.reservation_commission_flat_cents)
  then return new; end if;
  if public.auth_is_super_admin() or exists (
    select 1 from pg_catalog.pg_roles r where r.rolname=current_user and (r.rolbypassrls or r.rolsuper)
  ) then return new; end if;
  raise exception 'reservation commission is a platform term' using errcode='42501';
end $$;
revoke all on function public.guard_reservation_commission_terms() from public,anon,authenticated;
create trigger organizations_reservation_commission_guard
before update of reservation_commission_type,reservation_commission_rate,reservation_commission_flat_cents
on public.organizations for each row execute function public.guard_reservation_commission_terms();

create table public.event_reservations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  event_id uuid not null references public.events(id),
  user_id uuid not null references auth.users(id),
  email text not null,
  idempotency_key uuid not null,
  status text not null default 'pending' check (status in ('pending','paid','converted','expired','review_required')),
  reservation_fee_cents integer not null check (reservation_fee_cents > 0),
  platform_fee_cents integer not null check (platform_fee_cents >= 0),
  registration_deadline_at timestamptz not null,
  checkout_expires_at timestamptz not null,
  paid_at timestamptz,
  converted_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id,event_id,idempotency_key)
);
create unique index event_reservation_one_active_per_runner
  on public.event_reservations(user_id,event_id)
  where status in ('pending','paid','review_required');
create index event_reservations_event_active
  on public.event_reservations(event_id,status);
create index event_reservations_user on public.event_reservations(user_id,created_at desc);

create table public.reservation_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  event_id uuid not null references public.events(id),
  reservation_id uuid not null unique references public.event_reservations(id),
  provider text not null check (provider in ('paymongo','fake')),
  status text not null default 'pending' check (status in ('pending','paid','failed','review_required')),
  provider_ref text unique,
  provider_payment_id text unique,
  checkout_url text,
  checkout_request jsonb,
  method text,
  amount_cents integer not null check (amount_cents >= 0),
  platform_fee_cents integer not null check (platform_fee_cents >= 0),
  processor_fee_cents integer check (processor_fee_cents >= 0),
  net_to_org_cents integer,
  processor_fee_source text not null default 'none'
    check (processor_fee_source in ('none','actual','predicted')),
  raw jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'paid' or
    (processor_fee_cents is not null and net_to_org_cents is not null and
     net_to_org_cents = amount_cents - processor_fee_cents - platform_fee_cents))
);

create table public.coming_soon_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  event_id uuid not null references public.events(id),
  user_id uuid not null references auth.users(id),
  email text not null,
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  unique (event_id,user_id)
);
create index coming_soon_subscriptions_event on public.coming_soon_subscriptions(event_id,notified_at);

alter table public.registrations add column event_reservation_id uuid
  references public.event_reservations(id);
create unique index registrations_one_active_per_event_reservation
  on public.registrations(event_reservation_id) where event_reservation_id is not null
  and status in ('pending','paid');

alter table public.event_reservations enable row level security;
alter table public.reservation_payments enable row level security;
alter table public.coming_soon_subscriptions enable row level security;
revoke all on public.event_reservations,public.reservation_payments,public.coming_soon_subscriptions
  from public,anon,authenticated;
grant select on public.event_reservations,public.reservation_payments,public.coming_soon_subscriptions
  to authenticated;
grant all on public.event_reservations,public.reservation_payments,public.coming_soon_subscriptions
  to service_role;
grant update (event_reservation_id) on public.registrations to service_role;
create policy event_reservations_read on public.event_reservations for select to authenticated
  using (user_id=(select auth.uid()) or public.auth_can_admin_org(org_id));
create policy reservation_payments_read on public.reservation_payments for select to authenticated
  using (exists (select 1 from public.event_reservations r
    where r.id=reservation_id and (r.user_id=(select auth.uid()) or public.auth_can_admin_org(r.org_id))));
create policy coming_soon_subscriptions_read on public.coming_soon_subscriptions for select to authenticated
  using (user_id=(select auth.uid()) or public.auth_can_admin_org(org_id));

-- The event row is the common serialization point for category registrations
-- and early reservations. Category capacity remains independently enforced.
create function public.event_reservation_capacity_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_event public.events%rowtype; v_reg_count bigint; v_res_count bigint;
begin
  select * into v_event from public.events where id=new.event_id for update;
  if not found or v_event.org_id<>new.org_id then
    raise exception 'reservation_event_scope_mismatch' using errcode='23514';
  end if;
  if tg_op='UPDATE' and (new.org_id,new.event_id,new.user_id,new.idempotency_key)
     is distinct from (old.org_id,old.event_id,old.user_id,old.idempotency_key) then
    raise exception 'reservation_identity_immutable' using errcode='23514';
  end if;
  if new.status not in ('pending','paid','review_required') then return new; end if;
  if tg_op='UPDATE' and old.status in ('pending','paid','review_required') then return new; end if;
  if v_event.status <> 'coming_soon' or not v_event.coming_soon_reserve_enabled then
    raise exception 'reservations_not_open' using errcode='23514';
  end if;
  if v_event.reservation_deadline_at<=now() then
    raise exception 'reservation_deadline_passed' using errcode='23514';
  end if;
  select count(*) into v_reg_count from public.registrations r
    where r.event_id=new.event_id and (r.status='paid' or
      (r.status='pending' and (r.expires_at is null or r.expires_at>now())));
  select count(*) into v_res_count from public.event_reservations q
    where q.event_id=new.event_id and q.id<>new.id
      and q.status in ('pending','paid','review_required')
      and not exists (select 1 from public.registrations r
        where r.event_reservation_id=q.id and (r.status='paid' or
          (r.status='pending' and (r.expires_at is null or r.expires_at>now()))));
  if v_reg_count+v_res_count>=v_event.total_event_slots then
    raise exception 'event_capacity_exhausted' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function public.event_reservation_capacity_guard() from public,anon,authenticated;
create trigger event_reservation_capacity before insert or update on public.event_reservations
  for each row execute function public.event_reservation_capacity_guard();

create function public.registration_event_capacity_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_event public.events%rowtype; v_reg_count bigint; v_res_count bigint; v_owner uuid;
  v_deadline timestamptz;
begin
  if new.status not in ('pending','paid') or
    (new.status='pending' and new.expires_at is not null and new.expires_at<=now()) then return new; end if;
  select * into v_event from public.events where id=new.event_id for update;
  if v_event.total_event_slots is null then return new; end if;
  if tg_op='UPDATE' and old.event_id=new.event_id and
    old.event_reservation_id is not distinct from new.event_reservation_id and
    (old.status='paid' or (old.status='pending' and (old.expires_at is null or old.expires_at>now())))
  then return new; end if;
  if new.event_reservation_id is not null then
    select user_id,registration_deadline_at into v_owner,v_deadline from public.event_reservations
      where id=new.event_reservation_id and event_id=new.event_id and org_id=new.org_id and status='paid';
    if not found or v_owner<>new.user_id or v_deadline<=now() then
      raise exception 'invalid_event_reservation' using errcode='23514';
    end if;
  end if;
  select count(*) into v_reg_count from public.registrations r
    where r.event_id=new.event_id and r.id<>new.id and (r.status='paid' or
      (r.status='pending' and (r.expires_at is null or r.expires_at>now())));
  select count(*) into v_res_count from public.event_reservations q
    where q.event_id=new.event_id and q.id<>coalesce(new.event_reservation_id,'00000000-0000-0000-0000-000000000000'::uuid)
      and q.status in ('pending','paid','review_required')
      and not exists (select 1 from public.registrations r
        where r.event_reservation_id=q.id and r.id<>new.id and (r.status='paid' or
          (r.status='pending' and (r.expires_at is null or r.expires_at>now()))));
  if v_reg_count+v_res_count>=v_event.total_event_slots then
    raise exception 'event_capacity_exhausted' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function public.registration_event_capacity_guard() from public,anon,authenticated;
create trigger zy_registration_event_capacity before insert or update on public.registrations
  for each row execute function public.registration_event_capacity_guard();

-- This function owns the reservation and its frozen commercial terms in one
-- transaction. A second request with the same key returns the first row.
create function public.reserve_event_place(p_event_id uuid,p_user_id uuid,p_idempotency_key uuid,
  p_provider text) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_event public.events%rowtype; v_org public.organizations%rowtype;
  v_id uuid; v_fee integer; v_count bigint; v_email text;
begin
  if p_provider not in ('paymongo','fake') then raise exception 'invalid_provider' using errcode='22023'; end if;
  select id into v_id from public.event_reservations
    where event_id=p_event_id and user_id=p_user_id and idempotency_key=p_idempotency_key;
  if found then return v_id; end if;
  select * into v_event from public.events where id=p_event_id for update;
  if not found or v_event.status<>'coming_soon' or not v_event.coming_soon_reserve_enabled
    or v_event.reservation_deadline_at<=now() then
    raise exception 'reservations_not_open' using errcode='23514';
  end if;
  select * into v_org from public.organizations where id=v_event.org_id;
  if not v_org.is_active then raise exception 'org_suspended' using errcode='23514'; end if;
  select email into v_email from auth.users where id=p_user_id and email_confirmed_at is not null;
  if v_email is null then raise exception 'verified_email_required' using errcode='23514'; end if;
  select count(*) into v_count from public.registrations r where r.event_id=p_event_id
    and (r.status='paid' or (r.status='pending' and (r.expires_at is null or r.expires_at>now())));
  select v_count+count(*) into v_count from public.event_reservations q where q.event_id=p_event_id
    and q.status in ('pending','paid','review_required')
    and not exists (select 1 from public.registrations r where r.event_reservation_id=q.id
      and (r.status='paid' or (r.status='pending' and (r.expires_at is null or r.expires_at>now()))));
  if v_count>=v_event.total_event_slots then raise exception 'event_capacity_exhausted' using errcode='23514'; end if;
  v_fee := case when v_org.reservation_commission_type='fixed'
    then v_org.reservation_commission_flat_cents
    else round(v_event.reservation_fee_cents * v_org.reservation_commission_rate)::integer end;
  insert into public.event_reservations(
    org_id,event_id,user_id,email,idempotency_key,reservation_fee_cents,platform_fee_cents,
    registration_deadline_at,checkout_expires_at
  ) values (
    v_event.org_id,p_event_id,p_user_id,v_email,p_idempotency_key,v_event.reservation_fee_cents,v_fee,
    v_event.reservation_deadline_at,least(v_event.reservation_deadline_at,now()+interval '24 hours')
  ) returning id into v_id;
  insert into public.reservation_payments(
    org_id,event_id,reservation_id,provider,amount_cents,platform_fee_cents
  ) values (
    v_event.org_id,p_event_id,v_id,p_provider,v_event.reservation_fee_cents+v_fee,v_fee
  );
  return v_id;
exception when unique_violation then
  select id into v_id from public.event_reservations
    where event_id=p_event_id and user_id=p_user_id and idempotency_key=p_idempotency_key;
  if v_id is not null then return v_id; end if;
  raise;
end $$;
revoke all on function public.reserve_event_place(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_event_place(uuid,uuid,uuid,text) to service_role;

create function public.release_rejected_reservation_checkout(p_reservation_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_payment public.reservation_payments%rowtype;
begin
  select * into v_payment from public.reservation_payments
    where reservation_id=p_reservation_id for update;
  if not found or v_payment.status<>'pending' or v_payment.provider_ref is not null then return false; end if;
  update public.reservation_payments set status='failed' where id=v_payment.id;
  update public.event_reservations set status='expired',expired_at=now()
    where id=p_reservation_id and status='pending';
  return found;
end $$;
revoke all on function public.release_rejected_reservation_checkout(uuid) from public,anon,authenticated;
grant execute on function public.release_rejected_reservation_checkout(uuid) to service_role;

create table public.reservation_capture_events (
  provider_payment_id text primary key,
  reservation_id uuid references public.event_reservations(id),
  provider_ref text,
  amount_cents integer,
  processor_fee_cents integer,
  provider_net_cents integer,
  outcome text not null check (outcome in ('settled','duplicate','review_required')),
  raw jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.reservation_capture_events enable row level security;
revoke all on public.reservation_capture_events from public,anon,authenticated;
grant all on public.reservation_capture_events to service_role;

create function public.confirm_reservation_payment(
  p_reservation_id uuid,p_provider_ref text,p_provider_payment_id text,
  p_amount_cents integer,p_processor_fee_cents integer,p_provider_net_cents integer,
  p_method text,p_raw jsonb
) returns text
language plpgsql security invoker set search_path = '' as $$
declare v_payment public.reservation_payments%rowtype; v_res public.event_reservations%rowtype;
  v_outcome text;
begin
  select * into v_res from public.event_reservations where id=p_reservation_id for update;
  select * into v_payment from public.reservation_payments where reservation_id=p_reservation_id for update;
  if not found then raise exception 'reservation_payment_missing' using errcode='23503'; end if;
  if exists (select 1 from public.reservation_capture_events where provider_payment_id=p_provider_payment_id) then
    return case when v_payment.provider_payment_id=p_provider_payment_id and v_payment.status='paid'
      then 'already_paid' else 'review_required' end;
  end if;
  v_outcome := case
    when v_payment.provider_ref is distinct from p_provider_ref or v_res.status not in ('pending','paid')
      or v_payment.status not in ('pending','paid') or v_payment.provider_payment_id is not null
      or p_amount_cents is null or p_processor_fee_cents is null or p_provider_net_cents is null
      or p_amount_cents<0 or p_processor_fee_cents<0 or p_provider_net_cents<0
      or p_amount_cents-p_processor_fee_cents<>p_provider_net_cents
      or p_provider_net_cents<v_res.reservation_fee_cents+v_res.platform_fee_cents
      or p_provider_net_cents>v_res.reservation_fee_cents+v_res.platform_fee_cents+1
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
    processor_fee_source='actual',net_to_org_cents=p_amount_cents-p_processor_fee_cents-v_res.platform_fee_cents,
    raw=p_raw,paid_at=now() where id=v_payment.id;
  update public.event_reservations set status='paid',paid_at=now() where id=p_reservation_id;
  return 'paid';
end $$;
revoke all on function public.confirm_reservation_payment(uuid,text,text,integer,integer,integer,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.confirm_reservation_payment(uuid,text,text,integer,integer,integer,text,jsonb)
  to service_role;

-- Teaser publication has a smaller contract than opening registration. Once
-- somebody has an active hold, the accepted price and capacity cannot shrink.
create function public.coming_soon_event_guard() returns trigger
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
      select count(*) into v_res_count from public.event_reservations q
        where q.event_id=new.id and q.status in ('pending','paid','review_required')
        and not exists (select 1 from public.registrations r where r.event_reservation_id=q.id
          and (r.status='paid' or (r.status='pending' and (r.expires_at is null or r.expires_at>now()))));
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
create trigger coming_soon_event_guard before insert or update on public.events
  for each row execute function public.coming_soon_event_guard();

create function public.subscribe_coming_soon(p_event_id uuid,p_user_id uuid,p_email text)
returns text language plpgsql security invoker set search_path = '' as $$
declare v_event public.events%rowtype; v_inserted uuid;
begin
  select * into v_event from public.events where id=p_event_id for update;
  if not found or v_event.status<>'coming_soon' or not v_event.coming_soon_notify_enabled then
    raise exception 'notifications_not_open' using errcode='23514';
  end if;
  if not exists (select 1 from auth.users where id=p_user_id and email=p_email and email_confirmed_at is not null) then
    raise exception 'verified_email_required' using errcode='23514';
  end if;
  insert into public.coming_soon_subscriptions(org_id,event_id,user_id,email)
    values (v_event.org_id,p_event_id,p_user_id,p_email)
    on conflict (event_id,user_id) do nothing returning id into v_inserted;
  return case when v_inserted is null then 'already' else 'created' end;
end $$;
revoke all on function public.subscribe_coming_soon(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.subscribe_coming_soon(uuid,uuid,text) to service_role;

alter table public.transactional_email_jobs
  drop constraint transactional_email_jobs_type_check,
  add constraint transactional_email_jobs_type_check check (type in (
    'event_rescheduled','event_cancelled','event_updated','payment_failed','payment_expiring',
    'coming_soon_opened','reservation_paid'
  )),
  add column event_reservation_id uuid references public.event_reservations(id);

create function public.coming_soon_opening_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status='coming_soon' and new.status in ('open','almost_full') then
    if new.reservation_deadline_at is distinct from old.reservation_deadline_at then
      update public.event_reservations set registration_deadline_at=new.reservation_deadline_at
        where event_id=new.id and status in ('pending','paid','review_required');
    end if;
    insert into public.transactional_email_jobs(type,user_id,event_id,dedup_key)
      select 'coming_soon_opened',s.user_id,new.id,'coming_soon_opened:'||new.id::text||':'||s.user_id::text
      from public.coming_soon_subscriptions s where s.event_id=new.id
      on conflict (dedup_key) do nothing;
  elsif new.reservation_deadline_at>old.reservation_deadline_at then
    update public.event_reservations set registration_deadline_at=new.reservation_deadline_at
      where event_id=new.id and status in ('pending','paid','review_required');
  end if;
  return new;
end $$;
revoke all on function public.coming_soon_opening_email() from public,anon,authenticated;
create trigger z_coming_soon_opening_email after update of status,reservation_deadline_at on public.events
  for each row execute function public.coming_soon_opening_email();

create function public.coming_soon_receipt_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status<>'paid' and new.status='paid' then
    insert into public.transactional_email_jobs(
      type,user_id,event_id,event_reservation_id,dedup_key
    ) values ('reservation_paid',new.user_id,new.event_id,new.id,'reservation_paid:'||new.id::text)
    on conflict (dedup_key) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.coming_soon_receipt_email() from public,anon,authenticated;
create trigger coming_soon_receipt_email after update of status on public.event_reservations
  for each row execute function public.coming_soon_receipt_email();

-- A captured registration payment consumes the same held event place. The
-- reservation charge remains in its own ledger; only the place converts.
create function public.convert_event_reservation_on_entry() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status is distinct from 'paid' and new.status='paid' and new.event_reservation_id is not null then
    update public.event_reservations set status='converted',converted_at=now()
      where id=new.event_reservation_id and event_id=new.event_id and user_id=new.user_id and status='paid';
    if not found then raise exception 'reservation_conversion_conflict' using errcode='23514'; end if;
  end if;
  return new;
end $$;
revoke all on function public.convert_event_reservation_on_entry() from public,anon,authenticated;
create trigger convert_event_reservation_on_entry after update of status on public.registrations
  for each row execute function public.convert_event_reservation_on_entry();

-- The provider's captured timestamp, rather than webhook arrival time,
-- decides whether entry payment met the organizer's deadline.
create function public.confirm_reserved_registration_tx(
  p_registration_id uuid,p_method text,p_fee integer,p_net integer,p_token text,p_raw jsonb,
  p_processor_fee integer,p_processor_fee_predicted integer,p_processor_fee_source text,
  p_provider_paid_at timestamptz
) returns text language plpgsql security invoker set search_path = '' as $$
declare v_res public.event_reservations%rowtype; v_status public.registration_status;
begin
  select r.status into v_status from public.registrations r where r.id=p_registration_id for update;
  if not found then return 'not_found'; end if;
  if v_status='paid' then return 'already'; end if;
  select er.* into v_res from public.event_reservations er
    join public.registrations r on r.event_reservation_id=er.id
    where r.id=p_registration_id for update of er;
  if not found or v_res.status<>'paid' or p_provider_paid_at is null or
     p_provider_paid_at>v_res.registration_deadline_at then
    return 'reservation_deadline_passed';
  end if;
  return public.confirm_payment_tx(p_registration_id,p_method,p_fee,p_net,p_token,p_raw,
    p_processor_fee,p_processor_fee_predicted,p_processor_fee_source);
end $$;
revoke all on function public.confirm_reserved_registration_tx(uuid,text,integer,integer,text,jsonb,integer,integer,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.confirm_reserved_registration_tx(uuid,text,integer,integer,text,jsonb,integer,integer,text,timestamptz)
  to service_role;

-- Called only after the worker has checked or expired every provider session.
-- A pending entry checkout must be closed before its reservation can release.
create function public.expire_event_reservation(p_reservation_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare v_res public.event_reservations%rowtype; v_event public.events%rowtype;
begin
  select * into v_res from public.event_reservations where id=p_reservation_id for update;
  if not found then return 'not_found'; end if;
  if v_res.status in ('expired','converted') then return 'already'; end if;
  if v_res.status='review_required' then return 'review_required'; end if;
  select * into v_event from public.events where id=v_res.event_id for update;
  if exists (select 1 from public.registrations r where r.event_reservation_id=v_res.id
    and r.status in ('pending','paid')) then return 'entry_unresolved'; end if;
  if v_res.status='paid' and (v_event.status='coming_soon' or now()<=v_res.registration_deadline_at) then
    return 'not_due';
  end if;
  if v_res.status='pending' and now()<=v_res.checkout_expires_at then return 'not_due'; end if;
  update public.event_reservations set status='expired',expired_at=now() where id=v_res.id;
  update public.reservation_payments set status='failed'
    where reservation_id=v_res.id and status='pending';
  return 'expired';
end $$;
revoke all on function public.expire_event_reservation(uuid) from public,anon,authenticated;
grant execute on function public.expire_event_reservation(uuid) to service_role;

create function public.coming_soon_expiry_candidates(p_limit integer default 50)
returns setof uuid language sql security invoker set search_path = '' as $$
  select r.id from public.event_reservations r
  join public.events e on e.id=r.event_id
  where (r.status='pending' and r.checkout_expires_at<=now()) or
    (r.status='paid' and r.registration_deadline_at<=now() and e.status<>'coming_soon')
  order by r.created_at,r.id
  limit greatest(1,least(coalesce(p_limit,50),100));
$$;
revoke all on function public.coming_soon_expiry_candidates(integer) from public,anon,authenticated;
grant execute on function public.coming_soon_expiry_candidates(integer) to service_role;

create function public.coming_soon_email_claim(p_limit integer default 20)
returns setof public.transactional_email_jobs
language sql security invoker set search_path = '' as $$
  with candidates as (
    select id from public.transactional_email_jobs
    where type in ('coming_soon_opened','reservation_paid') and sent_at is null and attempts<5
      and available_at<=now() and (lease_expires_at is null or lease_expires_at<=now())
    order by created_at,id for update skip locked
    limit greatest(1,least(coalesce(p_limit,20),50))
  )
  update public.transactional_email_jobs j set
    lease_token=gen_random_uuid(),lease_expires_at=now()+interval '5 minutes',attempts=j.attempts+1
  from candidates c where j.id=c.id returning j.*;
$$;
revoke all on function public.coming_soon_email_claim(integer) from public,anon,authenticated;
grant execute on function public.coming_soon_email_claim(integer) to service_role;

-- Reservation charges have a separate sale ledger, so their organizer payout
-- must also have a statement that cannot silently disappear from entry-only
-- payout aggregation. No reservation payout can be recorded before race end.
create table public.reservation_payout_statements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  event_id uuid not null unique references public.events(id),
  status text not null default 'open' check (status in ('open','paid')),
  revision integer not null default 1,
  payment_count integer not null check (payment_count>0),
  gross_cents bigint not null,
  platform_fee_cents bigint not null,
  processor_fee_cents bigint not null,
  net_to_org_cents bigint not null,
  reference text,
  note text,
  opened_at timestamptz not null default now(),
  paid_at timestamptz,
  check (net_to_org_cents=gross_cents-platform_fee_cents-processor_fee_cents)
);
alter table public.reservation_payments add column payout_statement_id uuid
  references public.reservation_payout_statements(id);
create index reservation_payments_payout_statement on public.reservation_payments(payout_statement_id);
alter table public.reservation_payout_statements enable row level security;
revoke all on public.reservation_payout_statements from public,anon,authenticated;
grant select on public.reservation_payout_statements to authenticated;
grant all on public.reservation_payout_statements to service_role;
create policy reservation_payout_statements_super_admin on public.reservation_payout_statements
  for select to authenticated using (public.auth_is_super_admin());

create function public.reservation_payout_open(p_event_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_event public.events%rowtype; v_count integer; v_gross bigint; v_fee bigint;
  v_processor bigint; v_net bigint; v_id uuid;
begin
  if not public.auth_is_super_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_event from public.events where id=p_event_id for update;
  if not found then raise exception 'event_not_found' using errcode='23503'; end if;
  if v_event.status<>'completed' and (coalesce(v_event.end_date,v_event.event_date) is null or
    coalesce(v_event.end_date,v_event.event_date)>=(now() at time zone 'Asia/Manila')::date) then
    raise exception 'event_unfinished' using errcode='23514';
  end if;
  lock table public.reservation_payments in share row exclusive mode;
  if exists (select 1 from public.reservation_payments p where p.event_id=p_event_id
    and p.status in ('pending','review_required')) or
    exists (select 1 from public.reservation_capture_events c
      where c.reservation_id in (select id from public.event_reservations where event_id=p_event_id)
      and c.outcome<>'settled') then
    raise exception 'reservation_reconciliation_required' using errcode='23514';
  end if;
  select count(*)::integer,coalesce(sum(amount_cents),0),coalesce(sum(platform_fee_cents),0),
    coalesce(sum(processor_fee_cents),0),coalesce(sum(net_to_org_cents),0)
    into v_count,v_gross,v_fee,v_processor,v_net
    from public.reservation_payments where event_id=p_event_id and status='paid' and payout_statement_id is null;
  if v_count=0 then raise exception 'no_unsettled_reservations' using errcode='23514'; end if;
  insert into public.reservation_payout_statements(
    org_id,event_id,payment_count,gross_cents,platform_fee_cents,processor_fee_cents,net_to_org_cents
  ) values (v_event.org_id,p_event_id,v_count,v_gross,v_fee,v_processor,v_net)
    returning id into v_id;
  return v_id;
end $$;
revoke all on function public.reservation_payout_open(uuid) from public,anon,authenticated;
grant execute on function public.reservation_payout_open(uuid) to authenticated,service_role;

create function public.reservation_payout_refresh(p_statement_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_statement public.reservation_payout_statements%rowtype; v_count integer;
  v_gross bigint; v_fee bigint; v_processor bigint; v_net bigint;
begin
  if not public.auth_is_super_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_statement from public.reservation_payout_statements where id=p_statement_id for update;
  if not found then return 'not_found'; end if;
  if v_statement.status<>'open' then return 'already'; end if;
  lock table public.reservation_payments in share row exclusive mode;
  if exists (select 1 from public.reservation_payments p where p.event_id=v_statement.event_id
    and p.status in ('pending','review_required')) or
    exists (select 1 from public.reservation_capture_events c
      where c.reservation_id in (select id from public.event_reservations where event_id=v_statement.event_id)
      and c.outcome<>'settled') then return 'unreconciled'; end if;
  select count(*)::integer,coalesce(sum(amount_cents),0),coalesce(sum(platform_fee_cents),0),
    coalesce(sum(processor_fee_cents),0),coalesce(sum(net_to_org_cents),0)
    into v_count,v_gross,v_fee,v_processor,v_net from public.reservation_payments
    where event_id=v_statement.event_id and status='paid' and payout_statement_id is null;
  if v_count=0 then return 'empty'; end if;
  update public.reservation_payout_statements set revision=revision+1,payment_count=v_count,
    gross_cents=v_gross,platform_fee_cents=v_fee,processor_fee_cents=v_processor,net_to_org_cents=v_net
    where id=p_statement_id;
  return 'refreshed';
end $$;
revoke all on function public.reservation_payout_refresh(uuid) from public,anon,authenticated;
grant execute on function public.reservation_payout_refresh(uuid) to authenticated,service_role;

create function public.reservation_payout_mark_paid(
  p_statement_id uuid,p_expected_revision integer,p_reference text,p_note text
) returns text language plpgsql security definer set search_path = '' as $$
declare v_statement public.reservation_payout_statements%rowtype; v_count integer;
  v_gross bigint; v_fee bigint; v_processor bigint; v_net bigint;
begin
  if not public.auth_is_super_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if nullif(trim(p_reference),'') is null then return 'reference_required'; end if;
  select * into v_statement from public.reservation_payout_statements where id=p_statement_id for update;
  if not found then return 'not_found'; end if;
  if v_statement.status='paid' then return 'already'; end if;
  if v_statement.revision<>p_expected_revision then return 'stale'; end if;
  lock table public.reservation_payments in share row exclusive mode;
  if exists (select 1 from public.reservation_payments p where p.event_id=v_statement.event_id
    and p.status in ('pending','review_required')) or
    exists (select 1 from public.reservation_capture_events c
      where c.reservation_id in (select id from public.event_reservations where event_id=v_statement.event_id)
      and c.outcome<>'settled') then return 'unreconciled'; end if;
  select count(*)::integer,coalesce(sum(amount_cents),0),coalesce(sum(platform_fee_cents),0),
    coalesce(sum(processor_fee_cents),0),coalesce(sum(net_to_org_cents),0)
    into v_count,v_gross,v_fee,v_processor,v_net from public.reservation_payments
    where event_id=v_statement.event_id and status='paid' and payout_statement_id is null;
  if (v_count,v_gross,v_fee,v_processor,v_net) is distinct from
     (v_statement.payment_count,v_statement.gross_cents,v_statement.platform_fee_cents,
      v_statement.processor_fee_cents,v_statement.net_to_org_cents) then return 'stale'; end if;
  update public.reservation_payments set payout_statement_id=p_statement_id
    where event_id=v_statement.event_id and status='paid' and payout_statement_id is null;
  update public.reservation_payout_statements set status='paid',reference=trim(p_reference),
    note=nullif(trim(p_note),''),paid_at=now() where id=p_statement_id;
  return 'paid';
end $$;
revoke all on function public.reservation_payout_mark_paid(uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.reservation_payout_mark_paid(uuid,integer,text,text) to authenticated,service_role;
