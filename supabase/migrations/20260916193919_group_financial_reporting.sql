-- One provider transaction in payment reports; one allocation per participant in
-- settlements. Never materialize duplicate legacy payments for a shared charge.
alter table public.booking_payment_allocations
 add column payout_statement_id uuid references public.payout_statements(id),
 add column payout_clawback_id uuid references public.payout_statements(id);

create function public.admin_group_financial_lines()
returns table(registration_id uuid,org_id uuid,event_id uuid,event_name text,user_id uuid,full_name text,
 category_label text,created_at timestamptz,paid_at timestamptz,booking_order_id uuid,payment_id uuid,
 participant_count integer,amount integer,platform_fee integer,processor_fee_cents integer,processor_fee_source text,
 net_to_org integer,refunded_amount integer,method text,status public.payment_status,
 payout_statement_id uuid,payout_clawback_id uuid)
language sql stable security definer set search_path='' as $$
 select r.id,a.org_id,r.event_id,e.name,r.user_id,
   coalesce(nullif(btrim(r.custom_data->>'full_name'),''),pr.full_name),cat.label,r.created_at,c.created_at,
   c.booking_order_id,c.id,1,a.gross_cents,a.platform_fee_cents,a.processor_fee_cents,
   case when a.processor_fee_cents is null then 'unreconciled' else 'actual' end,
   a.net_to_org_cents-coalesce(ref.amount,0),coalesce(ref.amount,0),attempt.method,
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
create view public.admin_group_allocations_v with(security_invoker=true) as select * from public.admin_group_financial_lines();
revoke all on public.admin_group_allocations_v from public,anon,authenticated;
grant select on public.admin_group_allocations_v to authenticated,service_role;

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
    p.paid_at, p.id as payment_id, null::uuid as booking_order_id, 1::integer as participant_count
   FROM payments p
     JOIN registrations r ON r.id = p.registration_id
     LEFT JOIN events e ON e.id = r.event_id
     LEFT JOIN profiles pr ON pr.id = r.user_id
 union all
 select null::uuid,g.org_id,g.event_id,min(g.event_name),null::uuid,string_agg(g.full_name,', ' order by g.registration_id),
   sum(g.amount)::integer,sum(g.platform_fee)::integer,
   case when count(*) filter(where g.net_to_org is null)>0 then null else sum(g.net_to_org)::integer end,
   min(g.method),case when bool_or(g.status='partially_refunded') then 'partially_refunded' else 'paid' end::public.payment_status,
   min(g.paid_at),sum(g.refunded_amount)::integer,null::text,
   case when count(*) filter(where g.processor_fee_cents is null)>0 then null else sum(g.processor_fee_cents)::integer end,
   case when count(*) filter(where g.processor_fee_cents is null)>0 then 'unreconciled' else 'actual' end,
   min(g.paid_at),g.payment_id,g.booking_order_id,count(*)::integer
 from public.admin_group_allocations_v g group by g.org_id,g.event_id,g.payment_id,g.booking_order_id;

-- Participant reports use allocated gross, never the order's full charge.
create view public.admin_participant_money_v with(security_invoker=true) as
 select p.registration_id,p.amount,p.platform_fee,p.net_to_org,p.refunded_amount,p.method,p.status,p.id as payment_id
 from public.payments p
 union all select registration_id,amount,platform_fee,net_to_org,refunded_amount,method,status,payment_id from public.admin_group_allocations_v;
revoke all on public.admin_participant_money_v from public,anon,authenticated;
grant select on public.admin_participant_money_v to authenticated,service_role;
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
    p.amount AS payment_amount, r.booking_order_id, p.payment_id
   FROM registrations r
     LEFT JOIN profiles pr ON pr.id = r.user_id
     LEFT JOIN categories c ON c.id = r.category_id
     LEFT JOIN public.admin_participant_money_v p ON p.registration_id = r.id;
