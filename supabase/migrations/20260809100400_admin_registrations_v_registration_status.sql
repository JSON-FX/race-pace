-- Expose the registration's own lifecycle status to the admin console.
--
-- admin_registrations_v (20260804120000_admin_list_views.sql) only ever selected
-- `payments.status as payment_status`. That's fine for pending/paid/refunded, where
-- registrations.status and payments.status move together, but it goes silently wrong
-- for the two states that only ever live on registrations.status:
--   - expire_stale_registrations() / expire_pending_on_event_close()
--     (20260809100200_expire_stale_registrations.sql) set registrations.status =
--     'expired' and, only if a payment existed, payments.status = 'failed' — never
--     'expired'.
--   - admin_cancel_registration() (20260806201000_admin_cancel_registration_rpc.sql)
--     sets registrations.status = 'cancelled' and never touches payments.status at all.
-- So today an organizer reading the Registrations table cannot tell "this runner's
-- hold ran out" apart from "this runner's card was declined" apart from "this runner
-- (or an admin) cancelled the entry" — all three can render as payment_status 'failed'
-- or null. Adding `expired`/`cancelled` to a *payment_status* filter/badge, as an
-- earlier pass at this task tried, doesn't fix that: `payment_status` is the
-- `payment_status` enum (pending/paid/failed/refunded/partially_refunded), which has
-- no 'expired' or 'cancelled' value and never will — `where payment_status = 'expired'`
-- is a hard `invalid input value for enum payment_status` error, not an empty result.
--
-- Purely additive: one more selected column, no existing column changed, no RLS
-- change (security_invoker already carries the caller's own RLS on `registrations`
-- through unchanged).
--
-- registration_status is appended AFTER every pre-existing column, not inserted
-- where it reads most naturally (next to payment_status) — `create or replace
-- view` refuses to reorder or insert among existing output columns ("cannot
-- change name of view column ... to ...", SQLSTATE 42P16), it can only append
-- new ones at the end.
create or replace view admin_registrations_v
with (security_invoker = true) as
  select
    r.id,
    r.org_id,
    r.event_id,
    r.user_id,
    pr.full_name,
    pr.bib_name,
    r.category_id,
    c.label             as category_label,
    r.total_amount,
    p.status            as payment_status,
    p.method            as payment_method,
    r.custom_data,
    r.created_at,
    r.status            as registration_status
  from registrations r
  left join profiles pr on pr.id = r.user_id
  left join categories c on c.id = r.category_id
  left join payments p   on p.registration_id = r.id;

grant select on admin_registrations_v to authenticated;

-- admin_registration_aggregates (20260806190000_admin_kpi_aggregates.sql) filters its
-- `total`/`paid`/`gross_cents`/etc. rows by the SAME p_status the table's own
-- listEventRegistrations() query uses, so the KPI row above the table can never
-- disagree with what's actually listed below it. That WHERE clause matched
-- `v.payment_status::text = p_status` only — harmless while every filter option lived
-- on payment_status, but once the Registrations page offers "Expired"/"Cancelled"
-- (routed to the new registration_status column above, not payment_status), leaving
-- this unchanged would make the KPI row silently show 0 total for a filter the table
-- itself returns real rows for: the exact "looks like it filtered, actually didn't"
-- failure this task exists to avoid, just one query over.
--
-- 'expired'/'cancelled' are routed to registration_status; every other value
-- (including the 'all' sentinel) keeps matching payment_status exactly as before —
-- both enums independently contain 'pending'/'paid'/'refunded', so an unconditional
-- OR across both columns would double-count rows whose two statuses happen to differ
-- transiently, not just extend coverage.
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
    count(*) filter (where v.payment_status = 'paid')::int                     as paid,
    coalesce(sum(v.total_amount) filter (where v.payment_status = 'paid'), 0)::bigint    as gross_cents,
    count(*) filter (where v.payment_status = 'refunded')::int                 as refund_count,
    coalesce(sum(v.total_amount) filter (where v.payment_status = 'refunded'), 0)::bigint as refunded_cents,
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
$$;

grant execute on function public.admin_registration_aggregates(uuid, text, text, text) to authenticated;
