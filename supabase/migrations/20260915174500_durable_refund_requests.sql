-- Local-only migration under development; never applied to hosted Supabase.
-- Persist ownership BEFORE provider I/O. UUID idempotency survives timeouts and
-- callbacks arriving before the initiating Edge Function can bind a provider ID.
create table public.refund_requests (
 id uuid primary key default gen_random_uuid(),
 registration_id uuid not null references public.registrations(id) on delete cascade,
 org_id uuid not null references public.organizations(id) on delete cascade,
 provider text not null, provider_ref text, provider_refund_id text unique,
 provider_scope text, refund_amount integer not null check(refund_amount >= 0),
 retained_net integer not null check(retained_net >= 0), total_paid integer not null,
 refunded_by uuid, note text,
 review_required boolean not null default false,
 status text not null check(status in ('submitting','unknown','pending','succeeded','failed')),
 created_at timestamptz not null default now(), lease_until timestamptz not null default now()+interval '90 seconds'
);
create unique index refund_requests_one_active on public.refund_requests(registration_id)
 where status in ('submitting','unknown','pending');
create table public.refund_provider_events (
 provider_refund_id text primary key, org_id uuid references public.organizations(id) on delete cascade,
 resource jsonb not null, provider_timestamp numeric not null default 0,
 status text not null, received_at timestamptz not null default now()
);
alter table public.refund_requests enable row level security;
alter table public.refund_provider_events enable row level security;
revoke all on public.refund_requests, public.refund_provider_events from public, anon, authenticated;
grant all on public.refund_requests, public.refund_provider_events to service_role;