create or replace view public.admin_org_totals_v with(security_invoker=true) as
SELECT r.org_id,
    count(*)::integer AS reg_count,
    count(*) FILTER (WHERE p.status = ANY (ARRAY['paid'::payment_status, 'partially_refunded'::payment_status]))::integer AS paid_count,
    count(*) FILTER (WHERE p.status IS DISTINCT FROM 'paid'::payment_status AND p.status IS DISTINCT FROM 'partially_refunded'::payment_status)::integer AS pending_count,
    COALESCE(sum(p.amount - p.refunded_amount) FILTER (WHERE p.status = ANY (ARRAY['paid'::payment_status, 'partially_refunded'::payment_status])), 0::bigint) AS gross_revenue,
    case when count(*) filter(where p.status in ('paid','partially_refunded') and p.net_to_org is null)>0 then null else COALESCE(sum(p.net_to_org) FILTER (WHERE p.status = ANY (ARRAY['paid'::payment_status, 'partially_refunded'::payment_status])), 0::bigint) end AS net_to_org,
    COALESCE(sum(p.platform_fee) FILTER (WHERE p.status = ANY (ARRAY['paid'::payment_status, 'partially_refunded'::payment_status])), 0::bigint) AS platform_fee,
    COALESCE(sum(p.amount) FILTER (WHERE p.status = ANY (ARRAY['paid'::payment_status, 'partially_refunded'::payment_status])), 0::bigint) AS charged_gross
   FROM registrations r
     LEFT JOIN public.admin_participant_money_v p ON p.registration_id = r.id
  GROUP BY r.org_id;
create or replace view public.admin_event_totals_v with(security_invoker=true) as
SELECT r.org_id,
    r.event_id,
    count(*)::integer AS reg_count,
    COALESCE(sum(p.amount - p.refunded_amount) FILTER (WHERE p.status = ANY (ARRAY['paid'::payment_status, 'partially_refunded'::payment_status])), 0::bigint) AS gross_revenue
   FROM registrations r
     LEFT JOIN public.admin_participant_money_v p ON p.registration_id = r.id
  GROUP BY r.org_id, r.event_id;
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
      v.full_name ilike p_q or
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
      v.full_name ilike p_q or
      v.event_name ilike p_q
    )
$function$;

-- Shared transaction lock is acquired BEFORE each original mutation's row locks.
-- This serializes provider callbacks/refunds with snapshot-and-stamp operations.
alter function public.booking_payment_confirm(uuid,jsonb,jsonb) rename to booking_payment_confirm_before_reporting;
create function public.booking_payment_confirm(p_attempt uuid,p_capture jsonb,p_tokens jsonb) returns text
language plpgsql security definer set search_path='' as $$ begin
 perform pg_advisory_xact_lock(76120260917);
 return public.booking_payment_confirm_before_reporting(p_attempt,p_capture,p_tokens);
end $$;
alter function public.booking_refund_claim(uuid,uuid,uuid[],uuid,integer,boolean,text,boolean) rename to booking_refund_claim_before_reporting;
create function public.booking_refund_claim(p_actor uuid,p_order uuid,p_registration_ids uuid[],p_key uuid,p_expected_amount integer,p_preview boolean,p_provider_scope text,p_livemode boolean) returns jsonb
language plpgsql security definer set search_path='' as $$ begin
 perform pg_advisory_xact_lock(76120260917);
 return public.booking_refund_claim_before_reporting(p_actor,p_order,p_registration_ids,p_key,p_expected_amount,p_preview,p_provider_scope,p_livemode);
end $$;
alter function public.booking_refund_apply(uuid,jsonb) rename to booking_refund_apply_before_reporting;
create function public.booking_refund_apply(p_request uuid,p_resource jsonb) returns text
language plpgsql security definer set search_path='' as $$ begin
 perform pg_advisory_xact_lock(76120260917);
 return public.booking_refund_apply_before_reporting(p_request,p_resource);
end $$;
alter function public.booking_refund_unknown(uuid) rename to booking_refund_unknown_before_reporting;
create function public.booking_refund_unknown(p_request uuid) returns void
language plpgsql security definer set search_path='' as $$ begin
 perform pg_advisory_xact_lock(76120260917);
 perform public.booking_refund_unknown_before_reporting(p_request);
end $$;

