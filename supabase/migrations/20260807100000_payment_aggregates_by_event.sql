-- Scope the Payments KPI row to a chosen event.
--
-- The cards and the table beneath them must never disagree, which is the whole
-- reason these aggregates run in Postgres rather than being summed in JS (see
-- 20260806190000_admin_kpi_aggregates.sql). Adding an event filter to the table
-- without adding it here would reintroduce exactly that bug: "Gross ₱5,900" for
-- the org sitting above two rows totalling ₱2,100.
--
-- p_event_id is text, not uuid, so it can carry the same 'all' sentinel every
-- other filter param uses rather than needing a null-means-all special case.

-- Adding a parameter creates an OVERLOAD, not a replacement, and PostgREST would
-- keep binding the existing 4-key call to the old function — so the event filter
-- would silently do nothing to the cards. Drop it first.
drop function if exists public.admin_payment_aggregates(uuid, text, text, text);

create or replace function public.admin_payment_aggregates(
  p_org_id uuid,
  p_status text default 'all',
  p_method text default 'all',
  p_q text default '',
  p_event_id text default 'all'
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
    -- A partial refund's `amount` is the RETAINED figure, so refunded_amount is
    -- the only column that still knows what went back to the runner.
    coalesce(sum(v.amount) filter (where v.status = 'refunded'), 0)::bigint
      + coalesce(sum(v.refunded_amount) filter (where v.status = 'partially_refunded'), 0)::bigint as refunded_cents
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
$$;

grant execute on function public.admin_payment_aggregates(uuid, text, text, text, text) to authenticated;
grant execute on function public.admin_payment_aggregates(uuid, text, text, text, text) to service_role;
