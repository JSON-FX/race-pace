-- Money reports read the column that records the money, not a proxy for it.
-- Design 2026-08-11 §9.
--
-- THE PREMISE 20260807090200 WAS BUILT ON HAS BEEN RETIRED. Read that file's
-- header before this one: it says, in as many words, that a 'partially_refunded'
-- payment is "a real, smaller sale" because refund_registration_tx "rewrites its
-- amount/platform_fee/net_to_org to the RETAINED figures". That was true when it
-- was written, and it is why summing `p.amount` counted money we actually have.
--
-- 20260811094000_refund_net_to_org.sql deliberately stopped doing that. On a
-- partial refund `amount` and `platform_fee` now stay frozen at what the runner
-- was charged and what Race Pace earned at capture, and ONLY net_to_org moves
-- down to the organizer's retention. That change was required, not incidental:
-- rewriting `amount` permanently breaks
--   amount - processor_fee_cents = the provider's reported net_amount
-- which is the reconciliation the entire three-party ledger rests on
-- (20260811091000/20260811093000).
--
-- So every sum built on the old premise now over-reports, and nothing else in
-- the schema was going to notice:
--
--   gross_revenue      counted a ₱2,000 entry whose organizer retained ₱300 as
--                      ₱2,000 of revenue still held. Over by ₱1,610.
--   refunded_cents     computed a FULL refund's value as `amount` (or
--                      registrations.total_amount). A refund now returns
--                      net_to_org, so it over-stated every one of them by
--                      platform_fee + processor_fee_cents — ₱90 on that entry.
--
-- The corrected rule, applied throughout this file:
--
--   * What the organizer earned on a row is `net_to_org`. NEVER
--     `amount - platform_fee` — that silently ignores the processor.
--   * What went back to the runner is `refunded_amount`. NEVER `amount`.
--     Both branches of refund_registration_tx already populate it; nothing here
--     computes a refund, it just reads the column that records one.
--   * `gross_revenue` stays "what the runner paid, that we still hold", so a
--     plain `paid` row is `amount` exactly as before and a partially refunded one
--     is `amount - refunded_amount`.
--
-- WHY `amount - refunded_amount` AND NOT `net_to_org + platform_fee +
-- processor_fee_cents`. The two are equal by the four-way split
-- refund_registration_tx enforces, and the second reads like the more explicit
-- statement of intent — but they diverge on exactly the rows this ledger already
-- treats as special. On a `processor_fee_source = 'historical'` row the platform
-- absorbed the processing fee, so net_to_org is `amount - platform_fee` with no
-- processor deduction (20260811090000's column comment says so outright, and
-- payout_open_statement already filters those rows out of its processing line for
-- the same reason). Adding processor_fee_cents back to it there would report MORE
-- gross than was ever charged. Subtracting the refund from the charge cannot
-- drift that way, and it is also the literal reading of the rule above.
--
-- NO STATUS FILTER IS WIDENED OR NARROWED HERE. A fully 'refunded' row keeps its
-- original amount/platform_fee/net_to_org (deliberately — payout_open_statement
-- sizes a clawback off it), so it stays excluded from every gross/fee/net sum,
-- exactly as 20260806190000 and 20260807090200 argued at length. Do NOT extend
-- those filters to 'refunded'.