create function public.refund_request_claim(p_registration_id uuid,p_refunded_by uuid,p_note text,
 p_expected_amount integer default null,p_preview boolean default false,p_provider_scope text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.registrations; p public.payments; q public.refund_requests; o public.organizations;
 a integer; retained integer; result_action text; legacy jsonb;
begin
 select * into r from public.registrations where id=p_registration_id for update;
 if not found then return jsonb_build_object('action','error','error','not_found'); end if;
 select * into p from public.payments where registration_id=r.id for update;
 if not found then return jsonb_build_object('action','error','error','payment_not_found'); end if;
 if coalesce(p.provider,'fake')='fake' then p_provider_scope:='fake'; end if;
 if exists(select 1 from public.refund_requests where registration_id=r.id and review_required) then return jsonb_build_object('action','error','error','refund_review_required'); end if;
 if r.status::text='refunded' or p.status::text in ('refunded','partially_refunded') then return jsonb_build_object('action','already'); end if;
 if r.status::text <> 'paid' then return jsonb_build_object('action','error','error','not_refundable'); end if;
 select * into q from public.refund_requests where registration_id=r.id and status <> 'failed' order by created_at desc limit 1 for update;
 if q.id is not null and q.status='succeeded' then return jsonb_build_object('action','already'); end if;
 legacy := p.raw->'refund';
 if q.id is null and legacy->>'status'='pending' then
   if p_preview then return jsonb_build_object('action','pending'); end if;
   if nullif(legacy->>'id','') is null or (legacy->>'refunded_amount' is null and coalesce((legacy->>'retained_net')::integer,0)<>0) then
     return jsonb_build_object('action','error','error','refund_review_required');
   end if;
   insert into public.refund_requests(registration_id,org_id,provider,provider_ref,provider_refund_id,provider_scope,refund_amount,retained_net,total_paid,refunded_by,note,status)
   values(r.id,r.org_id,coalesce(p.provider,'fake'),p.provider_ref,legacy->>'id',p_provider_scope,
    coalesce((legacy->>'refunded_amount')::integer,p.net_to_org),coalesce((legacy->>'retained_net')::integer,0),p.amount,
    nullif(legacy->>'refunded_by','')::uuid,legacy->>'note','pending') returning * into q;
 end if;
 if q.id is not null then
   if p_preview then result_action:='pending';
   elsif q.provider='paymongo' and (nullif(p_provider_scope,'') is null or p_provider_scope='unconfigured') then return jsonb_build_object('action','error','error','provider_not_configured');
   elsif q.provider_refund_id is not null then result_action:='reconcile';
   elsif q.provider_scope is distinct from p_provider_scope or q.created_at <= now()-interval '23 hours' then
     return jsonb_build_object('action','error','error','refund_review_required');
   elsif q.lease_until > now() then result_action:='pending';
   else update public.refund_requests set status='submitting',lease_until=now()+interval '90 seconds' where id=q.id returning * into q;
     result_action:='submit';
   end if;
 else
   select * into o from public.organizations where id=p.org_id;
   if o.refund_policy::text='none' then return jsonb_build_object('action','error','error','policy_forbids'); end if;
   retained:=case when o.refund_policy::text='flat_fee' then least(o.refund_fee_cents,p.net_to_org) else 0 end;
   a:=p.net_to_org-retained;
   if p_preview then return jsonb_build_object('action','preview','refund_amount',a,'total_paid',p.amount,'retained_fees',p.amount-a); end if;
   if p_expected_amount is not null and p_expected_amount<>a then return jsonb_build_object('action','error','error','refund_amount_changed'); end if;
   if p.provider='paymongo' and (nullif(p_provider_scope,'') is null or p_provider_scope='unconfigured') then return jsonb_build_object('action','error','error','provider_not_configured'); end if;
   insert into public.refund_requests(registration_id,org_id,provider,provider_ref,provider_scope,refund_amount,retained_net,total_paid,refunded_by,note,status)
   values(r.id,r.org_id,coalesce(p.provider,'fake'),p.provider_ref,p_provider_scope,a,retained,p.amount,p_refunded_by,p_note,'submitting') returning * into q;
   result_action:='submit';
 end if;
 if not p_preview then
 update public.payments set raw=coalesce(raw,'{}') || jsonb_build_object('refund',jsonb_build_object(
 'id',q.provider_refund_id,'status',q.status,'request_id',q.id,'requested_at',q.created_at,
 'refunded_amount',q.refund_amount,'retained_net',q.retained_net,'refunded_by',q.refunded_by,'note',q.note)) where registration_id=r.id;
 end if;
 return jsonb_build_object('action',result_action,'request',to_jsonb(q),'refund_amount',q.refund_amount,'total_paid',q.total_paid,'retained_fees',q.total_paid-q.refund_amount);
end $$;

create function public.refund_request_bind(p_request_id uuid,p_provider_refund_id text)
returns text language plpgsql security definer set search_path='' as $$
declare q public.refund_requests; rid uuid; payment_status text;
begin
 select registration_id into rid from public.refund_requests where id=p_request_id;
 if not found then return 'not_found'; end if;
 perform 1 from public.registrations where id=rid for update;
 select status::text into payment_status from public.payments where registration_id=rid for update;
 select * into q from public.refund_requests where id=p_request_id for update;
 if payment_status in ('refunded','partially_refunded') then return 'already'; end if;
 if nullif(p_provider_refund_id,'') is null then return 'conflict'; end if;
 if q.provider_refund_id is not null and q.provider_refund_id<>p_provider_refund_id then return 'conflict'; end if;
 if exists(select 1 from public.refund_requests where provider_refund_id=p_provider_refund_id and id<>q.id) then return 'conflict'; end if;
 update public.refund_requests set provider_refund_id=p_provider_refund_id,
 status=case when status in ('succeeded','failed') then status else 'pending' end where id=q.id returning * into q;
 -- A late response from a failed attempt cannot replace its successor's projection.
 if not exists(select 1 from public.refund_requests where registration_id=rid and id<>q.id and status in ('submitting','unknown','pending')) then
 update public.payments set raw=coalesce(raw,'{}') || jsonb_build_object('refund',jsonb_build_object(
 'id',q.provider_refund_id,'status',q.status,'request_id',q.id,'requested_at',q.created_at,
 'refunded_amount',q.refund_amount,'retained_net',q.retained_net,'refunded_by',q.refunded_by,'note',q.note)) where registration_id=rid;
 end if;
 return case when q.status='succeeded' then 'already' else 'bound' end;
end $$;

create function public.refund_request_uncertain(p_request_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare rid uuid; changed uuid;
begin
 select registration_id into rid from public.refund_requests where id=p_request_id;
 if rid is null then return 'not_found'; end if;
 perform 1 from public.registrations where id=rid for update;
 perform 1 from public.payments where registration_id=rid for update;
 update public.refund_requests set status='unknown' where id=p_request_id and provider_refund_id is null and status='submitting' returning id into changed;
 if changed is not null then
 update public.payments set raw=jsonb_set(coalesce(raw,'{}'),'{refund,status}','"unknown"'::jsonb) where registration_id=rid and status::text not in ('refunded','partially_refunded') and raw#>>'{refund,request_id}'=p_request_id::text;
 end if;
 return 'unknown';
end $$;

create function public.refund_event_store(p_resource jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare st text:=coalesce(p_resource#>>'{attributes,status}','unknown'); ts numeric;
begin
 if nullif(p_resource->>'id','') is null then raise exception 'refund resource ID required'; end if;
 ts:=coalesce((p_resource#>>'{attributes,updated_at}')::numeric,(p_resource#>>'{attributes,created_at}')::numeric,0);
 insert into public.refund_provider_events(provider_refund_id,resource,provider_timestamp,status)
 values(p_resource->>'id',p_resource,ts,st)
 on conflict(provider_refund_id) do update set resource=excluded.resource,provider_timestamp=excluded.provider_timestamp,status=excluded.status,received_at=now()
 where refund_provider_events.status<>'succeeded' and
 (excluded.status='succeeded' or (excluded.provider_timestamp>=refund_provider_events.provider_timestamp and
 (refund_provider_events.status<>'failed' or excluded.status='failed')));
 return 'stored';
end $$;

create function public.refund_request_apply_event(p_provider_refund_id text)
returns text language plpgsql security definer set search_path='' as $$
declare q public.refund_requests; e public.refund_provider_events; rid uuid; mid text; p public.payments; outcome text;
begin
 select * into e from public.refund_provider_events where provider_refund_id=p_provider_refund_id;
 if not found then return 'unmatched'; end if;
 select * into q from public.refund_requests where provider_refund_id=p_provider_refund_id;
 if q.id is null then
   mid:=e.resource#>>'{attributes,metadata,refund_request_id}';
   if mid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then select * into q from public.refund_requests where id=mid::uuid; end if;
 end if;
 if q.id is null then
   select registration_id into rid from public.payments where raw#>>'{refund,id}'=p_provider_refund_id and raw#>>'{refund,status}'='pending' limit 1;
   if rid is null then return 'unmatched'; end if;
   perform public.refund_request_claim(rid,null,null,null,false,null);
   select * into q from public.refund_requests where provider_refund_id=p_provider_refund_id;
   if q.id is null then return 'unmatched'; end if;
 end if;
 perform 1 from public.registrations where id=q.registration_id for update;
 select * into p from public.payments where registration_id=q.registration_id for update;
 select * into q from public.refund_requests where id=q.id for update;
 select * into e from public.refund_provider_events where provider_refund_id=p_provider_refund_id;
 if q.provider_refund_id is not null and q.provider_refund_id<>p_provider_refund_id then return 'invalid'; end if;
 if e.resource#>>'{attributes,metadata,refund_request_id}' is not null and e.resource#>>'{attributes,metadata,refund_request_id}'<>q.id::text then return 'invalid'; end if;
 if e.resource#>>'{attributes,metadata,registration_id}' is not null and e.resource#>>'{attributes,metadata,registration_id}'<>q.registration_id::text then return 'invalid'; end if;
 if jsonb_typeof(e.resource#>'{attributes,amount}')<>'number' or e.resource#>'{attributes,amount}' is null then return 'invalid'; end if;
 if (e.resource#>>'{attributes,amount}')::numeric<>q.refund_amount then return 'invalid'; end if;
 if q.review_required then return 'review_required'; end if;
 if q.status='succeeded' then return 'already'; end if;
 if p.status::text in ('refunded','partially_refunded') then
   -- A distinct provider success is a second debit, not a replay. Preserve
   -- the original accounting and retain the discrepancy for manual recovery.
   if e.status='succeeded' then
     update public.refund_requests set review_required=true, provider_refund_id=p_provider_refund_id where id=q.id;
     update public.refund_provider_events set org_id=q.org_id where provider_refund_id=p_provider_refund_id;
     return 'review_required';
   end if;
   return 'already';
 end if;
 if q.status='failed' and e.status<>'succeeded' then return 'already'; end if;
 outcome:=public.refund_request_bind(q.id,p_provider_refund_id);
 if outcome='conflict' then return 'invalid'; end if;
 update public.refund_provider_events set org_id=q.org_id where provider_refund_id=p_provider_refund_id;
 if e.status='succeeded' then
   outcome:=public.refund_registration_tx(q.registration_id,q.refunded_by,q.note,e.resource,q.refund_amount,q.retained_net);
   if outcome not in ('refunded','partially_refunded','already') then raise exception 'refund settlement rejected: %',outcome; end if;
   update public.refund_requests set status='succeeded' where id=q.id;
 elsif e.status='failed' then update public.refund_requests set status='failed' where id=q.id;
 else return 'pending'; end if;
 update public.payments set raw=coalesce(raw,'{}') || jsonb_build_object('refund',jsonb_build_object(
 'id',p_provider_refund_id,'status',e.status,'request_id',q.id,'requested_at',q.created_at,
 'refunded_amount',q.refund_amount,'retained_net',q.retained_net,'refunded_by',q.refunded_by,'note',q.note)) where registration_id=q.registration_id;
 return 'applied';
end $$;

revoke all on function public.refund_request_claim(uuid,uuid,text,integer,boolean,text),public.refund_request_bind(uuid,text),public.refund_request_uncertain(uuid),public.refund_event_store(jsonb),public.refund_request_apply_event(text) from public,anon,authenticated;
grant execute on function public.refund_request_claim(uuid,uuid,text,integer,boolean,text),public.refund_request_bind(uuid,text),public.refund_request_uncertain(uuid),public.refund_event_store(jsonb),public.refund_request_apply_event(text) to service_role;