create function public.group_payout_blockers(p_event uuid) returns integer
language sql stable security definer set search_path='' as $$
 select (
 (select count(*) from public.booking_payment_captures c join public.booking_orders o on o.id=c.booking_order_id
   where o.event_id=p_event and (c.state<>'fulfilled' or exists(select 1 from public.booking_payment_allocations a
     where a.capture_id=c.id and (a.net_to_org_cents is null or a.net_to_org_cents<0 or a.processor_fee_cents is null))))
 +(select count(*) from public.booking_refund_requests q join public.booking_orders o on o.id=q.booking_order_id
   where o.event_id=p_event and q.status not in ('succeeded','failed'))
 )::integer;
$$;

alter function public.payout_payment_snapshot(uuid) rename to payout_payment_snapshot_before_groups;
create function public.payout_payment_snapshot(p_event_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('legacy',public.payout_payment_snapshot_before_groups(p_event_id),
 'captures',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.booking_payment_captures c
   join public.booking_orders o on o.id=c.booking_order_id where o.event_id=p_event_id),'[]'::jsonb),
 'allocations',coalesce((select jsonb_agg(to_jsonb(a) order by a.capture_id,a.registration_id) from public.booking_payment_allocations a
   join public.registrations r on r.id=a.registration_id where r.event_id=p_event_id),'[]'::jsonb),
 'refunds',coalesce((select jsonb_agg(jsonb_build_array(q.id,q.status,q.refund_amount,q.completed_at) order by q.id)
   from public.booking_refund_requests q join public.booking_orders o on o.id=q.booking_order_id where o.event_id=p_event_id),'[]'::jsonb));
$$;

create function public.group_payout_add_totals(p_statement uuid) returns void
language sql security definer set search_path='' as $$
 with totals as (
 select
 coalesce(sum(g.amount) filter(where g.payout_statement_id is null),0) gross,
 coalesce(sum(g.platform_fee) filter(where g.payout_statement_id is null),0) comm,
 coalesce(sum(g.processor_fee_cents) filter(where g.payout_statement_id is null),0) proc,
 coalesce(sum(g.net_to_org) filter(where g.payout_statement_id is null),0) earn,
 coalesce(sum(g.refunded_amount) filter(where g.payout_statement_id is null),0) period,
 coalesce(sum(g.refunded_amount) filter(where g.payout_statement_id is not null and g.payout_clawback_id is null),0) clawback
 from public.admin_group_financial_lines() g
 where g.event_id=(select event_id from public.payout_statements where id=p_statement)
 ) update public.payout_statements s set gross_cents=s.gross_cents+t.gross,
 commission_cents=s.commission_cents+t.comm,processing_cents=s.processing_cents+t.proc,
 refunds_in_period_cents=s.refunds_in_period_cents+t.period,refunds_cents=s.refunds_cents+t.clawback,
 net_owed_cents=s.net_owed_cents+t.earn-t.clawback from totals t where s.id=p_statement;
$$;

