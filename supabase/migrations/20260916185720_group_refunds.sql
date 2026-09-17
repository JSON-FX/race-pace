-- Group refunds retain the original capture and actual allocations. These private
-- ledgers reserve one shared payment before network I/O, including unknown results.
create table public.booking_refund_requests (
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references public.organizations(id),
 booking_order_id uuid not null references public.booking_orders(id),
 capture_id uuid not null references public.booking_payment_captures(id),
 actor_id uuid not null references auth.users(id),
 idempotency_key uuid not null,
 selection jsonb not null,
 policy_snapshot jsonb not null,
 refund_amount integer not null check(refund_amount >= 0),
 total_paid integer not null check(total_paid >= refund_amount),
 provider_scope text not null,
 livemode boolean not null,
 payment_id text not null,
 provider_refund_id text unique,
 status text not null default 'submitting' check(status in ('submitting','pending','unknown','succeeded','failed','review_required')),
 provider_resource jsonb,
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 unique(actor_id,idempotency_key)
);
create unique index booking_refund_one_active_capture on public.booking_refund_requests(capture_id)
 where status not in ('succeeded','failed');
create table public.booking_refund_lines (
 request_id uuid not null references public.booking_refund_requests(id),
 org_id uuid not null references public.organizations(id),
 capture_id uuid not null,
 registration_id uuid not null,
 refund_amount integer not null check(refund_amount >= 0),
 retained_net integer not null check(retained_net >= 0),
 primary key(request_id,registration_id),
 foreign key(capture_id,registration_id) references public.booking_payment_allocations(capture_id,registration_id)
);
alter table public.booking_refund_requests enable row level security;
alter table public.booking_refund_lines enable row level security;
revoke all on public.booking_refund_requests,public.booking_refund_lines from public,anon,authenticated;
grant all on public.booking_refund_requests,public.booking_refund_lines to service_role;

