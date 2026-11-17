-- New migration: revised and replayed only on the isolated local stack; not applied to a hosted project.
-- Event-specific credit eligibility reserves no inventory. A claimed grant owns
-- one normal pending registration and a frozen Philippine-calendar deadline.
create table public.pay_later_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  event_id uuid not null,
  user_id uuid not null references auth.users(id),
  due_date date not null,
  due_at timestamptz not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  registration_id uuid unique references public.registrations(id),
  foreign key (event_id,org_id) references public.events(id,org_id),
  unique (event_id,user_id),
  unique (id,event_id,org_id,user_id),
  check (due_at = (due_date + 1)::timestamp at time zone 'Asia/Manila')
);
alter table public.pay_later_grants enable row level security;
revoke all on public.pay_later_grants from public,anon,authenticated;
grant select on public.pay_later_grants to authenticated;
grant all on public.pay_later_grants to service_role;

create function public.pay_later_can_manage(p_org_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select public.auth_is_super_admin() or exists (
    select 1 from public.user_roles where user_id=auth.uid() and org_id=p_org_id and role='admin'
  )
$$;
revoke all on function public.pay_later_can_manage(uuid) from public,anon,authenticated;
grant execute on function public.pay_later_can_manage(uuid) to authenticated,service_role;
create policy pay_later_grants_read on public.pay_later_grants
  for select to authenticated using (user_id=(select auth.uid()) or public.pay_later_can_manage(org_id));

alter table public.registrations
  add column pay_later_grant_id uuid unique,
  add column pay_later_due_at timestamptz,
  add constraint registration_pay_later_scope foreign key (pay_later_grant_id,event_id,org_id,user_id)
    references public.pay_later_grants(id,event_id,org_id,user_id),
  add constraint registration_pay_later_shape check (
    (pay_later_grant_id is null)=(pay_later_due_at is null)
    and (pay_later_grant_id is null or
      (user_id is not null and user_id=booked_by_user_id and booking_order_id is null and event_reservation_id is null))
  );
grant select (pay_later_grant_id,pay_later_due_at) on public.registrations to authenticated;
alter table public.prescreening_batches add column pay_later_registration_id uuid unique references public.registrations(id);
grant select (pay_later_registration_id) on public.prescreening_batches to authenticated;

alter table public.transactional_email_jobs drop constraint transactional_email_jobs_type_check;
alter table public.transactional_email_jobs add constraint transactional_email_jobs_type_check check (type in (
  'event_rescheduled','event_cancelled','event_updated','payment_failed','payment_expiring',
  'coming_soon_opened','reservation_paid','prescreening_ready','prescreening_rejected','prescreening_submitted',
  'pay_later_granted','pay_later_reserved','pay_later_reminder_7d','pay_later_reminder_1d','pay_later_expired'
));

create function public.pay_later_search_runners(p_event_id uuid,p_query text)
returns table(user_id uuid,full_name text,email text)
language plpgsql stable security definer set search_path='' as $$
declare v_org uuid; v_query text:=lower(btrim(p_query));
begin
  select org_id into v_org from public.events where id=p_event_id;
  if v_org is null or not public.pay_later_can_manage(v_org) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if v_query is null or length(v_query)<2 or length(v_query)>254 then return; end if;
  return query
    select u.id,coalesce(nullif(btrim(concat_ws(' ',rp.first_name,rp.last_name)),''),p.full_name,p.bib_name,'Runner'),u.email::text
    from auth.users u left join public.runner_passports rp on rp.claimed_user_id=u.id
      left join public.profiles p on p.id=u.id
    where not coalesce(u.is_anonymous,false) and u.deleted_at is null and (
      lower(u.email)=v_query or (
        exists (select 1 from public.registrations r where r.org_id=v_org and r.user_id=u.id)
        and position(v_query in lower(concat_ws(' ',rp.first_name,rp.last_name,p.full_name,p.bib_name)))>0
      )
    )
    order by 2,u.id limit 20;
end $$;
revoke all on function public.pay_later_search_runners(uuid,text) from public,anon,authenticated;
grant execute on function public.pay_later_search_runners(uuid,text) to authenticated,service_role;

create function public.pay_later_grant(p_event_id uuid,p_user_id uuid,p_due_date date default null)
returns public.pay_later_grants language plpgsql security definer set search_path='' as $$
declare e public.events%rowtype; g public.pay_later_grants%rowtype; deadline date;
begin
  select * into e from public.events where id=p_event_id for update;
  if not found or not public.pay_later_can_manage(e.org_id) then
    raise exception 'forbidden' using errcode='42501'; end if;
  select * into g from public.pay_later_grants where event_id=e.id and user_id=p_user_id;
  if found then return g; end if;
  if e.status not in ('open','almost_full') or e.event_date is null or not exists(
    select 1 from public.organizations where id=e.org_id and is_active
  ) then raise exception 'event_unavailable' using errcode='23514'; end if;
  if not exists(select 1 from auth.users where id=p_user_id and deleted_at is null and not coalesce(is_anonymous,false))
  then raise exception 'runner_not_found' using errcode='22023'; end if;
  if exists(select 1 from public.registrations where event_id=e.id and user_id=p_user_id and status in ('pending','paid'))
  then raise exception 'already_registered' using errcode='23505'; end if;
  deadline:=coalesce(p_due_date,e.event_date-28);
  if deadline<=(statement_timestamp() at time zone 'Asia/Manila')::date or deadline>=e.event_date
  then raise exception 'invalid_pay_later_due_date' using errcode='22023'; end if;
  insert into public.pay_later_grants(org_id,event_id,user_id,due_date,due_at,created_by)
  values(e.org_id,e.id,p_user_id,deadline,(deadline+1)::timestamp at time zone 'Asia/Manila',auth.uid()) returning * into g;
  insert into public.transactional_email_jobs(type,user_id,event_id,dedup_key,payload)
  values('pay_later_granted',g.user_id,g.event_id,'pay_later_granted:'||g.id,
    jsonb_build_object('grant_id',g.id,'due_at',g.due_at,'due_date',g.due_date));
  return g;
end $$;
revoke all on function public.pay_later_grant(uuid,uuid,date) from public,anon,authenticated;
grant execute on function public.pay_later_grant(uuid,uuid,date) to authenticated,service_role;

create function public.pay_later_list_grants(p_event_id uuid,p_limit integer default 20,p_offset integer default 0,p_grant_id uuid default null)
returns table(id uuid,org_id uuid,event_id uuid,user_id uuid,due_date date,due_at timestamptz,
  created_by uuid,created_at timestamptz,full_name text,email text,registration_id uuid,
  registration_status text,category_label text,total_amount integer,payment_status text,paid_at timestamptz,
  paid_with_pay_later boolean,total_count bigint)
language plpgsql stable security definer set search_path='' as $$
declare v_org uuid;
begin
  select e.org_id into v_org from public.events e where e.id=p_event_id;
  if v_org is null or not public.pay_later_can_manage(v_org) then raise exception 'forbidden' using errcode='42501'; end if;
  return query select g.id,g.org_id,g.event_id,g.user_id,g.due_date,g.due_at,g.created_by,g.created_at,
    coalesce(nullif(btrim(concat_ws(' ',rp.first_name,rp.last_name)),''),p.full_name,p.bib_name,'Runner'),
    u.email::text,r.id,r.status::text,c.label,r.total_amount,pm.status::text,pm.paid_at,
    coalesce(r.pay_later_grant_id=g.id,false),count(*) over()
  from public.pay_later_grants g
    join auth.users u on u.id=g.user_id
    left join public.runner_passports rp on rp.claimed_user_id=g.user_id
    left join public.profiles p on p.id=g.user_id
    left join lateral (
      select reg.* from public.registrations reg
      where reg.id=g.registration_id or (g.registration_id is null and reg.event_id=g.event_id
        and reg.user_id=g.user_id and reg.status in ('pending','paid'))
      order by reg.created_at desc,reg.id limit 1
    ) r on true
    left join public.categories c on c.id=r.category_id
    left join public.payments pm on pm.registration_id=r.id
  where g.event_id=p_event_id and (p_grant_id is null or g.id=p_grant_id) order by g.created_at desc,g.id
  limit greatest(1,least(coalesce(p_limit,20),100)) offset greatest(0,coalesce(p_offset,0));
end $$;
revoke all on function public.pay_later_list_grants(uuid,integer,integer,uuid) from public,anon,authenticated;
grant execute on function public.pay_later_list_grants(uuid,integer,integer,uuid) to authenticated,service_role;

-- Freeze identity even for service-role updates and protect all later callers.
create function public.pay_later_registration_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare g public.pay_later_grants%rowtype;
begin
  if tg_op='UPDATE' then
    if (new.pay_later_grant_id,new.pay_later_due_at) is distinct from (old.pay_later_grant_id,old.pay_later_due_at) then
      raise exception 'pay_later_identity_immutable' using errcode='23514'; end if;
    if old.pay_later_grant_id is not null and old.status not in ('pending','paid') and new.status in ('pending','paid') then
      raise exception 'pay_later_entry_terminal' using errcode='23514'; end if;
  end if;
  if new.pay_later_grant_id is null then return new; end if;
  select * into g from public.pay_later_grants where id=new.pay_later_grant_id;
  if not found or (g.event_id,g.org_id,g.user_id,g.due_at) is distinct from
      (new.event_id,new.org_id,new.user_id,new.pay_later_due_at)
    or new.booked_by_user_id is distinct from g.user_id or new.booking_order_id is not null or new.event_reservation_id is not null
  then raise exception 'pay_later_grant_mismatch' using errcode='23514'; end if;
  if tg_op='INSERT' and (g.due_at<=statement_timestamp() or g.registration_id is not null or new.status<>'pending') then
    raise exception 'pay_later_unavailable' using errcode='23514'; end if;
  if new.status='pending' then new.expires_at:=g.due_at; end if;
  return new;
end $$;
revoke all on function public.pay_later_registration_guard() from public,anon,authenticated;
create trigger a1_pay_later_registration_guard before insert or update on public.registrations
  for each row execute function public.pay_later_registration_guard();

-- The first transition consumes the screening application and records its
-- destination so maintenance can never resurrect or expire that original hold.
create function public.pay_later_registration_created() returns trigger
language plpgsql security definer set search_path='' as $$
declare g public.pay_later_grants%rowtype; v_batch uuid; reminder integer; scheduled timestamptz;
begin
  if new.pay_later_grant_id is null then return new; end if;
  update public.pay_later_grants set registration_id=new.id where id=new.pay_later_grant_id returning * into g;
  if new.prescreening_application_id is not null then
    update public.prescreening_applications set released_at=statement_timestamp()
      where id=new.prescreening_application_id returning batch_id into v_batch;
    update public.prescreening_batches set status='completed',pay_later_registration_id=new.id where id=v_batch;
  end if;
  insert into public.transactional_email_jobs(type,user_id,registration_id,event_id,dedup_key,payload)
  values('pay_later_reserved',new.user_id,new.id,new.event_id,'pay_later_reserved:'||new.id,
    jsonb_build_object('grant_id',g.id,'due_at',g.due_at,'due_date',g.due_date));
  foreach reminder in array array[7,1] loop
    scheduled:=((g.due_date-reminder)+time '09:00') at time zone 'Asia/Manila';
    if scheduled>=statement_timestamp() then
      insert into public.transactional_email_jobs(type,user_id,registration_id,event_id,dedup_key,available_at,payload)
      values('pay_later_reminder_'||reminder||'d',new.user_id,new.id,new.event_id,'pay_later_reminder_'||reminder||'d:'||new.id,
        scheduled,jsonb_build_object('grant_id',g.id,'due_at',g.due_at,'due_date',g.due_date));
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.pay_later_registration_created() from public,anon,authenticated;
create trigger pay_later_registration_created after insert on public.registrations
  for each row execute function public.pay_later_registration_created();

create function public.pay_later_expired_email() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.pay_later_grant_id is not null and old.status='pending' and new.status='expired'
    and new.pay_later_due_at<=statement_timestamp()
    and exists(select 1 from public.events where id=new.event_id and status not in ('cancelled','closed','completed')) then
    insert into public.transactional_email_jobs(type,user_id,registration_id,event_id,dedup_key,payload)
    select 'pay_later_expired',new.user_id,new.id,new.event_id,'pay_later_expired:'||new.id,
      jsonb_build_object('grant_id',g.id,'due_at',g.due_at,'due_date',g.due_date)
    from public.pay_later_grants g where g.id=new.pay_later_grant_id
    on conflict(dedup_key) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.pay_later_expired_email() from public,anon,authenticated;
create trigger pay_later_expired_email after update of status on public.registrations
  for each row execute function public.pay_later_expired_email();

-- The Edge validates dynamic form fields. This transaction rechecks every
-- mutable authority and recomputes the money snapshot before claiming a place.
create function public.pay_later_reserve(p_actor uuid,p_request jsonb,p_provider text,p_return_url text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.events%rowtype; c public.categories%rowtype; o public.organizations%rowtype;
  g public.pay_later_grants%rowtype; r public.registrations%rowtype; passport public.runner_passports%rowtype;
  b public.prescreening_batches%rowtype; a public.prescreening_applications%rowtype;
  addon_ids uuid[]; addon_total bigint; base bigint; fee integer; subtotal bigint; managed boolean;
  registration_id uuid:=gen_random_uuid(); request jsonb; lines jsonb; v_email text; v_key text;
begin
  if p_provider not in ('fake','paymongo') or p_return_url is null or p_request is null
    or coalesce((p_request->>'waiver_accepted')::boolean,false) is not true then
    raise exception 'invalid_input' using errcode='22023'; end if;
  v_key:=p_request->>'idempotency_key';
  if v_key is null or length(v_key)<8 or left(v_key,6)='group:' then raise exception 'invalid_input' using errcode='22023'; end if;
  select email into v_email from auth.users where id=p_actor and email_confirmed_at is not null
    and deleted_at is null and not coalesce(is_anonymous,false) for share;
  if not found then raise exception 'booking_email_unverified' using errcode='42501'; end if;
  select * into e from public.events where id=(p_request->>'event_id')::uuid for update;
  if not found then raise exception 'event_unavailable' using errcode='22023'; end if;
  select * into g from public.pay_later_grants where id=(p_request->>'pay_later_grant_id')::uuid
    and event_id=e.id and org_id=e.org_id and user_id=p_actor for update;
  if not found then raise exception 'pay_later_unavailable' using errcode='42501'; end if;
  select * into passport from public.runner_passports where claimed_user_id=p_actor for share;
  if not found or ((p_request->>'participant_passport_id') is not null and (p_request->>'participant_passport_id')::uuid<>passport.id)
    or p_request->>'event_reservation_id' is not null then
    raise exception 'pay_later_self_only' using errcode='42501'; end if;
  select * into r from public.registrations where pay_later_grant_id=g.id;
  if found then
    if r.category_id<>(p_request->>'category_id')::uuid then raise exception 'already_registered' using errcode='23505'; end if;
    return jsonb_build_object('registration_id',r.id,'checkout_url',null,'payment_plan','pay_later',
      'pay_later_due_at',r.pay_later_due_at,'status',r.status);
  end if;
  if g.registration_id is not null or g.due_at<=statement_timestamp() then
    raise exception 'pay_later_unavailable' using errcode='23514'; end if;
  if e.status not in ('open','almost_full') or e.registration_closes_at<=statement_timestamp() then
    raise exception 'registration_closed' using errcode='23514'; end if;
  select * into o from public.organizations where id=e.org_id and is_active for share;
  if not found then raise exception 'org_suspended' using errcode='23514'; end if;
  if e.waiver_version_id is null or e.waiver_version_id is distinct from (p_request->>'waiver_version_id')::uuid then
    raise exception 'waiver_version_changed' using errcode='23514'; end if;
  select * into c from public.categories where id=(p_request->>'category_id')::uuid and event_id=e.id and org_id=e.org_id for update;
  if not found then raise exception 'category_not_found' using errcode='22023'; end if;
  if exists(select 1 from public.registrations where event_id=e.id and participant_passport_id=passport.id and status in ('pending','paid'))
  then raise exception 'already_registered' using errcode='23505'; end if;
  -- The same DB Passport guard as screening also applies to direct open categories.
  if (passport.first_name ~ '[^[:space:]]' and passport.last_name ~ '[^[:space:]]'
    and passport.date_of_birth <= (statement_timestamp() at time zone 'UTC')::date
    and passport.gender in ('Male','Female')
    and regexp_replace(passport.contact_number,'[[:space:]().-]','','g') ~ '^(\+?[1-9][0-9]{7,14}|0[0-9]{8,10})$'
    and passport.emergency_contact_name ~ '[^[:space:]]'
    and regexp_replace(passport.emergency_contact_number,'[[:space:]().-]','','g') ~ '^(\+?[1-9][0-9]{7,14}|0[0-9]{8,10})$'
    and passport.emergency_contact_relationship ~ '[^[:space:]]'
    and passport.shipping_barangay_code ~ '^[0-9]{9}$' and passport.shipping_zip_code ~ '^[0-9]{4}$'
    and passport.shipping_address_line ~ '[^[:space:]]') is not true
  then raise exception 'passport_incomplete' using errcode='23514'; end if;
  select * into a from public.prescreening_applications where event_id=e.id and participant_passport_id=passport.id and released_at is null;
  if a.id is not null then
    select * into b from public.prescreening_batches where id=a.batch_id for update;
    if a.category_id<>c.id or a.booked_by_user_id<>p_actor or a.decision not in ('approved','not_required')
      or b.id is distinct from (p_request->>'prescreening_batch_id')::uuid
      or b.status<>'ready' or b.checkout_intent<>'entry' or b.payment_deadline_at<=statement_timestamp()
      or (select count(*) from public.prescreening_applications where batch_id=b.id)<>1
      or b.booking_order_id is not null or b.event_reservation_id is not null then
      raise exception 'prescreening_approval_required' using errcode='23514'; end if;
  elsif c.prescreening_enabled or p_request->>'prescreening_batch_id' is not null then
    raise exception 'prescreening_approval_required' using errcode='23514';
  end if;
  if jsonb_typeof(coalesce(p_request->'addon_ids','[]'::jsonb))<>'array' then raise exception 'invalid_addons'; end if;
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into addon_ids from jsonb_array_elements_text(coalesce(p_request->'addon_ids','[]'::jsonb));
  if cardinality(addon_ids)<>(select count(distinct value) from unnest(addon_ids) value) then raise exception 'invalid_addons'; end if;
  perform 1 from public.addons where id=any(addon_ids) order by id for share;
  if cardinality(addon_ids)<>(select count(*) from public.addons where id=any(addon_ids) and event_id=e.id and org_id=e.org_id)
  then raise exception 'invalid_addons'; end if;
  select coalesce(sum(price),0) into addon_total from public.addons where id=any(addon_ids);
  base:=c.base_price+addon_total;
  if base<0 or base>2147483647 then raise exception 'invalid_amount'; end if;
  fee:=least(base,case when o.commission_type='fixed' then o.commission_flat_cents
    else round(base*coalesce(o.commission_rate,0.10)) end)::integer;
  if fee<0 then raise exception 'invalid_terms'; end if;
  managed:=p_provider='paymongo' and o.fee_mode='pass_on';
  subtotal:=base+case when managed then fee else 0 end;
  if subtotal>2147483647 then raise exception 'invalid_amount'; end if;
  insert into public.registrations(id,org_id,event_id,category_id,user_id,booked_by_user_id,participant_passport_id,
    status,total_amount,custom_data,waiver_version_id,waiver_accepted_at,waiver_acceptance_method,idempotency_key,
    pay_later_grant_id,pay_later_due_at,expires_at,prescreening_application_id)
  values(registration_id,e.org_id,e.id,c.id,p_actor,p_actor,passport.id,'pending',base,
    coalesce(p_request->'custom_data','{}'::jsonb),e.waiver_version_id,statement_timestamp(),'signed_in_self',v_key,g.id,g.due_at,g.due_at,a.id)
  returning * into r;
  insert into public.registration_addons(registration_id,addon_id,price)
    select r.id,id,price from public.addons where id=any(addon_ids);
  lines:=jsonb_build_array(jsonb_build_object('name',c.label,'amount',c.base_price));
  if addon_total>0 then lines:=lines||jsonb_build_array(jsonb_build_object('name','Add-ons','amount',addon_total)); end if;
  if managed and fee>0 then lines:=lines||jsonb_build_array(jsonb_build_object('name','Taxes and fees','amount',fee)); end if;
  request:=jsonb_build_object('registrationId',r.id,'amount',subtotal,'description',c.label,
    'returnUrl',replace(p_return_url,'__PAY_LATER_REGISTRATION_ID__',r.id::text),
    'lineItems',lines,'billing',jsonb_build_object('name',concat_ws(' ',passport.first_name,passport.last_name),'email',v_email),'passOnFees',managed);
  if managed then request:=request||jsonb_build_object('metadata',jsonb_build_object('fee_mode','pass_on','platform_fee_cents',fee::text)); end if;
  insert into public.payments(org_id,registration_id,amount,status,provider,checkout_fee_mode,checkout_platform_fee,
    checkout_provider_managed_fee,checkout_request,discount_checkout_state)
  values(e.org_id,r.id,subtotal,'pending',p_provider,o.fee_mode,fee,managed,request,'prepared');
  return jsonb_build_object('registration_id',r.id,'checkout_url',null,'payment_plan','pay_later','pay_later_due_at',g.due_at,'status',r.status);
end $$;
revoke all on function public.pay_later_reserve(uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.pay_later_reserve(uuid,jsonb,text,text) to service_role;

-- Local-only migration; not applied to either hosted project.
-- New entry paths and old direct writes share this admission boundary. Existing
-- active entries are grandfathered when an organizer enables screening.
create or replace function public.registration_event_capacity_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.categories%rowtype; a public.prescreening_applications%rowtype; b public.prescreening_batches%rowtype;
  p public.event_reservation_places%rowtype; v_conversion boolean:=false; v_pool text:='general';
begin
  if tg_op='UPDATE' and new.prescreening_application_id is distinct from old.prescreening_application_id then
    raise exception 'registration_screening_identity_immutable' using errcode='23514'; end if;
  if tg_op='UPDATE' and new.status='pending' and old.prescreening_application_id is not null and new.pay_later_grant_id is null and exists(
    select 1 from public.prescreening_applications pa join public.prescreening_batches pb on pb.id=pa.batch_id
      where pa.id=old.prescreening_application_id and pb.checkout_intent='entry'
        and (new.expires_at is null or new.expires_at>pb.payment_deadline_at)) then
    raise exception 'prescreening_payment_window_immutable' using errcode='23514'; end if;
  if new.status not in ('pending','paid') then return new; end if;
  if new.status='pending' and new.expires_at<=statement_timestamp() then return new; end if;
  perform 1 from public.events where id=new.event_id for update;
  select * into c from public.categories where id=new.category_id and event_id=new.event_id and org_id=new.org_id for update;
  if not found then raise exception 'category_scope_mismatch' using errcode='23514'; end if;
  if tg_op='UPDATE' and (old.category_id,old.event_id,old.participant_passport_id,old.event_reservation_id,old.booked_by_user_id)
      is not distinct from (new.category_id,new.event_id,new.participant_passport_id,new.event_reservation_id,new.booked_by_user_id)
    and exists(select 1 from public.event_capacity_claims(new.event_id) q where q.registration_id=old.id) then return new; end if;
  if new.event_reservation_id is not null then
    if not exists(select 1 from public.event_reservations q where q.id=new.event_reservation_id and q.event_id=new.event_id
      and q.org_id=new.org_id and q.user_id=new.booked_by_user_id and q.status='paid') then
      raise exception 'invalid_event_reservation' using errcode='23514'; end if;
    select * into p from public.event_reservation_places where reservation_id=new.event_reservation_id and participant_passport_id=new.participant_passport_id;
    if found then
      if p.status<>'held' or (p.category_id is not null and p.category_id<>new.category_id) or
        coalesce(greatest(p.entry_payment_deadline_at,c.entry_payment_deadline_at),
          (select registration_deadline_at from public.event_reservations where id=new.event_reservation_id))<=statement_timestamp() then
        raise exception 'invalid_event_reservation' using errcode='23514'; end if;
      new.expires_at:=least(new.expires_at,coalesce(greatest(p.entry_payment_deadline_at,c.entry_payment_deadline_at),
        (select registration_deadline_at from public.event_reservations where id=new.event_reservation_id)));
      new.prescreening_application_id:=p.prescreening_application_id;
      v_conversion:=true;
      if p.category_id is not null then v_pool:='reservation'; end if;
    elsif exists(select 1 from public.event_reservation_places where reservation_id=new.event_reservation_id) or
      not exists(select 1 from public.event_reservations q where q.id=new.event_reservation_id and q.user_id=new.user_id
        and q.registration_deadline_at>statement_timestamp()) then
      raise exception 'invalid_event_reservation' using errcode='23514';
    else v_conversion:=true; end if;
  end if;
  if not v_conversion then
    select * into a from public.prescreening_applications where event_id=new.event_id and participant_passport_id=new.participant_passport_id and released_at is null;
    if found then
      if a.category_id<>new.category_id or a.booked_by_user_id<>new.booked_by_user_id or a.decision not in ('approved','not_required') then
        raise exception 'prescreening_approval_required' using errcode='23514'; end if;
      select * into b from public.prescreening_batches where id=a.batch_id;
      if b.status<>'ready' or b.checkout_intent<>'entry' or b.payment_deadline_at<=statement_timestamp() then
        raise exception 'prescreening_group_not_payable' using errcode='23514'; end if;
      if new.booking_order_id is null and (select count(*) from public.prescreening_applications where batch_id=b.id and released_at is null)>1 then
        raise exception 'prescreening_group_payment_required' using errcode='23514'; end if;
      if new.booking_order_id is not null and not exists(select 1 from public.booking_orders o where o.id=new.booking_order_id
        and o.reservation_request->>'prescreening_batch_id'=b.id::text) then
        raise exception 'prescreening_batch_required' using errcode='23514'; end if;
      new.prescreening_application_id:=a.id;
      new.expires_at:=b.payment_deadline_at;
    elsif c.prescreening_enabled or new.prescreening_application_id is not null then
      raise exception 'prescreening_approval_required' using errcode='23514'; end if;
  end if;
  if new.pay_later_grant_id is not null then new.expires_at:=new.pay_later_due_at; end if;
  perform public.assert_category_capacity(c.id,v_pool,1,new.id,new.prescreening_application_id,coalesce(p.id,new.event_reservation_id));
  return new;
end $$;
revoke all on function public.registration_event_capacity_guard() from public,anon,authenticated;


CREATE OR REPLACE FUNCTION public.pay_later_settle_payment_core(p_registration_id uuid, p_method text, p_fee integer, p_net integer, p_token text, p_raw jsonb, p_processor_fee integer DEFAULT 0, p_processor_fee_predicted integer DEFAULT NULL::integer, p_processor_fee_source text DEFAULT 'none'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_status public.registration_status;
  v_category uuid;
  v_org uuid;
  v_event uuid;
  v_participant uuid;
  v_amount int;
  v_live integer;
  v_constraint text;
begin
  select status, category_id, org_id, event_id, participant_passport_id, total_amount
    into v_status, v_category, v_org, v_event, v_participant, v_amount
    from public.registrations where id = p_registration_id for update;
  if not found then return 'not_found'; end if;
  if v_status = 'paid' then return 'already'; end if;

  if v_status = 'expired' then
    select count(*) into v_live
      from public.registrations
     where event_id = v_event
       and participant_passport_id = v_participant
       and id <> p_registration_id
       and status in ('pending', 'paid');
    if v_live > 0 then
      return 'conflict';
    end if;
  elsif v_status <> 'pending' then
    return 'not_pending';  -- refunded/cancelled: never re-confirm (replay-safe)
  end if;

  begin
    update public.payments
       set status = 'paid', paid_at = coalesce(paid_at, now()), method = p_method, platform_fee = p_fee,
           net_to_org = p_net, raw = p_raw,
           processor_fee_cents           = coalesce(p_processor_fee, 0),
           processor_fee_predicted_cents = p_processor_fee_predicted,
           processor_fee_source          = coalesce(p_processor_fee_source, 'none')
     where registration_id = p_registration_id returning amount into v_amount;

    update public.registrations
       set status = 'paid', ticket_token = p_token, expires_at = null
     where id = p_registration_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'registrations_one_live_per_event' then
      return 'conflict';
    end if;
    raise;  -- some other constraint: a real bug, must not be swallowed
  end;

  update public.categories set slots_taken = slots_taken + 1 where id = v_category;

  insert into public.registration_audit
    (registration_id, org_id, event_id, action, detail, actor_role)
  values (p_registration_id, v_org, v_event, 'paid',
          jsonb_build_object('method', p_method, 'amount', v_amount, 'amount_basis', 'captured_gross'), 'system');

  return 'paid';
end;
$function$;


REVOKE ALL ON FUNCTION public.pay_later_settle_payment_core(uuid,text,integer,integer,text,jsonb,integer,integer,text) FROM PUBLIC, anon, authenticated, service_role;

create or replace function public.discount_confirm_free(p_actor uuid,p_registration uuid,p_order uuid,p_tokens jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare r public.registrations%rowtype; o public.booking_orders%rowtype; a public.booking_payment_attempts%rowtype;
 c uuid; v_event uuid; result text; n integer;
begin
 if (p_registration is null)=(p_order is null) then raise exception 'invalid_input'; end if;
 select coalesce((select event_id from public.registrations where id=p_registration),(select b.event_id from public.booking_orders b where b.id=p_order)) into v_event;
 perform 1 from public.events e where e.id=v_event for update;
 if p_order is not null then
  select * into o from public.booking_orders where id=p_order and booked_by_user_id=p_actor for update;
  if not found then raise exception 'order_not_found'; end if;
  if o.status='paid' then return 'already'; end if;
  if o.status<>'pending' or o.expires_at is null or o.expires_at<=statement_timestamp() then raise exception 'hold_expired'; end if;
  select * into a from public.booking_payment_attempts where booking_order_id=p_order and status='prepared' for update;
  if not found or a.gross_cents<>0 or exists(select 1 from public.booking_payment_dispatches where attempt_id=a.id) then raise exception 'discount_payment_locked'; end if;
  if exists(select 1 from public.registrations where booking_order_id=p_order and (total_amount<>0 or status<>'pending')) then raise exception 'order_entries_changed'; end if;
 else
  select * into r from public.registrations where id=p_registration and coalesce(booked_by_user_id,user_id)=p_actor and booking_order_id is null for update;
  if not found then raise exception 'registration_not_found'; end if;
  if r.status='paid' then return 'already'; end if;
  if not exists(select 1 from public.payments where registration_id=r.id and status='pending' and discount_checkout_state='prepared' and provider_ref is null and amount=0) then raise exception 'discount_payment_locked'; end if;
 end if;
 -- Ordered category locks and the event lock are shared with paid admissions.
 perform 1 from public.categories where id in(select category_id from public.registrations where id=p_registration or booking_order_id=p_order) order by id for update;
 for r in select * from public.registrations where id=p_registration or booking_order_id=p_order order by id for update loop
  if coalesce(r.booked_by_user_id,r.user_id)<>p_actor or r.status<>'pending' or r.total_amount<>0 or r.expires_at is null or r.expires_at<=statement_timestamp() then raise exception 'hold_expired'; end if;
  if not exists(select 1 from public.events e join public.organizations org on org.id=e.org_id where e.id=r.event_id and e.status in ('open','almost_full') and org.is_active) then raise exception 'registration_closed'; end if;
  if r.waiver_accepted_at is null or r.waiver_version_id is null then raise exception 'waiver_required'; end if;
  if coalesce(length(p_tokens->>r.id::text),0)<20 then raise exception 'ticket_tokens_required'; end if;
  select count(*) into n from public.registrations where category_id=r.category_id and (status='paid' or status='pending' and expires_at>statement_timestamp());
  if n>(select slots_total from public.categories where id=r.category_id) then raise exception 'sold_out'; end if;
  if r.pay_later_grant_id is null and r.prescreening_application_id is not null and not exists(select 1 from public.prescreening_applications app join public.prescreening_batches b on b.id=app.batch_id
    where app.id=r.prescreening_application_id and app.released_at is null and app.decision in ('approved','not_required') and app.participant_passport_id=r.participant_passport_id and app.category_id=r.category_id and b.status='ready' and b.checkout_intent='entry' and b.payment_deadline_at>=statement_timestamp()) then raise exception 'prescreening_payment_window_ended'; end if;
  if r.event_reservation_id is not null and not exists(select 1 from public.event_reservations er where er.id=r.event_reservation_id and er.status='paid' and er.user_id=p_actor
    and (not exists(select 1 from public.event_reservation_places place where place.reservation_id=er.id)
      or exists(select 1 from public.event_reservation_places place where place.reservation_id=er.id and place.participant_passport_id=r.participant_passport_id and place.category_id=r.category_id and place.status='held'))
    and coalesce((select greatest(place.entry_payment_deadline_at,cat.entry_payment_deadline_at) from public.event_reservation_places place join public.categories cat on cat.id=place.category_id where place.reservation_id=er.id and place.participant_passport_id=r.participant_passport_id and place.category_id=r.category_id and place.status='held'),er.registration_deadline_at)>=statement_timestamp()) then raise exception 'reservation_deadline_passed'; end if;
 end loop;
 if p_order is null then
  update public.payments set provider='complimentary',method='complimentary',checkout_platform_fee=0,checkout_provider_managed_fee=false,discount_checkout_state='ready' where registration_id=p_registration;
  result:=public.confirm_payment_tx(p_registration,'complimentary',0,0,p_tokens->>p_registration::text,jsonb_build_object('settlement_kind','complimentary'),0,0,'none');
  if result not in ('paid','already') then raise exception 'free_confirmation_failed'; end if;
 else
  insert into public.booking_payment_captures(org_id,booking_order_id,attempt_id,payment_id,capture,state,settlement_kind)
   values(o.org_id,o.id,a.id,null,jsonb_build_object('amount',0,'feeCents',0),'fulfilled','complimentary') returning id into c;
  insert into public.booking_payment_allocations(capture_id,org_id,registration_id,gross_cents,platform_fee_cents,processor_fee_cents,net_to_org_cents)
   select c,org_id,id,0,0,0,0 from public.registrations where booking_order_id=o.id;
  update public.registrations set status='paid',expires_at=null,ticket_token=p_tokens->>id::text where booking_order_id=o.id;
  with used as(select category_id,count(*)::integer n from public.registrations where booking_order_id=o.id group by category_id)
   update public.categories cat set slots_taken=cat.slots_taken+used.n from used where cat.id=used.category_id;
  update public.booking_orders set status='paid',expires_at=null where id=o.id;
  update public.booking_payment_attempts set status='paid' where id=a.id;
  insert into public.booking_order_deliveries(booking_order_id,org_id) values(o.id,o.org_id);
 end if;
 return 'paid';
end $$;
revoke all on function public.discount_confirm_free(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.discount_confirm_free(uuid,uuid,uuid,jsonb) to service_role;


create or replace function public.transactional_email_payment_failed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status is distinct from 'failed' and new.status = 'failed' then
    insert into public.transactional_email_jobs(
      type,user_id,registration_id,event_id,dedup_key
    )
    select 'payment_failed',coalesce(r.booked_by_user_id,r.user_id),r.id,r.event_id,
      'payment_failed:' || new.id::text
    from public.registrations r
    where r.id = new.registration_id and r.status = 'pending' and r.pay_later_grant_id is null
    on conflict (dedup_key) do nothing;
  end if;
  return new;
end $$;

revoke all on function public.transactional_email_payment_failed()
  from public,anon,authenticated;



create or replace function public.transactional_email_enqueue_expiring_payments()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  with inserted as (
    insert into public.transactional_email_jobs(
      type,user_id,registration_id,event_id,dedup_key,payload
    )
    select 'payment_expiring',coalesce(r.booked_by_user_id,r.user_id),r.id,r.event_id,
      'payment_expiring:' || r.id::text,
      jsonb_build_object('expires_at',r.expires_at)
    from public.registrations r
    join public.payments p on p.registration_id = r.id
    join public.events e on e.id = r.event_id
    where r.status = 'pending' and p.status = 'pending' and r.pay_later_grant_id is null
      and r.expires_at > now() and r.expires_at <= now() + interval '2 hours'
      and e.status not in ('cancelled','closed','completed')
    on conflict (dedup_key) do nothing
    returning 1
  ) select count(*) into v_count from inserted;
  return v_count;
end $$;

revoke all on function public.transactional_email_enqueue_expiring_payments()
  from public,anon,authenticated;

grant execute on function public.transactional_email_enqueue_expiring_payments()
  to service_role;

-- Keep the established settlement body private. Every public caller now passes
-- the credit deadline guard, including the complimentary-discount path.
create or replace function public.confirm_payment_tx(
  p_registration_id uuid,p_method text,p_fee integer,p_net integer,p_token text,p_raw jsonb,
  p_processor_fee integer default 0,p_processor_fee_predicted integer default null,
  p_processor_fee_source text default 'none'
) returns text language plpgsql security definer set search_path='' as $$
declare r public.registrations%rowtype;
begin
  perform 1 from public.events where id=(select event_id from public.registrations where id=p_registration_id) for update;
  select * into r from public.registrations where id=p_registration_id for update;
  if r.pay_later_grant_id is not null and r.status<>'paid' then
    -- Free checkout has no provider capture and already checked the live hold.
    if p_method<>'complimentary' or r.status<>'pending' or r.pay_later_due_at<=statement_timestamp()
      or r.total_amount<>0 or not exists(select 1 from public.payments where registration_id=r.id
        and provider='complimentary' and amount=0 and status='pending') then return 'reservation_deadline_passed'; end if;
  end if;
  return public.pay_later_settle_payment_core(p_registration_id,p_method,p_fee,p_net,p_token,p_raw,
    p_processor_fee,p_processor_fee_predicted,p_processor_fee_source);
end $$;
revoke all on function public.confirm_payment_tx(uuid,text,integer,integer,text,jsonb,integer,integer,text) from public,anon,authenticated;
grant execute on function public.confirm_payment_tx(uuid,text,integer,integer,text,jsonb,integer,integer,text) to service_role;

create function public.confirm_pay_later_registration_tx(
  p_registration_id uuid,p_method text,p_fee integer,p_net integer,p_token text,p_raw jsonb,
  p_processor_fee integer,p_processor_fee_predicted integer,p_processor_fee_source text,p_provider_paid_at timestamptz
) returns text language plpgsql security definer set search_path='' as $$
declare r public.registrations%rowtype;
begin
  perform 1 from public.events where id=(select event_id from public.registrations where id=p_registration_id) for update;
  select * into r from public.registrations where id=p_registration_id for update;
  if not found then return 'not_found'; end if;
  if r.pay_later_grant_id is null then return 'reservation_deadline_passed'; end if;
  if r.status='paid' then return 'already'; end if;
  if r.status<>'pending' or p_provider_paid_at is null or p_provider_paid_at>=r.pay_later_due_at
    or p_provider_paid_at<date_trunc('second',r.created_at) or not exists(
      select 1 from public.event_capacity_claims(r.event_id) where registration_id=r.id
    ) then return 'reservation_deadline_passed'; end if;
  return public.pay_later_settle_payment_core(p_registration_id,p_method,p_fee,p_net,p_token,p_raw,
    p_processor_fee,p_processor_fee_predicted,p_processor_fee_source);
end $$;
revoke all on function public.confirm_pay_later_registration_tx(uuid,text,integer,integer,text,jsonb,integer,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.confirm_pay_later_registration_tx(uuid,text,integer,integer,text,jsonb,integer,integer,text,timestamptz) to service_role;

-- Separate workers must never lease each other's jobs.
create or replace function public.transactional_email_claim(p_limit integer default 20)
returns setof public.transactional_email_jobs
language sql security invoker set search_path = '' as $$
  with candidates as (
    select j.id from public.transactional_email_jobs j
    where j.type not in ('coming_soon_opened','reservation_paid','prescreening_ready','prescreening_rejected','prescreening_submitted')
      and j.sent_at is null and j.attempts < 5
      and j.available_at <= now()
      and (j.lease_expires_at is null or j.lease_expires_at <= now())
    order by j.created_at,j.id
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,20),50))
  )
  update public.transactional_email_jobs j set
    lease_token = gen_random_uuid(),
    lease_expires_at = now() + interval '5 minutes',
    attempts = j.attempts + 1
  from candidates c where j.id = c.id
  returning j.*;
$$;


revoke all on function public.transactional_email_claim(integer) from public,anon,authenticated;
grant execute on function public.transactional_email_claim(integer) to service_role;