-- ---------------------------------------------------------------------------
-- admin_org_totals_v
-- ---------------------------------------------------------------------------
-- `create or replace`, not drop/create: it preserves the ACL (authenticated and
-- service_role SELECT, granted by 20260807090200) and every dependent object,
-- and it permits changing a column's EXPRESSION as long as names, types and
-- order are untouched. `charged_gross` is appended LAST for the same reason
-- 20260807090200 had to append `refunded_amount` to admin_payments_v — a replace
-- can only add columns at the end, never insert one among the existing ones
-- (42P16). The grants below are re-emitted anyway: cheap, and they document what
-- this view is supposed to be readable by.
--
-- charged_gross is NOT a duplicate of gross_revenue. It is the OLD definition
-- under an honest name — what runners were charged, before any refund — kept
-- because at least one caller genuinely needs it: apps/web/lib/queries/commission.ts
-- divides by paid_count to render "a ₱2,000 average entry" beside the fee terms
-- and to drive the refund worked example. Sourced from a retained figure, that
-- label would quietly start printing a price no runner ever paid.
create or replace view admin_org_totals_v
with (security_invoker = true) as
  select
    r.org_id,
    count(*)::int                                                               as reg_count,
    count(*) filter (where p.status in ('paid','partially_refunded'))::int      as paid_count,
    count(*) filter (where p.status is distinct from 'paid'
                      and p.status is distinct from 'partially_refunded')::int  as pending_count,
    -- refunded_amount is `integer not null default 0`, so a plain paid row
    -- contributes p.amount unchanged and this stays byte-identical to the old
    -- definition for every row that was never refunded.
    coalesce(sum(p.amount - p.refunded_amount)
                                 filter (where p.status in ('paid','partially_refunded')), 0)::bigint as gross_revenue,
    coalesce(sum(p.net_to_org)   filter (where p.status in ('paid','partially_refunded')), 0)::bigint as net_to_org,
    coalesce(sum(p.platform_fee) filter (where p.status in ('paid','partially_refunded')), 0)::bigint as platform_fee,
    coalesce(sum(p.amount)       filter (where p.status in ('paid','partially_refunded')), 0)::bigint as charged_gross
  from registrations r
  left join payments p on p.registration_id = r.id
  group by r.org_id;

create or replace view admin_event_totals_v
with (security_invoker = true) as
  select
    r.org_id,
    r.event_id,
    count(*)::int                                                                                    as reg_count,
    coalesce(sum(p.amount - p.refunded_amount)
               filter (where p.status in ('paid','partially_refunded')), 0)::bigint                  as gross_revenue
  from registrations r
  left join payments p on p.registration_id = r.id
  group by r.org_id, r.event_id;

grant select on admin_org_totals_v   to authenticated;
grant select on admin_event_totals_v to authenticated;
grant select on admin_org_totals_v   to service_role;
grant select on admin_event_totals_v to service_role;

