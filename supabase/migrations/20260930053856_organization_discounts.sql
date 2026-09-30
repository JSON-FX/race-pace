-- Local-only migration, not applied to hosted projects.
-- Additive discount ledgers. All mutations share the existing event-first lock
-- order; the code row serializes redemption across events in the same campaign.
create table public.discount_codes (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
 code text not null check(code=upper(btrim(code)) and code ~ '^[A-Z0-9][A-Z0-9_-]{3,39}$'),
 kind text not null check(kind in ('regular','special')),
 discount_type text not null check(discount_type in ('percent','flat')),
 value integer not null check(value>0), coverage text not null check(coverage in ('entry','subtotal')),
 scope text not null default 'organization' check(scope in ('organization','events','categories')),
 event_ids uuid[] not null default '{}', category_ids uuid[] not null default '{}',
 max_uses integer check(max_uses>0), absorb_fees boolean not null default false,
 assigned_passport_id uuid references public.runner_passports(id),
 starts_at timestamptz, ends_at timestamptz, active boolean not null default true,
 batch_id uuid, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(org_id,code), unique(id,org_id),
 check(discount_type<>'percent' or value<=10000),
 check(discount_type<>'percent' or value<>10000 or coverage='subtotal'),
 check(kind<>'special' or max_uses=1),
 check(kind='special' or (not absorb_fees and assigned_passport_id is null)),
 check(ends_at is null or starts_at is null or ends_at>starts_at),
 check((scope='organization' and cardinality(event_ids)=0 and cardinality(category_ids)=0)
   or (scope='events' and cardinality(event_ids)>0 and cardinality(category_ids)=0)
   or (scope='categories' and cardinality(category_ids)>0 and cardinality(event_ids)=0))
);
create table public.discount_redemptions (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
 code_id uuid not null, registration_id uuid not null references public.registrations(id),
 passport_id uuid not null references public.runner_passports(id),
 state text not null default 'reserved' check(state in ('reserved','redeemed','released')),
 original_cents integer not null check(original_cents>=0), discount_cents integer not null check(discount_cents>=0 and discount_cents<=original_cents),
 snapshot jsonb not null, created_at timestamptz not null default now(), redeemed_at timestamptz,
 foreign key(code_id,org_id) references public.discount_codes(id,org_id)
);
create unique index discount_once_per_passport on public.discount_redemptions(code_id,passport_id) where state<>'released';
create unique index discount_one_per_registration on public.discount_redemptions(registration_id) where state<>'released';
create index discount_redemptions_org on public.discount_redemptions(org_id,created_at desc);

alter table public.registrations
 add column discount_code text,
 add column discount_amount_cents integer not null default 0 check(discount_amount_cents>=0),
 add column discount_original_cents integer,
 add column discount_snapshot jsonb;
alter table public.payments add column discount_checkout_state text check(discount_checkout_state in ('prepared','creating','ready'));

