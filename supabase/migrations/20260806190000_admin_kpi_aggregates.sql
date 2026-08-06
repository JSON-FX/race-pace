-- Filtered aggregates for the Registrations/Payments KPI row (admin visual parity V2).
--
-- Why RPCs, not PostgREST aggregate-select: `select=amount.sum()` is disabled on this
-- project (db-aggregates-enabled off, confirmed against local: PGRST123 "Use of
-- aggregate functions is not allowed"), and summing rows in JS is bounded by
-- PostgREST's db-max-rows (1000 locally, see supabase/config.toml) — silently wrong
-- once a filtered set exceeds that. These functions run the SUM/COUNT in Postgres
-- against the same admin_*_v views the list queries already read, so a KPI card can
-- never disagree with the table beneath it, at any scale.
--
-- security invoker + querying the security_invoker views: the caller's own RLS still
-- applies, same pattern as 20260804120000_admin_list_views.sql and
-- 20260806161500_admin_dashboard_views.sql.
--
-- Filter params mirror lib/queries/registrations.ts#listEventRegistrations and
-- lib/queries/payments.ts#listOrgPayments exactly (same 'all' sentinel, same columns)
-- so the two must be kept in sync by hand — there are only 2-3 predicates each side,
-- duplicating a shared TS query-builder into SQL was judged not worth the indirection.
--
-- p_q is NOT a raw search term — it is a fully-built `%...%` ILIKE pattern (or '' for
-- "no filter"), produced by lib/queries/events.ts#toIlikePattern and passed straight
-- through by lib/queries/registrations.ts / payments.ts's `searchPattern()` helpers.
-- Do NOT wrap it in '%'||p_q||'%' here — that was the original (buggy) version of this
-- migration. PostgREST auto-rewrites a literal '*' to '%' inside ilike/like values
-- (even quoted ones), but a raw SQL `ilike` in this function does not, so a '*' typed
-- into the search box produced two different result sets depending on which of these
-- two paths it reached — the RPC's row here vs. listEventRegistrations'/listOrgPayments'
-- own `.or()` call. toIlikePattern normalizes '*' to '%' (and escapes any literal
-- %/_/\) once, in TypeScript, before either path builds its query, so this RPC just
-- consumes the already-wildcarded, already-escaped pattern verbatim.

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
    and (p_status = 'all' or v.payment_status::text = p_status)
    and (p_category_id = 'all' or v.category_id::text = p_category_id)
    and (
      p_q = '' or
      v.full_name ilike p_q or
      v.bib_name ilike p_q
    )
$$;

-- Gross/fee/net are deliberately restricted to status = 'paid', NOT every row the
-- filtered-set WHERE clause would otherwise match. refund_registration_tx (see
-- supabase/migrations/20260723100000_money_txn_rpcs.sql) flips a payment's `status`
-- to 'refunded' but leaves its `amount`/`platform_fee`/`net_to_org` untouched — so
-- summing those columns across every status, as an earlier version of this function
-- did, counts money the org has already given back as still "net to org", and counts
-- abandoned/pending checkouts as "gross" revenue that was never collected. That
-- overstated both figures, and also disagreed with Registrations' own "Gross revenue"
-- card (which was already paid-only) for the same org — two different numbers, both
-- labelled "Gross", neither correct. An organizer reading "Net to org" needs the money
-- that will actually reach them; overstating it is the worse failure direction than
-- understating it, so paid-only is the deliberate choice here, not an oversight.
-- Do NOT "fix" this back to summing every status. The Refunded card is intentionally
-- exempt from this restriction — it exists specifically to report the refunded status.
-- The Payments TABLE (listOrgPayments in lib/queries/payments.ts) is UNCHANGED and
-- still lists every status; only these aggregates narrow.
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
    coalesce(sum(v.amount)       filter (where v.status = 'paid'), 0)::bigint     as gross_cents,
    coalesce(sum(v.platform_fee) filter (where v.status = 'paid'), 0)::bigint     as fee_cents,
    coalesce(sum(v.net_to_org)   filter (where v.status = 'paid'), 0)::bigint     as net_cents,
    coalesce(sum(v.amount)       filter (where v.status = 'refunded'), 0)::bigint as refunded_cents
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