-- ---------------------------------------------------------------------------
-- admin_registrations_v
-- ---------------------------------------------------------------------------
-- admin_registration_aggregates below has to answer "what went back to runners"
-- and the only column that records that lives on `payments`. The view already
-- joins payments, so this is one more selected column and nothing else — no new
-- join, no RLS change (security_invoker still carries the caller's own RLS on
-- `registrations` through unchanged), no existing column touched.
--
-- Appended after registration_status, which is itself appended after avatar_url,
-- for the reason 20260809150000's header sets out at length: `create or replace
-- view` matches columns by POSITION and can only add at the end. The column list
-- above it is repeated verbatim from that migration.
--
-- Only `authenticated` is granted, matching 20260804120000/20260809150000 —
-- service_role has deliberately never held SELECT here, and adding it is not
-- this task's call to make.
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
    pr.avatar_url,
    r.status            as registration_status,
    p.refunded_amount
  from registrations r
  left join profiles pr on pr.id = r.user_id
  left join categories c on c.id = r.category_id
  left join payments p   on p.registration_id = r.id;

grant select on admin_registrations_v to authenticated;

-- ---------------------------------------------------------------------------
-- admin_registration_aggregates
-- ---------------------------------------------------------------------------
-- Re-emitted from 20260809150000 with ONE change: refunded_cents reads
-- payments.refunded_amount instead of registrations.total_amount. Everything
-- else — the expired/cancelled status routing, the pre-wildcarded p_q (do NOT
-- wrap it in '%'||p_q||'%'; see 20260806190000's header for the bug that caused),
-- and the paid-only filters — is copied verbatim.
--
-- The `= 'refunded'` filters on refund_count/refunded_cents are also copied
-- verbatim and NOT widened to include 'partially_refunded'. Widening would change
-- what the card counts, not just what it values, and this task is about reading
-- the right column. Noted rather than silently left: this card therefore reports
-- a narrower Refunded figure than admin_payment_aggregates below, which counts
-- both refund kinds.
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
    -- registrations.total_amount is the CHARGE. A refund now returns net_to_org,
    -- and refunded_amount is what refund_registration_tx recorded returning.
    coalesce(sum(v.refunded_amount) filter (where v.payment_status = 'refunded'), 0)::bigint as refunded_cents,
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

-- ---------------------------------------------------------------------------
-- admin_payment_aggregates
-- ---------------------------------------------------------------------------
-- Re-emitted from 20260807100000 with the same signature, so this is a genuine
-- replacement and not the accidental OVERLOAD that migration's own header warns
-- about — PostgREST would otherwise keep binding callers to the old body. Two
-- changes: gross_cents nets the refund out, refunded_cents reads one column for
-- both refund kinds instead of `amount` for one and `refunded_amount` for the
-- other. fee_cents and net_cents are untouched; they already read the columns
-- that record the money.
--
-- The breakdown still reconciles: gross - fee - net = processor_fee_cents, on a
-- paid row by the ledger identity and on a partial one because the four-way split
-- (refunded_amount + net_to_org + platform_fee + processor_fee_cents = amount)
-- is enforced by refund_registration_tx.
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
    coalesce(sum(v.amount - v.refunded_amount)
                                 filter (where v.status in ('paid','partially_refunded')), 0)::bigint as gross_cents,
    coalesce(sum(v.platform_fee) filter (where v.status in ('paid','partially_refunded')), 0)::bigint as fee_cents,
    coalesce(sum(v.net_to_org)   filter (where v.status in ('paid','partially_refunded')), 0)::bigint as net_cents,
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
$$;

grant execute on function public.admin_payment_aggregates(uuid, text, text, text, text) to authenticated;
grant execute on function public.admin_payment_aggregates(uuid, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- payout_statements.refunds_in_period_cents
-- ---------------------------------------------------------------------------
-- The statement's breakdown must add up on paper, because the statement IS the
-- source document for a manual bank transfer.
--
-- Today a statement covering one partially-refunded entry reads
-- ₱2,000 - ₱60 - ₱30 beside a net owed of ₱300. The net is correct — nothing
-- multiplies the breakdown back into it (20260811095000 sums net_to_org and
-- stores gross/commission/processing purely to explain the total) — so no money
-- moves wrong. But an operator reading a document that contradicts itself by
-- ₱1,610 per entry is exactly the confusion this design exists to prevent, and
-- Task 13 is about to render that breakdown on the payout console.
--
-- The missing term is what went back to the runner:
--   gross - commission - processing - refunds_in_period = net_owed
--
-- SEPARATE FROM refunds_cents, NOT FOLDED INTO IT. refunds_cents means CLAWBACK:
-- money already transferred to the organizer on an earlier statement and since
-- refunded, recovered once via the payout_clawback_id stamp. This column means a
-- refund on money that has NOT been transferred yet, netted out of this
-- statement's own earnings before it is paid. A row lands in exactly one of them.
-- Conflating the two would double-count on the statement that recovers a
-- clawback, and would make the two-stamp mechanism unreadable.
alter table payout_statements
  add column if not exists refunds_in_period_cents bigint not null default 0;

comment on column payout_statements.refunds_in_period_cents is
  'Refunds netted out of THIS statement''s own unsettled earnings, from payments.refunded_amount. '
  'Distinct from refunds_cents, which is a clawback of money already transferred on an earlier statement.';

-- BODY PROVENANCE. Taken from the LIVE body, dumped with
--   select pg_get_functiondef(p.oid) from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'payout_open_statement';
-- (last written by 20260811095000_payout_open_statement_v2.sql), with two edits
-- and nothing else:
--   1. v_period declared, and one more sum APPENDED to the end of the select
--      list and the into list — so the five existing sums, and the two-stamp
--      filters they key on, are byte-for-byte what was dumped.
--   2. refunds_in_period_cents added to the insert's column and value lists.
-- The arithmetic is untouched: net_owed is still v_earn - v_refunds. The new
-- column is presentational, like gross/commission/processing, and is stored
-- beside the total rather than multiplied back into it.
--
-- Its filter is the SAME set of rows the gross/commission/processing lines
-- describe — unsettled paid/partial — and not a status of its own. A fully
-- 'refunded' unstamped row contributes nothing to gross, so subtracting its
-- refund here would break the identity rather than complete it; that row is the
-- clawback path's business (or nobody's, if it was never paid out). A plain
-- 'paid' row has refunded_amount = 0, so it contributes nothing.
create or replace function public.payout_open_statement(p_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_gross   bigint;
  v_comm    bigint;
  v_proc    bigint;
  v_earn    bigint;
  v_refunds bigint;
  v_period  bigint;
  v_id      uuid;
begin
  if not public.auth_is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select e.org_id into v_org from public.events e where e.id = p_event_id;
  if v_org is null then raise exception 'event_not_found'; end if;

  -- Amounts key on the STAMP, not on status alone:
  --   earn     = unsettled money we now owe   (paid/partial, no statement stamp)
  --   clawback = already-transferred money    (refunded, HAS a statement stamp,
  --              since refunded                no clawback stamp)
  -- A refund lands in exactly one of those, or neither. Never both. Keying on
  -- status alone was the original, wrong design — see 20260807090300's header.
  select
    coalesce(sum(p.amount)              filter (where p.status in ('paid','partially_refunded')
                                                  and p.payout_statement_id is null), 0),
    coalesce(sum(p.platform_fee)        filter (where p.status in ('paid','partially_refunded')
                                                  and p.payout_statement_id is null), 0),
    -- 'historical' rows are excluded, and so are 'none' rows: on both, net_to_org
    -- does NOT have a processor fee deducted from it — on 'historical' because the
    -- platform absorbed a real fee under pre-2026-08-11 terms, on 'none' because
    -- processor_fee_cents is 0. Counting either here would show the organizer a
    -- cost they never bore AND break the gross - commission - processing identity
    -- for exactly those rows. The filter is what keeps the breakdown honest; it
    -- deliberately does not appear on the two net_to_org sums below, which must
    -- include historical rows at their stored value.
    coalesce(sum(p.processor_fee_cents) filter (where p.status in ('paid','partially_refunded')
                                                  and p.payout_statement_id is null
                                                  and p.processor_fee_source in ('actual','predicted')), 0),
    coalesce(sum(p.net_to_org)          filter (where p.status in ('paid','partially_refunded')
                                                  and p.payout_statement_id is null), 0),
    coalesce(sum(p.net_to_org)          filter (where p.status = 'refunded'
                                                  and p.payout_statement_id is not null
                                                  and p.payout_clawback_id is null), 0),
    -- The fourth presentational line. Same rows as gross/commission/processing.
    coalesce(sum(p.refunded_amount)     filter (where p.status in ('paid','partially_refunded')
                                                  and p.payout_statement_id is null), 0)
  into v_gross, v_comm, v_proc, v_earn, v_refunds, v_period
  from public.payments p
  join public.registrations r on r.id = p.registration_id
  where r.event_id = p_event_id;

  -- net_owed is v_earn - v_refunds, NOT v_gross - v_comm - v_proc - v_period -
  -- v_refunds. The four presentational figures are stored beside it, never
  -- multiplied back into it.
  insert into public.payout_statements
    (org_id, event_id, gross_cents, commission_cents, processing_cents,
     refunds_in_period_cents, refunds_cents, net_owed_cents, opened_by)
  values
    (v_org, p_event_id, v_gross, v_comm, v_proc,
     v_period, v_refunds, v_earn - v_refunds, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- Re-emitted verbatim from 20260811095000. `create or replace function` keeps the
-- existing ACL, so these are assertions rather than repairs — but this repo has
-- already been bitten twice by assuming a grant was in the state it looked like:
-- `revoke ... from public` does NOT lock a function (anon kept EXECUTE through
-- Supabase's named-role default privileges, a proven payment bypass —
-- 20260808110000), and an event trigger once stripped `authenticated` from
-- client-called RPCs on every CREATE OR REPLACE (20260808130000). payout_open_statement
-- is on function-grants.test.ts's AUTHENTICATED_ALLOWLIST and gates internally on
-- auth_is_super_admin(); losing that grant would break the payout console silently.
revoke all on function public.payout_open_statement(uuid)    from public;
grant execute on function public.payout_open_statement(uuid) to authenticated;
revoke execute on function public.payout_open_statement(uuid) from anon;