create function public.booking_refund_claim(
 p_actor uuid,p_order uuid,p_registration_ids uuid[],p_key uuid,p_expected_amount integer,
 p_preview boolean,p_provider_scope text,p_livemode boolean
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 o booking_orders; c booking_payment_captures; terms organizations; q booking_refund_requests;
 ids uuid[]; selection jsonb; amount integer; paid integer; lines jsonb; result jsonb;
begin
 -- Match capture's category-first lock order; refund releases cannot race admission.
 select * into o from booking_orders where id=p_order;
 if not found then raise exception 'order_not_found'; end if;
 if not exists(select 1 from user_roles where user_id=p_actor and
   (role='super_admin' or (org_id=o.org_id and role in ('admin','editor')))) then raise exception 'forbidden'; end if;
 perform 1 from categories where id=o.category_id for update;
 perform 1 from booking_orders where id=p_order for update;
 perform pg_advisory_xact_lock(hashtextextended('group-refund:'||p_actor::text||':'||p_key::text,0));
 if p_key is null or p_preview is null then raise exception 'invalid_input'; end if;
 if p_registration_ids is not null and (cardinality(p_registration_ids) not between 1 and 10
   or array_position(p_registration_ids,null) is not null) then raise exception 'invalid_selection'; end if;
 select array_agg(distinct x order by x) into ids from unnest(p_registration_ids) x;
 selection:=case when p_registration_ids is null then '{"all":true}'::jsonb else to_jsonb(ids) end;
 select * into q from booking_refund_requests where actor_id=p_actor and idempotency_key=p_key for update;
 if found then
   if q.booking_order_id<>p_order or q.selection<>selection then raise exception 'idempotency_conflict'; end if;
   if not p_preview and (p_expected_amount is distinct from q.refund_amount) then raise exception 'refund_amount_changed'; end if;
   if not p_preview and (p_provider_scope is distinct from q.provider_scope or p_livemode is distinct from q.livemode) then raise exception 'provider_scope_changed'; end if;
   return jsonb_build_object('action',case when p_preview then 'preview' when q.status in ('succeeded','failed','review_required') then q.status
     when q.provider_refund_id is not null then 'reconcile' else 'pending' end,'request',to_jsonb(q),
     'refund_amount',q.refund_amount,'total_paid',q.total_paid,'retained_fees',q.total_paid-q.refund_amount);
 end if;
 select * into c from booking_payment_captures where booking_order_id=p_order and state='fulfilled' for update;
 if not found then raise exception 'fulfilled_capture_required'; end if;
 if exists(select 1 from booking_refund_requests where capture_id=c.id and status not in ('succeeded','failed')) then raise exception 'refund_in_progress'; end if;
 if p_registration_ids is null then
   select array_agg(r.id order by r.id) into ids from registrations r join booking_payment_allocations a on a.registration_id=r.id
     where a.capture_id=c.id and r.status='paid';
 end if;
 if coalesce(cardinality(ids),0)=0 then raise exception 'no_refundable_tickets'; end if;
 perform 1 from registrations where id=any(ids) order by id for update;
 if (select count(*) from registrations r join booking_payment_allocations a on a.registration_id=r.id
   where r.id=any(ids) and r.booking_order_id=p_order and r.status='paid' and a.capture_id=c.id)<>cardinality(ids)
   then raise exception 'tickets_not_refundable'; end if;
 if exists(select 1 from booking_payment_allocations where capture_id=c.id and registration_id=any(ids)
   and (net_to_org_cents is null or net_to_org_cents<0 or processor_fee_cents is null)) then raise exception 'actual_fees_required'; end if;
 select * into terms from organizations where id=o.org_id for share;
 if terms.refund_policy='none' then raise exception 'policy_forbids'; end if;
 select sum(a.net_to_org_cents-case when terms.refund_policy='flat_fee' then least(terms.refund_fee_cents,a.net_to_org_cents) else 0 end)::integer,
   sum(a.gross_cents)::integer,jsonb_agg(jsonb_build_object('registration_id',a.registration_id,
     'refund_amount',a.net_to_org_cents-case when terms.refund_policy='flat_fee' then least(terms.refund_fee_cents,a.net_to_org_cents) else 0 end,
     'retained_net',case when terms.refund_policy='flat_fee' then least(terms.refund_fee_cents,a.net_to_org_cents) else 0 end) order by a.registration_id)
 into amount,paid,lines from booking_payment_allocations a where a.capture_id=c.id and a.registration_id=any(ids);
 if amount between 1 and 99 then raise exception 'refund_below_provider_minimum'; end if;
 if amount+coalesce((select sum(refund_amount) from booking_refund_requests where capture_id=c.id and status<>'failed'),0)
   >(c.capture->>'amount')::bigint then raise exception 'refund_budget_exceeded'; end if;
 result:=jsonb_build_object('refund_amount',amount,'total_paid',paid,'retained_fees',paid-amount,'lines',lines);
 if p_preview then return result||jsonb_build_object('action','preview'); end if;
 if p_expected_amount is distinct from amount then raise exception 'refund_amount_changed'; end if;
 if coalesce(p_provider_scope,'')='' or p_livemode is distinct from (c.capture->>'livemode')::boolean then raise exception 'provider_scope_changed'; end if;
 insert into booking_refund_requests(org_id,booking_order_id,capture_id,actor_id,idempotency_key,selection,policy_snapshot,refund_amount,total_paid,provider_scope,livemode,payment_id)
 values(o.org_id,o.id,c.id,p_actor,p_key,selection,jsonb_build_object('policy',terms.refund_policy,'fee_cents',terms.refund_fee_cents),amount,paid,p_provider_scope,p_livemode,c.payment_id) returning * into q;
 insert into booking_refund_lines(request_id,org_id,capture_id,registration_id,refund_amount,retained_net)
 select q.id,o.org_id,c.id,(x->>'registration_id')::uuid,(x->>'refund_amount')::integer,(x->>'retained_net')::integer from jsonb_array_elements(lines) x;
 if amount=0 then
   update registrations set status='refunded',ticket_token=null where id=any(ids);
   update categories set slots_taken=greatest(0,slots_taken-cardinality(ids)) where id=o.category_id;
   update booking_refund_requests set status='succeeded',completed_at=now() where id=q.id returning * into q;
 end if;
 return result||jsonb_build_object('action',case when amount=0 then 'succeeded' else 'submit' end,'request',to_jsonb(q));
end $$;

create function public.booking_refund_apply(p_request uuid,p_resource jsonb)
 returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare q booking_refund_requests; o booking_orders; a jsonb; rid text; state text; n integer;
begin
 select * into q from booking_refund_requests where id=p_request;
 if not found then raise exception 'refund_not_found'; end if;
 select * into o from booking_orders where id=q.booking_order_id;
 perform 1 from categories where id=o.category_id for update;
 perform 1 from booking_orders where id=o.id for update;
 select * into q from booking_refund_requests where id=p_request for update;
 a:=p_resource->'attributes'; rid:=p_resource->>'id'; state:=a->>'status';
 -- Compare JSON values rather than casting untrusted provider fields. Missing,
 -- malformed or contradictory evidence parks the request without touching tickets.
 if rid is null or rid !~ '^ref_[A-Za-z0-9_-]+$' or (q.provider_refund_id is not null and q.provider_refund_id<>rid)
   or (a->'amount') is distinct from to_jsonb(q.refund_amount)
   or (a->>'payment_id') is distinct from q.payment_id or (a->>'currency') is distinct from 'PHP'
   or (a->'livemode') is distinct from to_jsonb(q.livemode)
   or (a#>>'{metadata,refund_request_id}') is distinct from q.id::text
   or state is null or state not in ('pending','processing','succeeded','failed')
   or exists(select 1 from booking_refund_requests where provider_refund_id=rid and id<>q.id) then
   if q.status not in ('succeeded','failed') then
     update booking_refund_requests set status='review_required',provider_resource=p_resource where id=q.id;
   end if;
   return 'review_required';
 end if;
 if q.status='succeeded' then return 'succeeded'; end if;
 if q.status='failed' then
   -- A contradictory terminal callback needs review; never silently release
   -- capacity or permit another refund against this capture after it arrives.
   if state='succeeded' then
     if exists(select 1 from booking_refund_requests where capture_id=q.capture_id and id<>q.id and status not in ('succeeded','failed')) then
       raise exception 'refund_terminal_conflict';
     end if;
     update booking_refund_requests set status='review_required',provider_resource=p_resource where id=q.id;
     return 'review_required';
   end if;
   return 'failed';
 end if;
 if q.status='review_required' then return 'review_required'; end if;
 if state='succeeded' then
   perform 1 from registrations where id in(select registration_id from booking_refund_lines where request_id=q.id) order by id for update;
   select count(*) into n from booking_refund_lines where request_id=q.id;
   if n=0 or (select count(*) from registrations where status='paid' and id in(select registration_id from booking_refund_lines where request_id=q.id))<>n then
     update booking_refund_requests set status='review_required',provider_resource=p_resource where id=q.id;
     return 'review_required';
   end if;
   update registrations set status='refunded',ticket_token=null where id in(select registration_id from booking_refund_lines where request_id=q.id);
   update categories set slots_taken=greatest(0,slots_taken-n) where id=o.category_id;
 end if;
 update booking_refund_requests set provider_refund_id=rid,provider_resource=p_resource,
   status=case when state='processing' then 'pending' else state end,
   completed_at=case when state in ('succeeded','failed') then now() else null end where id=q.id;
 return case when state='processing' then 'pending' else state end;
end $$;

create function public.booking_refund_unknown(p_request uuid) returns void
 language sql security definer set search_path=public,pg_temp as $$
 update booking_refund_requests set status='unknown' where id=p_request and status='submitting' and provider_refund_id is null;
$$;
revoke all on function public.booking_refund_claim(uuid,uuid,uuid[],uuid,integer,boolean,text,boolean),
 public.booking_refund_apply(uuid,jsonb),public.booking_refund_unknown(uuid) from public,anon,authenticated;
grant execute on function public.booking_refund_claim(uuid,uuid,uuid[],uuid,integer,boolean,text,boolean),
 public.booking_refund_apply(uuid,jsonb),public.booking_refund_unknown(uuid) to service_role;