alter function public.payout_open_statement(uuid) rename to payout_open_statement_before_groups;
create function public.payout_open_statement(p_event_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$ declare result uuid; begin
 if not public.auth_is_super_admin() then raise exception 'forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(76120260917);
 if public.group_payout_blockers(p_event_id)>0 then raise exception 'group_reconciliation_required'; end if;
 result:=public.payout_open_statement_before_groups(p_event_id);
 perform public.group_payout_add_totals(result);
 return result;
end $$;
alter function public.payout_refresh_statement(uuid) rename to payout_refresh_statement_before_groups;
create function public.payout_refresh_statement(p_statement_id uuid) returns text
language plpgsql security definer set search_path='' as $$ declare result text; ev uuid; begin
 if not public.auth_is_super_admin() then raise exception 'forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(76120260917);
 select event_id into ev from public.payout_statements where id=p_statement_id;
 if public.group_payout_blockers(ev)>0 then return 'unreconciled'; end if;
 result:=public.payout_refresh_statement_before_groups(p_statement_id);
 if result='refreshed' then perform public.group_payout_add_totals(p_statement_id); end if;
 return result;
end $$;
alter function public.payout_mark_paid(uuid,text,text,integer) rename to payout_mark_paid_before_groups;
create function public.payout_mark_paid(p_statement_id uuid,p_reference text,p_note text,p_expected_revision integer) returns text
language plpgsql security definer set search_path='' as $$ declare result text; ev uuid; begin
 if not public.auth_is_super_admin() then raise exception 'forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(76120260917);
 if exists(select 1 from public.payout_statements where id=p_statement_id and status='paid') then return 'already'; end if;
 select event_id into ev from public.payout_statements where id=p_statement_id;
 if public.group_payout_blockers(ev)>0 then return 'unreconciled'; end if;
 result:=public.payout_mark_paid_before_groups(p_statement_id,p_reference,p_note,p_expected_revision);
 if result<>'paid' then return result; end if;
 -- Stamp refunds already netted into this first settlement at the same time.
 update public.booking_payment_allocations a set payout_statement_id=p_statement_id,
   payout_clawback_id=case when exists(select 1 from public.booking_refund_lines l join public.booking_refund_requests q
     on q.id=l.request_id and q.status='succeeded' where l.capture_id=a.capture_id and l.registration_id=a.registration_id)
     then p_statement_id else a.payout_clawback_id end
 from public.registrations r where r.id=a.registration_id and r.event_id=ev and a.payout_statement_id is null;
 update public.booking_payment_allocations a set payout_clawback_id=p_statement_id
 from public.registrations r where r.id=a.registration_id and r.event_id=ev and a.payout_statement_id is not null
   and a.payout_clawback_id is null and exists(select 1 from public.booking_refund_lines l join public.booking_refund_requests q
     on q.id=l.request_id and q.status='succeeded' where l.capture_id=a.capture_id and l.registration_id=a.registration_id);
 return result;
end $$;

alter function public.payout_unreconciled_count(uuid) rename to payout_unreconciled_count_before_groups;
create function public.payout_unreconciled_count(p_event_id uuid) returns integer
language plpgsql stable security definer set search_path='' as $$ declare legacy integer; begin
 -- Original function performs authorization before the private group lookup.
 legacy:=public.payout_unreconciled_count_before_groups(p_event_id);
 return legacy+public.group_payout_blockers(p_event_id);
end $$;

-- Renamed helper routines are implementation details, not alternate public paths.
revoke all on function public.booking_payment_confirm_before_reporting(uuid,jsonb,jsonb),public.booking_refund_claim_before_reporting(uuid,uuid,uuid[],uuid,integer,boolean,text,boolean),
 public.booking_refund_apply_before_reporting(uuid,jsonb),public.booking_refund_unknown_before_reporting(uuid),
 public.booking_payment_confirm(uuid,jsonb,jsonb),public.booking_refund_claim(uuid,uuid,uuid[],uuid,integer,boolean,text,boolean),
 public.booking_refund_apply(uuid,jsonb),public.booking_refund_unknown(uuid),public.group_payout_blockers(uuid),public.group_payout_add_totals(uuid),
 public.payout_payment_snapshot_before_groups(uuid),public.payout_payment_snapshot(uuid),
 public.payout_open_statement_before_groups(uuid),public.payout_refresh_statement_before_groups(uuid),
 public.payout_mark_paid_before_groups(uuid,text,text,integer),public.payout_unreconciled_count_before_groups(uuid)
 from public,anon,authenticated;
grant execute on function public.booking_payment_confirm(uuid,jsonb,jsonb),public.booking_refund_claim(uuid,uuid,uuid[],uuid,integer,boolean,text,boolean),
 public.booking_refund_apply(uuid,jsonb),public.booking_refund_unknown(uuid),public.payout_payment_snapshot(uuid)
 to service_role;
revoke all on function public.payout_open_statement(uuid),public.payout_refresh_statement(uuid),public.payout_mark_paid(uuid,text,text,integer),public.payout_unreconciled_count(uuid) from public,anon;
grant execute on function public.payout_open_statement(uuid),public.payout_refresh_statement(uuid),public.payout_mark_paid(uuid,text,text,integer),public.payout_unreconciled_count(uuid) to authenticated,service_role;
