-- Count retained revenue from partial refunds. Design 2026-08-06 §9.6.
--
-- A 'partially_refunded' payment is a real, smaller sale: refund_registration_tx
-- rewrites its amount/platform_fee/net_to_org to the RETAINED figures and records
-- what went back in refunded_amount. So every place that means "money we actually
-- have" must count it, or the organizer's revenue silently drops by the full
-- original entry price the moment one runner cancels under a flat-fee policy.
--
-- This does NOT relax the deliberate paid-only restriction documented at length in
-- 20260806190000_admin_kpi_aggregates.sql. That restriction exists because a fully
-- 'refunded' row keeps its original amount/fee/net, so summing it would count money
-- already given back. 'partially_refunded' is the opposite case — its columns were
-- rewritten to describe only what was kept — so including it is consistent with that
-- reasoning, not an exception to it. Do NOT extend either filter to 'refunded'.

create or replace view admin_org_totals_v
with (security_invoker = true) as
  select
    r.org_id,
    count(*)::int                                                               as reg_count,
    count(*) filter (where p.status in ('paid','partially_refunded'))::int      as paid_count,
    count(*) filter (where p.status is distinct from 'paid'
                      and p.status is distinct from 'partially_refunded')::int  as pending_count,
    coalesce(sum(p.amount)       filter (where p.status in ('paid','partially_refunded')), 0)::bigint as gross_revenue,
    coalesce(sum(p.net_to_org)   filter (where p.status in ('paid','partially_refunded')), 0)::bigint as net_to_org,
    coalesce(sum(p.platform_fee) filter (where p.status in ('paid','partially_refunded')), 0)::bigint as platform_fee
  from registrations r
  left join payments p on p.registration_id = r.id
  group by r.org_id;

create or replace view admin_event_totals_v
with (security_invoker = true) as
  select
    r.org_id,
    r.event_id,
    count(*)::int                                                                                    as reg_count,
    coalesce(sum(p.amount) filter (where p.status in ('paid','partially_refunded')), 0)::bigint      as gross_revenue
  from registrations r
  left join payments p on p.registration_id = r.id
  group by r.org_id, r.event_id;

grant select on admin_org_totals_v   to authenticated;
grant select on admin_event_totals_v to authenticated;
-- service_role was never granted on these views, so any read with the service
-- key failed with "permission denied for view". Harmless for RLS — they are
-- security_invoker, and service_role bypasses RLS regardless — but required for
-- the test suite and admin tooling to read them at all.
grant select on admin_org_totals_v   to service_role;
grant select on admin_event_totals_v to service_role;

-- admin_payments_v gains refunded_amount. Once `amount` is rewritten to the
-- retained figure on a partial refund, this is the only column that still knows
-- what was actually returned to the runner — both the Refunded KPI below and the
-- admin Payments table need it.
--
-- Appended LAST, not slotted next to the other money columns where it belongs
-- logically: CREATE OR REPLACE VIEW can only add columns at the end. Inserting it
-- after net_to_org fails with 'cannot change name of view column "method" to
-- "refunded_amount"' (42P16), because Postgres matches existing columns by
-- position. Dropping and recreating would avoid that but would cascade to every
-- dependent object, so the column order is the cheaper compromise.
create or replace view admin_payments_v
with (security_invoker = true) as
  select
    p.registration_id,
    p.org_id,
    r.event_id,
    e.name              as event_name,
    r.user_id,
    pr.full_name,
    p.amount,
    p.platform_fee,
    p.net_to_org,
    p.method,
    p.status,
    p.created_at,
    p.refunded_amount
  from payments p
  join registrations r on r.id = p.registration_id
  left join events e   on e.id = r.event_id
  left join profiles pr on pr.id = r.user_id;

grant select on admin_payments_v to authenticated;
grant select on admin_payments_v to service_role;

-- Re-emitted verbatim from 20260806190000_admin_kpi_aggregates.sql except for the
-- widened status filters. p_q is UNCHANGED and still arrives pre-wildcarded and
-- pre-escaped from lib/queries/events.ts#toIlikePattern — do NOT wrap it in
-- '%'||p_q||'%' here; see that migration's header for the bug that caused.
create or replace function public.admin_registration_aggregates(
  p_event_id uuid,
  p_status text default 'all',
  p_category_id text default 'all',
  p_q text default ''
)
returns table (
  total int,
  paid int,
  gross_cents bigint,
  refund_count int,
  refunded_cents bigint,
  new_this_week int
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*)::int                                                              as total,
    count(*) filter (where v.payment_status in ('paid','partially_refunded'))::int as paid,
    coalesce(sum(v.total_amount) filter (where v.payment_status in ('paid','partially_refunded')), 0)::bigint as gross_cents,
    -- Both refund kinds are refunds to a human reading this card.
    count(*) filter (where v.payment_status in ('refunded','partially_refunded'))::int as refund_count,
    coalesce(sum(v.total_amount) filter (where v.payment_status = 'refunded'), 0)::bigint as refunded_cents,
    count(*) filter (where v.created_at >= now() - interval '7 days')::int     as new_this_week
  from public.admin_registrations_v v
  where v.event_id = p_event_id
    and (p_status = 'all' or v.payment_status::text = p_status)
    and (p_category_id = 'all' or v.category_id::text = p_category_id)
    and (
      p_q = '' or
      v.full_name ilike p_q or
      v.bib_name ilike p_q
    )
$$;

create or replace function public.admin_payment_aggregates(
  p_org_id uuid,
  p_status text default 'all',
  p_method text default 'all',
  p_q text default ''
)
returns table (
  gross_cents bigint,
  fee_cents bigint,
  net_cents bigint,
  refunded_cents bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(sum(v.amount)       filter (where v.status in ('paid','partially_refunded')), 0)::bigint as gross_cents,
    coalesce(sum(v.platform_fee) filter (where v.status in ('paid','partially_refunded')), 0)::bigint as fee_cents,
    coalesce(sum(v.net_to_org)   filter (where v.status in ('paid','partially_refunded')), 0)::bigint as net_cents,
    -- What actually went back to runners, across both refund kinds. A partial
    -- refund's `amount` is now the retained figure, so refunded_amount is the only
    -- column that still knows what was returned.
    coalesce(sum(v.amount) filter (where v.status = 'refunded'), 0)::bigint
      + coalesce(sum(v.refunded_amount) filter (where v.status = 'partially_refunded'), 0)::bigint as refunded_cents
  from public.admin_payments_v v
  where v.org_id = p_org_id
    and (p_status = 'all' or v.status::text = p_status)
    and (p_method = 'all' or v.method = p_method)
    and (
      p_q = '' or
      v.full_name ilike p_q or
      v.event_name ilike p_q
    )
$$;

grant execute on function public.admin_registration_aggregates(uuid, text, text, text) to authenticated;
grant execute on function public.admin_payment_aggregates(uuid, text, text, text)      to authenticated;