create function public.auth_manage_discounts(p_org uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.auth_is_super_admin() or exists(select 1 from public.user_roles where user_id=(select auth.uid()) and org_id=p_org and role='admin');
$$;
revoke all on function public.auth_manage_discounts(uuid) from public,anon;
grant execute on function public.auth_manage_discounts(uuid) to authenticated,service_role;
alter table public.discount_codes enable row level security;
alter table public.discount_redemptions enable row level security;
revoke all on public.discount_codes,public.discount_redemptions from public,anon,authenticated;
grant select on public.discount_codes,public.discount_redemptions to authenticated;
grant all on public.discount_codes,public.discount_redemptions to service_role;
create policy discount_codes_admin_read on public.discount_codes for select to authenticated using(public.auth_manage_discounts(org_id));
create policy discount_redemptions_admin_read on public.discount_redemptions for select to authenticated using(public.auth_manage_discounts(org_id));

-- Admin writes go through one transaction, including batch generation. Caller
-- identity is auth.uid(), never a form-supplied actor or an organization switcher.
create function public.discount_create(p_org uuid,p_input jsonb) returns setof public.discount_codes
language plpgsql security definer set search_path='' as $$
declare d public.discount_codes%rowtype; n integer; i integer; batch uuid:=gen_random_uuid(); assigned uuid; ids uuid[];
begin
 if not public.auth_manage_discounts(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
 n:=case when p_input->>'kind'='special' then coalesce((p_input->>'quantity')::integer,1) else 1 end;
 if n<1 or n>500 then raise exception 'invalid_quantity'; end if;
 if exists(select 1 from jsonb_array_elements_text(coalesce(p_input->'event_ids','[]')) x where not exists(select 1 from public.events where id=x::uuid and org_id=p_org))
 or exists(select 1 from jsonb_array_elements_text(coalesce(p_input->'category_ids','[]')) x where not exists(select 1 from public.categories where id=x::uuid and org_id=p_org)) then raise exception 'invalid_scope'; end if;
 select coalesce(array_agg(x::uuid),'{}') into ids from jsonb_array_elements_text(coalesce(p_input->'passport_ids','[]')) x;
 if cardinality(ids)>0 and (cardinality(ids)<>n or cardinality(ids)<>(select count(distinct x) from unnest(ids) x)) then raise exception 'invalid_assignment'; end if;
 -- Admins may assign only Passports already represented in their organization's
 -- registrations or pre-screening applications. Never expose the global directory.
 if exists(select 1 from unnest(ids) x where not exists(select 1 from public.registrations where org_id=p_org and participant_passport_id=x)
   and not exists(select 1 from public.prescreening_applications where org_id=p_org and participant_passport_id=x)) then raise exception 'invalid_assignment'; end if;
 for i in 1..n loop
  assigned:=ids[i];
  insert into public.discount_codes(org_id,code,kind,discount_type,value,coverage,scope,event_ids,category_ids,max_uses,absorb_fees,assigned_passport_id,starts_at,ends_at,batch_id,created_by)
  values(p_org,case when p_input->>'kind'='special' then upper(substr(replace(gen_random_uuid()::text,'-',''),1,20)) else upper(btrim(p_input->>'code')) end,
   p_input->>'kind',p_input->>'discount_type',(p_input->>'value')::integer,
   case when p_input->>'discount_type'='percent' and (p_input->>'value')::integer=10000 then 'subtotal' else p_input->>'coverage' end,
   coalesce(p_input->>'scope','organization'),array(select x::uuid from jsonb_array_elements_text(coalesce(p_input->'event_ids','[]')) x),
   array(select x::uuid from jsonb_array_elements_text(coalesce(p_input->'category_ids','[]')) x),
   case when p_input->>'kind'='special' then 1 else (p_input->>'max_uses')::integer end,coalesce((p_input->>'absorb_fees')::boolean,false),assigned,
   (p_input->>'starts_at')::timestamptz,(p_input->>'ends_at')::timestamptz,case when n>1 then batch end,auth.uid()) returning * into d;
  return next d;
 end loop;
end $$;
revoke all on function public.discount_create(uuid,jsonb) from public,anon;
grant execute on function public.discount_create(uuid,jsonb) to authenticated,service_role;
create function public.discount_set_active(p_id uuid,p_active boolean) returns void
language plpgsql security definer set search_path='' as $$
declare d public.discount_codes%rowtype;
begin
 select * into d from public.discount_codes where id=p_id for update;
 if not found or not public.auth_manage_discounts(d.org_id) then raise exception 'forbidden' using errcode='42501'; end if;
 update public.discount_codes set active=p_active where id=p_id;
end $$;
revoke all on function public.discount_set_active(uuid,boolean) from public,anon;
grant execute on function public.discount_set_active(uuid,boolean) to authenticated,service_role;

create function public.discount_apply(p_actor uuid,p_registration uuid,p_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.registrations%rowtype; d public.discount_codes%rowtype; p public.payments%rowtype; o public.organizations%rowtype;
 original integer; eligible integer; savings integer:=0; fee integer; mode text; snap jsonb; uses integer;
begin
 perform 1 from public.events where id=(select event_id from public.registrations where id=p_registration) for update;
 select * into r from public.registrations where id=p_registration for update;
 if not found or coalesce(r.booked_by_user_id,r.user_id)<>p_actor then raise exception 'registration_not_found'; end if;
 if r.status<>'pending' or r.expires_at is null or r.expires_at<=statement_timestamp() then raise exception 'hold_expired'; end if;
 select * into o from public.organizations where id=r.org_id for share;
 if not o.is_active then raise exception 'org_suspended'; end if;
 if not exists(select 1 from public.events where id=r.event_id and status in ('open','almost_full')) then raise exception 'registration_closed'; end if;
 if r.booking_order_id is not null then
  perform 1 from public.booking_orders where id=r.booking_order_id for update;
  if exists(select 1 from public.booking_payment_attempts where booking_order_id=r.booking_order_id and status not in ('failed','expired','prepared')) then raise exception 'discount_payment_locked'; end if;
  -- A prepared quote has never reached PayMongo and can be replaced safely.
  update public.booking_payment_attempts set status='expired' where booking_order_id=r.booking_order_id and status='prepared';
 else
  select * into p from public.payments where registration_id=r.id for update;
  if not found or p.status<>'pending' or p.discount_checkout_state is distinct from 'prepared' or p.provider_ref is not null then raise exception 'discount_payment_locked'; end if;
 end if;
 original:=coalesce(r.discount_original_cents,r.total_amount);
 mode:=o.fee_mode;
 if nullif(btrim(p_code),'') is not null then
  select * into d from public.discount_codes where org_id=r.org_id and code=upper(btrim(p_code)) for update;
  if not found then raise exception 'discount_invalid'; end if;
  if r.discount_code=d.code then return jsonb_build_object('code',r.discount_code,'discount_cents',r.discount_amount_cents,'total_cents',r.total_amount,'snapshot',r.discount_snapshot); end if;
  if not d.active or (d.starts_at is not null and d.starts_at>statement_timestamp()) or (d.ends_at is not null and d.ends_at<=statement_timestamp()) then raise exception 'discount_inactive'; end if;
  if d.scope='events' and not r.event_id=any(d.event_ids) or d.scope='categories' and not r.category_id=any(d.category_ids) then raise exception 'discount_ineligible'; end if;
  if d.assigned_passport_id is not null and d.assigned_passport_id<>r.participant_passport_id then raise exception 'discount_wrong_passport'; end if;
  if exists(select 1 from public.discount_redemptions where code_id=d.id and passport_id=r.participant_passport_id and state<>'released') then raise exception 'discount_already_used'; end if;
  select count(*) into uses from public.discount_redemptions where code_id=d.id and state<>'released';
  if d.max_uses is not null and uses>=d.max_uses then raise exception 'discount_exhausted'; end if;
    -- Add-ons are already frozen on registration; derive entry from that frozen
  -- total so later category price edits cannot enlarge the eligible amount.
  eligible:=case when d.coverage='subtotal' then original else greatest(0,original-coalesce((select sum(price)::integer from public.registration_addons where registration_id=r.id),0)) end;
  savings:=least(eligible,case when d.discount_type='flat' then d.value else round(eligible::numeric*d.value/10000)::integer end);
  if d.absorb_fees then mode:='absorb'; end if;
  snap:=jsonb_build_object('code_id',d.id,'code',d.code,'kind',d.kind,'discount_type',d.discount_type,'value',d.value,'coverage',d.coverage,'absorb_fees',d.absorb_fees,'fee_mode',mode);
 end if;
 fee:=least(original-savings,case when o.commission_type='fixed' then o.commission_flat_cents else round((original-savings)::numeric*coalesce(o.commission_rate,0.10))::integer end);
 if original-savings>0 and original-savings<100 then raise exception 'discount_balance_too_small'; end if;
 if original-savings>0 and mode='absorb' and not exists(select 1 from public.processor_rates where provider='paymongo' and scope='local' and effective_from<=statement_timestamp() and (effective_to is null or effective_to>statement_timestamp())) then raise exception 'rate_card_missing'; end if;
 if original-savings>0 and mode='absorb' and exists(select 1 from public.processor_rates where provider='paymongo' and method in ('card','gcash','paymaya','qrph')
   and effective_from<=statement_timestamp() and (effective_to is null or effective_to>statement_timestamp())
   and original-savings-fee < round((original-savings)::numeric*percent_bps/10000)+fixed_cents) then raise exception 'discount_fees_exceed_balance'; end if;
 update public.discount_redemptions set state='released' where registration_id=r.id and state='reserved';
 if d.id is not null then insert into public.discount_redemptions(org_id,code_id,registration_id,passport_id,original_cents,discount_cents,snapshot)
  values(r.org_id,d.id,r.id,r.participant_passport_id,original,savings,snap); end if;
 update public.registrations set total_amount=original-savings,discount_original_cents=original,discount_amount_cents=savings,discount_code=d.code,discount_snapshot=snap where id=r.id;
 if r.booking_order_id is null then
  perform set_config('racepace.allow_checkout_reprice','on',true);
  update public.payments set amount=original-savings+case when mode='pass_on' then fee else 0 end,
   checkout_fee_mode=mode,checkout_platform_fee=fee,checkout_provider_managed_fee=(mode='pass_on' and provider='paymongo'),
   checkout_request=checkout_request||jsonb_build_object('amount',original-savings+case when mode='pass_on' then fee else 0 end,
    'passOnFees',mode='pass_on' and provider='paymongo','lineItems',jsonb_build_array(jsonb_build_object('name','Race registration','amount',original-savings+case when mode='pass_on' then fee else 0 end)),
    'metadata',jsonb_build_object('fee_mode',mode,'platform_fee_cents',fee::text)) where id=p.id;
 end if;
 return jsonb_build_object('code',d.code,'discount_cents',savings,'total_cents',original-savings,'snapshot',snap);
end $$;
revoke all on function public.discount_apply(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.discount_apply(uuid,uuid,text) to service_role;

-- Registration settlement consumes the reserved code inside the same transaction.
-- Expired/cancelled entries release it only once their provider state is terminal.
create function public.discount_registration_lifecycle() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='paid' then
  update public.discount_redemptions set state='redeemed',redeemed_at=now() where registration_id=new.id and state='reserved';
 elsif new.status in ('expired','cancelled') and not exists(select 1 from public.payments p where p.registration_id=new.id and p.status='pending' and p.discount_checkout_state is distinct from 'prepared')
  and not exists(select 1 from public.booking_payment_attempts a where a.booking_order_id=new.booking_order_id and a.status in ('creating','ready','creation_unknown','reconciliation_required')) then
  update public.discount_redemptions set state='released' where registration_id=new.id and state='reserved';
 end if;
 return new;
end $$;
revoke all on function public.discount_registration_lifecycle() from public,anon,authenticated;
grant execute on function public.discount_registration_lifecycle() to service_role;
create trigger discount_registration_lifecycle after update of status on public.registrations for each row execute function public.discount_registration_lifecycle();

create function public.discount_claim_single(p_actor uuid,p_registration uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.registrations%rowtype; p public.payments%rowtype;
begin
 perform 1 from public.events where id=(select event_id from public.registrations where id=p_registration) for update;
 select * into r from public.registrations where id=p_registration for update;
 if not found or coalesce(r.booked_by_user_id,r.user_id)<>p_actor or r.booking_order_id is not null then raise exception 'registration_not_found'; end if;
 select * into p from public.payments where registration_id=r.id for update;
 if r.status<>'pending' or r.expires_at is null or r.expires_at<=statement_timestamp() then raise exception 'hold_expired'; end if;
 if not exists(select 1 from public.events where id=r.event_id and status in ('open','almost_full')) or not exists(select 1 from public.organizations where id=r.org_id and is_active) then raise exception 'registration_closed'; end if;
 if p.discount_checkout_state is distinct from 'prepared' then raise exception 'discount_payment_locked'; end if;
 if r.total_amount=0 then return jsonb_build_object('action','free','event_id',r.event_id); end if;
 update public.payments set discount_checkout_state='creating' where id=p.id;
 return jsonb_build_object('action','dispatch','provider',p.provider,'request',p.checkout_request);
end $$;
revoke all on function public.discount_claim_single(uuid,uuid) from public,anon,authenticated;
grant execute on function public.discount_claim_single(uuid,uuid) to service_role;

-- Preserve payment preparation guards and immutable original order totals.
CREATE OR REPLACE FUNCTION public.booking_order_prepare_payment(p_actor uuid, p_order uuid, p_method text, p_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.booking_orders%rowtype; v_org public.organizations%rowtype;
  v_attempt public.booking_payment_attempts%rowtype; v_rate public.processor_rates%rowtype;
  v_method text := case when p_method='maya' then 'paymaya' else p_method end;
  v_lines jsonb; v_count bigint; v_base bigint; v_commission bigint;
  v_target bigint; v_gross bigint; v_surcharge bigint; v_predicted bigint;
  v_terms jsonb; v_modes integer;
begin
  perform 1 from public.events where id=(select event_id from public.booking_orders where id=p_order) for update;
  if p_key is null or p_order is null or v_method is null or v_method not in ('card','gcash','paymaya','qrph')
  then raise exception 'invalid_input' using errcode='22023'; end if;
  perform 1 from auth.users where id=p_actor and email_confirmed_at is not null and not coalesce(is_anonymous,false) for share;
  if not found then raise exception 'booking_email_unverified' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('payment:'||p_actor::text||':'||p_key::text,0));
  select * into v_order from public.booking_orders where id=p_order and booked_by_user_id=p_actor for update;
  if not found then raise exception 'order_not_found' using errcode='42501'; end if;
  if v_order.status<>'pending' then raise exception 'order_not_pending' using errcode='22023'; end if;
  if v_order.expires_at is null or v_order.expires_at<=statement_timestamp()
  then raise exception 'hold_expired' using errcode='22023'; end if;
  perform 1 from public.events where id=v_order.event_id and org_id=v_order.org_id and status in ('open','almost_full') for share;
  if not found then raise exception 'registration_closed' using errcode='22023'; end if;
  select * into v_org from public.organizations where id=v_order.org_id for share;
  if not v_org.is_active then raise exception 'org_suspended' using errcode='22023'; end if;
  perform 1 from public.registrations where booking_order_id=p_order order by id for share;
  select count(*),coalesce(sum(total_amount),0) into v_count,v_base from public.registrations where booking_order_id=p_order;
  if v_count<1 or v_count>10 or v_count is distinct from jsonb_array_length(v_order.reservation_request->'participants')
    or (select sum(coalesce(discount_original_cents,total_amount)) from public.registrations where booking_order_id=p_order) is distinct from v_order.entry_total_cents or exists(select 1 from public.registrations r where booking_order_id=p_order
      and (r.status<>'pending' or r.expires_at is null or r.expires_at<=statement_timestamp() or r.total_amount<0
        or r.event_id<>v_order.event_id or r.org_id<>v_order.org_id))
  then raise exception 'order_entries_changed' using errcode='22023'; end if;

  select * into v_attempt from public.booking_payment_attempts where booked_by_user_id=p_actor and idempotency_key=p_key for update;
  if found then
    if v_attempt.booking_order_id<>p_order or v_attempt.method<>v_method
    then raise exception 'idempotency_conflict' using errcode='22023'; end if;
    return public.booking_payment_preparation_result(v_attempt.id);
  end if;
  if exists(select 1 from public.booking_payment_attempts where booking_order_id=p_order and status not in ('failed','expired'))
  then raise exception 'payment_attempt_in_progress' using errcode='22023'; end if;
  select count(distinct coalesce(discount_snapshot->>'fee_mode',v_org.fee_mode)) into v_modes
    from public.registrations where booking_order_id=p_order and total_amount>0;
  if v_modes>1 then raise exception 'discount_mixed_fee_modes'; end if;
  select coalesce(min(coalesce(discount_snapshot->>'fee_mode',v_org.fee_mode)),v_org.fee_mode) into v_org.fee_mode
    from public.registrations where booking_order_id=p_order and total_amount>0;
  if v_org.commission_rate<0 or v_org.commission_flat_cents<0
  then raise exception 'invalid_terms' using errcode='22023'; end if;
  select jsonb_agg(jsonb_build_object('id',r.id,'base',r.total_amount,'fee',
    least(r.total_amount,case when v_org.commission_type='fixed' then v_org.commission_flat_cents
      else round(r.total_amount::numeric*coalesce(v_org.commission_rate,0.10))::bigint end)) order by r.id)
    into v_lines from public.registrations r where r.booking_order_id=p_order;
  select sum((x->>'fee')::bigint) into v_commission from jsonb_array_elements(v_lines) x;
  if v_base>0 and v_org.fee_mode='absorb' then
    select * into v_rate from public.processor_rates where provider='paymongo' and method=v_method and scope='local'
      and effective_from<=statement_timestamp() and (effective_to is null or effective_to>statement_timestamp())
      order by effective_from desc,id limit 1 for share;
    if not found then raise exception 'rate_card_missing' using errcode='22023'; end if;
    if v_rate.percent_bps>=10000 then raise exception 'invalid_processor_rate' using errcode='22023'; end if;
  end if;
  v_target := v_base+case when v_org.fee_mode='pass_on' then v_commission else 0 end;
  v_gross := case when v_base=0 then 0 when v_org.fee_mode='absorb' then v_base else v_target end;
  v_surcharge := case when v_org.fee_mode='pass_on' then v_gross-v_target else 0 end;
  v_predicted := case when v_gross=0 or v_org.fee_mode='pass_on' then 0
    else (v_gross*v_rate.percent_bps+5000)/10000+v_rate.fixed_cents end;
  if greatest(v_base,v_commission,v_gross,v_surcharge,v_predicted)>2147483647
  then raise exception 'order_amount_too_large' using errcode='22023'; end if;
  if v_gross>0 and v_gross<100 then raise exception 'discount_balance_too_small'; end if;
  if v_gross-v_commission-v_predicted<0 then raise exception 'discount_fees_exceed_balance'; end if;
  v_terms := jsonb_build_object('fee_mode',v_org.fee_mode,'commission_type',v_org.commission_type,
    'commission_bps',round(coalesce(v_org.commission_rate,0.10)*10000),'commission_flat_cents',v_org.commission_flat_cents,
    'rate_id',v_rate.id,'percent_bps',coalesce(v_rate.percent_bps,0),'fixed_cents',coalesce(v_rate.fixed_cents,0),
    'provider_managed_fee',v_org.fee_mode='pass_on', 'discounts',(select jsonb_agg(jsonb_build_object('registration_id',id,'snapshot',discount_snapshot,'discount_cents',discount_amount_cents)) from public.registrations where booking_order_id=p_order));
  insert into public.booking_payment_attempts(org_id,booking_order_id,booked_by_user_id,idempotency_key,method,
    terms_snapshot,base_cents,platform_fee_cents,processor_surcharge_cents,gross_cents,processor_fee_predicted_cents,net_to_org_predicted_cents)
  values(v_order.org_id,p_order,p_actor,p_key,v_method,v_terms,v_base,v_commission,v_surcharge,v_gross,v_predicted,v_gross-v_commission-v_predicted)
  returning * into v_attempt;

  -- First allocate surcharge on pre-processor payable weights, then allocate
  -- predicted processor cost on final gross. Stable UUID ties preserve centavos.
  with entries as (
    select (x->>'id')::uuid id,(x->>'base')::bigint base,(x->>'fee')::bigint fee,
      (x->>'base')::bigint+case when v_org.fee_mode='pass_on' then (x->>'fee')::bigint else 0 end weight
    from jsonb_array_elements(v_lines) x
  ), surcharge_floor as (
    select *,case when v_target=0 then 0 else v_surcharge*weight/v_target end part,
      case when v_target=0 then 0 else v_surcharge*weight%v_target end remainder from entries
  ), surcharge_ranked as (
    select *,row_number() over(order by remainder desc,id) rn,sum(part) over() parts from surcharge_floor
  ), gross_lines as (
    select *,part+case when rn<=v_surcharge-parts then 1 else 0 end surcharge,
      weight+part+case when rn<=v_surcharge-parts then 1 else 0 end gross from surcharge_ranked
  ), fee_floor as (
    select *,case when v_gross=0 then 0 else v_predicted*gross/v_gross end fee_part,
      case when v_gross=0 then 0 else v_predicted*gross%v_gross end fee_remainder from gross_lines
  ), fee_ranked as (
    select *,row_number() over(order by fee_remainder desc,id) fee_rn,sum(fee_part) over() fee_parts from fee_floor
  ), final as (
    select *,fee_part+case when fee_rn<=v_predicted-fee_parts then 1 else 0 end processor from fee_ranked
  ) insert into public.booking_payment_quote_lines(attempt_id,org_id,registration_id,base_cents,platform_fee_cents,
    processor_surcharge_cents,gross_cents,processor_fee_predicted_cents,net_to_org_predicted_cents)
    select v_attempt.id,v_order.org_id,id,base,fee,surcharge,gross,processor,gross-fee-processor from final;
  return public.booking_payment_preparation_result(v_attempt.id);
end $function$;

revoke all on function public.booking_order_prepare_payment(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.booking_order_prepare_payment(uuid,uuid,text,uuid) to service_role;


alter table public.booking_payment_captures alter column payment_id drop not null;
alter table public.booking_payment_captures add column settlement_kind text not null default 'provider' check(settlement_kind in ('provider','complimentary'));
alter table public.booking_payment_captures add constraint booking_capture_identity check((settlement_kind='provider' and payment_id is not null) or (settlement_kind='complimentary' and payment_id is null));

create function public.discount_confirm_free(p_actor uuid,p_registration uuid,p_order uuid,p_tokens jsonb) returns text
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
  if r.prescreening_application_id is not null and not exists(select 1 from public.prescreening_applications app join public.prescreening_batches b on b.id=app.batch_id
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

-- Terminal payment updates can follow the registration update in expiry RPCs.
create function public.discount_release_terminal() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.discount_redemptions d set state='released' from public.registrations r
 where d.registration_id=r.id and d.state='reserved' and r.status in ('expired','cancelled')
 and (case when tg_table_name='payments' then r.id=(to_jsonb(new)->>'registration_id')::uuid else r.booking_order_id=(to_jsonb(new)->>'booking_order_id')::uuid end)
 and not exists(select 1 from public.payments p where p.registration_id=r.id and p.status='pending' and p.discount_checkout_state is distinct from 'prepared')
 and not exists(select 1 from public.booking_payment_attempts a where a.booking_order_id=r.booking_order_id and a.status in ('creating','ready','creation_unknown','reconciliation_required'));
 return new;
end $$;
revoke all on function public.discount_release_terminal() from public,anon,authenticated;
grant execute on function public.discount_release_terminal() to service_role;
create trigger discount_payment_terminal after update of status on public.payments for each row execute function public.discount_release_terminal();
create trigger discount_group_terminal after update of status on public.booking_payment_attempts for each row execute function public.discount_release_terminal();

create or replace view public.admin_payments_v with(security_invoker=true) as
SELECT p.registration_id,
    p.org_id,
    r.event_id,
    e.name AS event_name,
    r.user_id,
    COALESCE(NULLIF(btrim(r.custom_data ->> 'full_name'::text), ''::text), pr.full_name) AS full_name,
    p.amount,
    p.platform_fee,
    p.net_to_org,
    p.method,
    p.status,
    p.created_at,
    p.refunded_amount,
    pr.avatar_url,
    p.processor_fee_cents,
    p.processor_fee_source,
    p.paid_at, p.id as payment_id, null::uuid as booking_order_id, 1::integer as participant_count, r.discount_code, r.discount_amount_cents
   FROM payments p
     JOIN registrations r ON r.id = p.registration_id
     LEFT JOIN events e ON e.id = r.event_id
     LEFT JOIN profiles pr ON pr.id = r.user_id
 union all
 select null::uuid,g.org_id,g.event_id,min(g.event_name),null::uuid,string_agg(g.full_name,', ' order by g.registration_id),
   sum(g.amount)::integer,sum(g.platform_fee)::integer,
   case when count(*) filter(where g.net_to_org is null)>0 then null else sum(g.net_to_org)::integer end,
   coalesce(min(g.method) filter(where g.amount>0),min(g.method)),case when bool_or(g.status='partially_refunded') then 'partially_refunded' else 'paid' end::public.payment_status,
   min(g.paid_at),sum(g.refunded_amount)::integer,null::text,
   case when count(*) filter(where g.processor_fee_cents is null)>0 then null else sum(g.processor_fee_cents)::integer end,
   case when count(*) filter(where g.processor_fee_cents is null)>0 then 'unreconciled' else 'actual' end,
   min(g.paid_at),g.payment_id,g.booking_order_id,count(*)::integer,
   (select string_agg(distinct r.discount_code,', ' order by r.discount_code) from public.registrations r where r.booking_order_id=g.booking_order_id),
   (select coalesce(sum(r.discount_amount_cents),0)::integer from public.registrations r where r.booking_order_id=g.booking_order_id)
 from public.admin_group_allocations_v g group by g.org_id,g.event_id,g.payment_id,g.booking_order_id;


create or replace view public.admin_registrations_v with(security_invoker=true) as
SELECT r.id,
    r.org_id,
    r.event_id,
    r.user_id,
    COALESCE(NULLIF(btrim(r.custom_data ->> 'full_name'::text), ''::text), pr.full_name) AS full_name,
    COALESCE(NULLIF(btrim(r.custom_data ->> 'bib_name'::text), ''::text), pr.bib_name) AS bib_name,
    r.category_id,
    c.label AS category_label,
    r.total_amount,
    p.status AS payment_status,
    p.method AS payment_method,
    r.custom_data,
    r.created_at,
    pr.avatar_url,
    r.status AS registration_status,
    p.refunded_amount,
    p.amount AS payment_amount, r.booking_order_id, p.payment_id, r.discount_code, r.discount_amount_cents
   FROM registrations r
     LEFT JOIN profiles pr ON pr.id = r.user_id
     LEFT JOIN categories c ON c.id = r.category_id
     LEFT JOIN public.admin_participant_money_v p ON p.registration_id = r.id;

-- A checkout create can time out before its PayMongo session is bound locally.
-- Keep the hold visible to platform staff even after an expiry worker tries it.
create or replace function public.platform_unbound_checkout_reviews()
returns table (
  registration_id uuid,
  event_id uuid,
  event_name text,
  org_id uuid,
  org_name text,
  amount_cents integer,
  expires_at timestamptz,
  latest_outcome text,
  attempts integer,
  last_attempt_at timestamptz,
  capture_count integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.auth_is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select r.id, e.id, e.name, o.id, o.name, p.amount, r.expires_at,
      a.outcome, coalesce(a.attempts, 0), a.last_attempt_at,
      (select count(*)::integer from public.single_payment_captures c
       where c.registration_id = r.id)
    from public.registrations r
    join public.payments p on p.registration_id = r.id
    join public.events e on e.id = r.event_id
    join public.organizations o on o.id = r.org_id
    left join public.provider_session_expiry_attempts a on a.registration_id = r.id
    where r.status = 'pending'
      and r.booking_order_id is null
      and p.status = 'pending'
      and p.provider = 'paymongo'
      and p.discount_checkout_state is distinct from 'prepared'
      and p.provider_ref is null
      and p.checkout_url is null
    order by a.last_attempt_at desc nulls last, r.created_at, r.id;
end $$;

revoke all on function public.platform_unbound_checkout_reviews() from public, anon, authenticated;
grant execute on function public.platform_unbound_checkout_reviews() to authenticated;

create view public.admin_discount_codes_v with(security_invoker=true) as
 select d.*,
 (select count(*)::integer from public.discount_redemptions r where r.code_id=d.id and r.state='reserved') as reserved,
 (select count(*)::integer from public.discount_redemptions r where r.code_id=d.id and r.state='redeemed') as redeemed
 from public.discount_codes d;
revoke all on public.admin_discount_codes_v from public,anon;
grant select on public.admin_discount_codes_v to authenticated,service_role;

-- Undispatched web checkouts have no provider-side uncertainty. Expire under
-- the same event lock as dispatch so a worker cannot release an active charge.
create function public.discount_expire_prepared(p_registration uuid) returns text
language plpgsql security definer set search_path='' as $$
declare r public.registrations%rowtype; p public.payments%rowtype;
begin
 perform 1 from public.events where id=(select event_id from public.registrations where id=p_registration) for update;
 select * into r from public.registrations where id=p_registration for update;
 select * into p from public.payments where registration_id=p_registration for update;
 if r.status<>'pending' or r.expires_at is null or r.expires_at>statement_timestamp() then return 'not_due'; end if;
 if p.status<>'pending' or p.discount_checkout_state is distinct from 'prepared' or p.provider_ref is not null then return 'provider_unresolved'; end if;
 update public.payments set status='failed' where id=p.id;
 update public.registrations set status='expired',expires_at=null where id=r.id;
 return 'expired';
end $$;
revoke all on function public.discount_expire_prepared(uuid) from public,anon,authenticated;
grant execute on function public.discount_expire_prepared(uuid) to service_role;

create table public.discount_checkout_restarts (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
 registration_id uuid not null references public.registrations(id) on delete cascade,
 old_provider_ref text not null unique, old_request jsonb not null, provider_evidence jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.discount_checkout_restarts enable row level security;
revoke all on public.discount_checkout_restarts from public,anon,authenticated;
grant all on public.discount_checkout_restarts to service_role;
create function public.discount_restart_single(p_actor uuid,p_registration uuid,p_session text,p_evidence jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare r public.registrations%rowtype; p public.payments%rowtype;
begin
 perform 1 from public.events where id=(select event_id from public.registrations where id=p_registration) for update;
 perform pg_advisory_xact_lock(hashtextextended('single_capture:'||p_registration::text,0));
 select * into r from public.registrations where id=p_registration for update;
 if not found or coalesce(r.booked_by_user_id,r.user_id)<>p_actor or r.booking_order_id is not null then raise exception 'registration_not_found'; end if;
 select * into p from public.payments where registration_id=r.id for update;
 if r.status<>'pending' or r.expires_at is null or r.expires_at<=statement_timestamp() then raise exception 'hold_expired'; end if;
 if p.status<>'pending' or p.provider<>'paymongo' or p.provider_ref is distinct from p_session or p_session is null or p.checkout_request is null
 or p_evidence->>'source' is distinct from 'paymongo_get' or p_evidence->>'status' is distinct from 'expired'
 or exists(select 1 from public.single_payment_captures where registration_id=r.id)
 or exists(select 1 from public.pending_checkout_reprice_attempts where registration_id=r.id and outcome in ('creating','unknown')) then raise exception 'discount_payment_locked'; end if;
 insert into public.discount_checkout_restarts(org_id,registration_id,old_provider_ref,old_request,provider_evidence) values(r.org_id,r.id,p_session,p.checkout_request,p_evidence);
 update public.payments set provider_ref=null,checkout_url=null,discount_checkout_state='prepared' where id=p.id;
 return 'prepared';
end $$;
revoke all on function public.discount_restart_single(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.discount_restart_single(uuid,uuid,text,jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.admin_cancel_registration(p_registration_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org_id uuid;
  v_status public.registration_status;
  v_payment_status public.payment_status;
begin
  perform 1 from public.events where id=(select event_id from public.registrations where id=p_registration_id) for update;
  select r.org_id, r.status, p.status
    into v_org_id, v_status, v_payment_status
  from public.registrations r
  left join public.payments p on p.registration_id = r.id
  where r.id = p_registration_id
  for update of r;

  if not found then
    return 'not_found';
  end if;

  if not public.auth_can_admin_org(v_org_id) then
    return 'unauthorized';
  end if;

  if v_status = 'cancelled' then
    return 'already';
  end if;

  if v_status='paid' and exists(select 1 from public.registrations where id=p_registration_id and total_amount=0 and discount_amount_cents>0)
    and (exists(select 1 from public.payments where registration_id=p_registration_id and provider='complimentary' and amount=0 and status='paid')
      or exists(select 1 from public.booking_payment_allocations a join public.booking_payment_captures c on c.id=a.capture_id
        where a.registration_id=p_registration_id and c.state='fulfilled' and a.gross_cents=0 and a.platform_fee_cents=0 and a.processor_fee_cents=0 and a.net_to_org_cents=0)) then
    if exists(select 1 from public.checkins where registration_id=p_registration_id) then return 'not_cancellable'; end if;
    update public.categories set slots_taken=greatest(0,slots_taken-1) where id=(select category_id from public.registrations where id=p_registration_id);
    update public.registrations set status='cancelled',ticket_token=null where id=p_registration_id;
    return 'cancelled';
  end if;

  if v_status <> 'pending' then
    return 'not_cancellable';
  end if;

  -- Non-terminal: the checkout could still complete out from under us.
  if v_payment_status = 'pending' then
    return 'payment_in_flight';
  end if;

  -- Terminal, but money already moved (or moved and came back) — belongs to
  -- refund_registration_tx, not here. Not expected to coexist with
  -- registrations.status = 'pending' today, but rejected explicitly rather
  -- than assumed unreachable.
  if v_payment_status in ('paid', 'refunded') then
    return 'not_cancellable';
  end if;

  -- v_payment_status is null (no payments row at all) or 'failed' (checkout
  -- never captured money): safe. No slot to release — see header comment.
  update public.registrations set status = 'cancelled' where id = p_registration_id;

  return 'cancelled';
end;
$function$;

revoke all on function public.admin_cancel_registration(uuid) from public,anon;
grant execute on function public.admin_cancel_registration(uuid) to authenticated;


CREATE OR REPLACE FUNCTION public.booking_payment_confirm(p_attempt uuid, p_capture jsonb, p_tokens jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.booking_payment_attempts%rowtype; o public.booking_orders%rowtype; d public.booking_payment_dispatches%rowtype;
  c public.booking_payment_captures%rowtype; v_n integer; v_reason text; v_fee integer;
  v_provider_managed boolean; v_excess integer:=0; v_reserved_paid_at timestamptz;
begin
  perform 1 from public.events where id=(select lock_order.event_id from public.booking_orders lock_order join public.booking_payment_attempts lock_attempt on lock_attempt.booking_order_id=lock_order.id where lock_attempt.id=p_attempt) for update;
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
            or v_reserved_paid_at>coalesce((select greatest(p.entry_payment_deadline_at,cat.entry_payment_deadline_at)
              from public.event_reservation_places p join public.categories cat on cat.id=p.category_id
              where p.reservation_id=er.id and p.participant_passport_id=r.participant_passport_id),er.registration_deadline_at)
            or (exists (select 1 from public.event_reservation_places p
                  where p.reservation_id=er.id)
              and not exists (select 1 from public.event_reservation_places p
                where p.reservation_id=er.id and p.participant_passport_id=r.participant_passport_id
                  and p.status='held')))
    ) then v_reason:='reservation_deadline_passed'; end if;
  end if;
  -- A provider callback can arrive later than its capture. Require an actual
  -- capture time within the original window and a hold that was never released.
  if v_reason is null and o.reservation_request->>'prescreening_batch_id' is not null then
    begin
      v_reserved_paid_at:=(p_capture->>'paidAt')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      v_reserved_paid_at:=null;
    end;
    if v_reserved_paid_at is null or not exists(select 1 from public.prescreening_batches b
      where b.id=(o.reservation_request->>'prescreening_batch_id')::uuid and b.booking_order_id=o.id
      and b.status='ready' and b.checkout_intent='entry' and v_reserved_paid_at<=b.payment_deadline_at
      and not exists(select 1 from public.prescreening_applications a where a.batch_id=b.id
        and a.decision<>'rejected' and (a.released_at is not null or a.decision not in ('approved','not_required')))) then
      v_reason:='prescreening_payment_window_ended';
    end if;
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
            case when v_provider_managed and registration_id=(select q.registration_id from public.booking_payment_quote_lines q where q.attempt_id=a.id and q.gross_cents>0 order by q.registration_id limit 1) then v_excess else 0 end,
          platform_fee_cents,fee,
          gross_cents::bigint+case when v_provider_managed then fee else 0 end+
            case when v_provider_managed and registration_id=(select q.registration_id from public.booking_payment_quote_lines q where q.attempt_id=a.id and q.gross_cents>0 order by q.registration_id limit 1) then v_excess else 0 end-platform_fee_cents-fee
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
end $function$;

revoke all on function public.booking_payment_confirm(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.booking_payment_confirm(uuid,jsonb,jsonb) to service_role;


alter table public.booking_payment_allocations add constraint discount_allocation_nonnegative check(net_to_org_cents is null or net_to_org_cents>=0) not valid;

create or replace function public.admin_group_financial_lines()
returns table(registration_id uuid,org_id uuid,event_id uuid,event_name text,user_id uuid,full_name text,
 category_label text,created_at timestamptz,paid_at timestamptz,booking_order_id uuid,payment_id uuid,
 participant_count integer,amount integer,platform_fee integer,processor_fee_cents integer,processor_fee_source text,
 net_to_org integer,refunded_amount integer,method text,status public.payment_status,
 payout_statement_id uuid,payout_clawback_id uuid)
language sql stable security definer set search_path='' as $$
 select r.id,a.org_id,r.event_id,e.name,r.user_id,
   coalesce(nullif(btrim(r.custom_data->>'full_name'),''),pr.full_name),cat.label,r.created_at,c.created_at,
   c.booking_order_id,c.id,1,a.gross_cents,a.platform_fee_cents,a.processor_fee_cents,
   case when a.gross_cents=0 then 'none' when a.processor_fee_cents is null then 'unreconciled' else 'actual' end,
   a.net_to_org_cents-coalesce(ref.amount,0),coalesce(ref.amount,0),case when a.gross_cents=0 then 'complimentary' else attempt.method end,
   case when ref.request_id is null then 'paid' else 'partially_refunded' end::public.payment_status,
   a.payout_statement_id,a.payout_clawback_id
 from public.booking_payment_allocations a
 join public.booking_payment_captures c on c.id=a.capture_id and c.state='fulfilled'
 join public.booking_payment_attempts attempt on attempt.id=c.attempt_id
 join public.registrations r on r.id=a.registration_id
 join public.events e on e.id=r.event_id
 join public.categories cat on cat.id=r.category_id
 left join public.profiles pr on pr.id=r.user_id
 left join lateral (
   select sum(l.refund_amount)::integer amount,min(q.id::text) request_id
   from public.booking_refund_lines l join public.booking_refund_requests q on q.id=l.request_id and q.status='succeeded'
   where l.capture_id=a.capture_id and l.registration_id=a.registration_id
 ) ref on true
 where public.auth_can_admin_org(a.org_id) or auth.role()='service_role';
$$;
revoke all on function public.admin_group_financial_lines() from public,anon;
grant execute on function public.admin_group_financial_lines() to authenticated,service_role;

create or replace function public.begin_pending_checkout_reprice(
  p_registration_id uuid,p_old_session_id text,p_target_total integer
) returns text language plpgsql security invoker set search_path = '' as $$
declare p public.payments%rowtype; prior public.pending_checkout_reprice_attempts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('single_capture:'||p_registration_id::text,0));
  select * into p from public.payments where registration_id=p_registration_id for update;
  if exists(select 1 from public.registrations where id=p_registration_id and discount_original_cents is not null) then return 'discount_locked'; end if;
  if p.id is null or p.status<>'pending' or p.provider_ref is distinct from p_old_session_id
    then return 'mismatch'; end if;
  if exists(select 1 from public.single_payment_captures where registration_id=p_registration_id)
    then return 'capture_pending'; end if;
  select * into prior from public.pending_checkout_reprice_attempts where registration_id=p_registration_id;
  if prior.registration_id is not null and prior.old_provider_ref=p_old_session_id
     and prior.outcome not in ('provider_rejected','replacement_expired') then return 'already_claimed'; end if;
  insert into public.pending_checkout_reprice_attempts(
    registration_id,old_provider_ref,target_total,outcome
  ) values (p_registration_id,p_old_session_id,p_target_total,'creating')
  on conflict (registration_id) do update set
    old_provider_ref=excluded.old_provider_ref,new_provider_ref=null,
    target_total=excluded.target_total,outcome='creating',detail='{}'::jsonb,
    attempts=public.pending_checkout_reprice_attempts.attempts+1,updated_at=now();
  return 'claimed';
end $$;

create or replace function public.replace_pending_checkout_pricing(
  p_registration_id uuid,
  p_old_session_id text,
  p_new_session_id text,
  p_checkout_url text,
  p_total integer,
  p_payment_amount integer,
  p_platform_fee integer,
  p_checkout_request jsonb
) returns text language plpgsql security invoker set search_path = '' as $$
declare r public.registrations%rowtype; p public.payments%rowtype; expected_total integer;
begin
  if p_old_session_id !~ '^cs_[A-Za-z0-9_-]+$'
     or p_new_session_id !~ '^cs_[A-Za-z0-9_-]+$'
     or p_checkout_url not like 'https://checkout.paymongo.com/%'
     or p_total < 0 or p_payment_amount < p_total or p_platform_fee < 0 then
    return 'invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('single_capture:'||p_registration_id::text,0));
  select * into r from public.registrations where id=p_registration_id for update;
  select * into p from public.payments where registration_id=p_registration_id for update;
  if exists(select 1 from public.registrations where id=p_registration_id and discount_original_cents is not null) then return 'discount_locked'; end if;
  if r.id is null or p.id is null then return 'not_found'; end if;
  if r.status<>'pending' or p.status<>'pending' then return 'already_final'; end if;
  if p.provider<>'paymongo' or p.provider_ref is distinct from p_old_session_id then return 'mismatch'; end if;
  if exists(select 1 from public.single_payment_captures where registration_id=p_registration_id)
    then return 'capture_pending'; end if;

  select c.base_price + coalesce(sum(a.price),0)::integer into expected_total
  from public.categories c
  left join public.registration_addons ra on ra.registration_id=r.id
  left join public.addons a on a.id=ra.addon_id
  where c.id=r.category_id
  group by c.base_price;
  if expected_total is null or expected_total<>p_total then return 'prices_changed'; end if;

  perform set_config('racepace.allow_checkout_reprice','on',true);
  insert into public.payment_checkout_revisions(
    registration_id,old_provider_ref,new_provider_ref,old_amount,new_amount,old_request,new_request
  ) values (r.id,p.provider_ref,p_new_session_id,p.amount,p_payment_amount,p.checkout_request,p_checkout_request);
  update public.registration_addons ra set price=a.price
    from public.addons a where ra.registration_id=r.id and a.id=ra.addon_id;
  update public.registrations set total_amount=p_total where id=r.id;
  update public.payments set provider_ref=p_new_session_id,checkout_url=p_checkout_url,
    amount=p_payment_amount,checkout_platform_fee=p_platform_fee,
    checkout_request=p_checkout_request where id=p.id;
  return 'replaced';
end $$;

CREATE OR REPLACE FUNCTION public.admin_registration_aggregates(p_event_id uuid, p_status text DEFAULT 'all'::text, p_category_id text DEFAULT 'all'::text, p_q text DEFAULT ''::text)
 RETURNS TABLE(total integer, paid integer, gross_cents bigint, refund_count integer, refunded_cents bigint, new_this_week integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    count(*)::int                                                              as total,
    count(*) filter (where v.payment_status in ('paid', 'partially_refunded'))::int                     as paid,
    coalesce(sum(v.payment_amount::bigint - v.refunded_amount) filter (where v.payment_status in ('paid', 'partially_refunded')), 0)::bigint    as gross_cents,
    count(*) filter (where v.payment_status in ('refunded', 'partially_refunded'))::int                 as refund_count,
    -- Actual returned amount, not the base price or original charge.
    coalesce(sum(v.refunded_amount) filter (where v.payment_status in ('refunded', 'partially_refunded')), 0)::bigint as refunded_cents,
    count(*) filter (where v.created_at >= now() - interval '7 days')::int     as new_this_week
  from public.admin_registrations_v v
  where v.event_id = p_event_id
    and (
      p_status = 'all'
      or (p_status in ('expired', 'cancelled') and v.registration_status::text = p_status)
      or (p_status not in ('expired', 'cancelled') and v.payment_status::text = p_status)
    )
    and (p_category_id = 'all' or v.category_id::text = p_category_id)
    and (
      p_q = '' or
      v.discount_code ilike p_q or v.full_name ilike p_q or
      v.bib_name ilike p_q
    )
$function$;

CREATE OR REPLACE FUNCTION public.admin_payment_aggregates(p_org_id uuid, p_status text DEFAULT 'all'::text, p_method text DEFAULT 'all'::text, p_q text DEFAULT ''::text, p_event_id text DEFAULT 'all'::text)
 RETURNS TABLE(gross_cents bigint, fee_cents bigint, net_cents bigint, refunded_cents bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    coalesce(sum(v.amount - v.refunded_amount)
                                 filter (where v.status in ('paid','partially_refunded')), 0)::bigint as gross_cents,
    coalesce(sum(v.platform_fee) filter (where v.status in ('paid','partially_refunded')), 0)::bigint as fee_cents,
    case when count(*) filter(where v.status in ('paid','partially_refunded') and v.net_to_org is null)>0 then null else coalesce(sum(v.net_to_org) filter(where v.status in ('paid','partially_refunded')),0)::bigint end as net_cents,
    -- What actually went back to runners, across both refund kinds, from the one
    -- column that records it. Reading `amount` on the 'refunded' arm over-stated
    -- every full refund by platform_fee + processor_fee_cents.
    coalesce(sum(v.refunded_amount)
               filter (where v.status in ('refunded','partially_refunded')), 0)::bigint               as refunded_cents
  from public.admin_payments_v v
  where v.org_id = p_org_id
    and (p_status = 'all' or v.status::text = p_status)
    and (p_method = 'all' or v.method = p_method)
    and (p_event_id = 'all' or v.event_id::text = p_event_id)
    and (
      p_q = '' or
      v.discount_code ilike p_q or v.full_name ilike p_q or
      v.event_name ilike p_q
    )
$function$;

create function public.discount_passport_options(p_org uuid,p_search text default '') returns table(id uuid,label text)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.auth_manage_discounts(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
 return query select p.id,coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),'Runner')
 from public.runner_passports p where
 (exists(select 1 from public.registrations r where r.org_id=p_org and r.participant_passport_id=p.id)
 or exists(select 1 from public.prescreening_applications a where a.org_id=p_org and a.participant_passport_id=p.id))
 and (position(lower(left(btrim(coalesce(p_search,'')),100)) in lower(concat_ws(' ',p.first_name,p.last_name,p.id::text)))>0)
 order by p.first_name,p.last_name,p.id limit 50;
end $$;
revoke all on function public.discount_passport_options(uuid,text) from public,anon;
grant execute on function public.discount_passport_options(uuid,text) to authenticated,service_role;
