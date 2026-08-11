-- Backfill. Design 2026-08-11 §10.
--
-- _shared/paymongo.ts has been storing PayMongo's entire payload in payments.raw
-- all along, and that payload carries the fee. So the real processing cost of
-- every historical payment is already in this database, unread.
--
-- HISTORICAL net_to_org IS NOT TOUCHED. Those entries were settled under terms
-- where Race Pace absorbed processing, and some of that money has already been
-- transferred. Recomputing it would invent debts against organizers for money
-- they were correctly paid. This migration makes old rows EXPLAINABLE, never
-- REPRICED: the only columns it writes are processor_fee_cents and
-- processor_fee_source. amount, platform_fee, net_to_org and refunded_amount are
-- never in any SET list below.
--
-- That is why 'historical' is a distinct source rather than 'actual': the fee is
-- real, but it was NOT deducted from the organizer, so the ledger invariant
--   net_to_org = amount - processor_fee_cents - platform_fee
-- deliberately does not hold for these rows. A row claiming 'actual' would be a
-- lie the payout arithmetic acts on — 20260811095000's processing sum filters on
-- processor_fee_source in ('actual','predicted') precisely so a historical fee is
-- shown to nobody as a cost the organizer bore.
--
-- ORDERING. This file is stamped 092000, so it applies BEFORE 093000/094000/
-- 095000/095500/095700 and after 091000. Everything it touches predates it:
-- processor_fee_cents / processor_fee_source come from 20260811090000, the
-- 'partially_refunded' payment_status value from 20260807090000, and
-- payout_statement_id / payout_clawback_id from 20260807090300. It references no
-- function and no column introduced by any later migration in this series, so
-- the position is not merely tolerable — it is the correct one: the hazard gate
-- below has to run before the clawback that would act on the hazard exists.


-- ---------------------------------------------------------------------------
-- GATE: legacy partial refunds that the new clawback would OVER-recover from.
-- ---------------------------------------------------------------------------
-- The pre-2026-08-11 partial-refund branch (20260807090400, carried forward by
-- 20260808140000 / 20260808150000) wrote:
--     refunded_amount = p_refunded_amount   -- struck off the GROSS `amount`
--     amount          = amount - refunded   -- `amount` rewritten DOWN
--     platform_fee    = p_retained_fee      -- commission RE-STRUCK on the retention
--     net_to_org      = p_retained_net
--     raw.original_amount = the pre-refund `amount`
-- and _shared/refund.ts at that commit (25e49b0) computed the split as
--     retained     = min(refund_fee_cents, amount)
--     refundAmount = amount - retained          <- GROSS scale
--     retainedFee  = computeFee(retained, org)  <- a SECOND commission on the retention
--     retainedNet  = retained - retainedFee
--
-- 20260811095700's clawback sizes recovery from refunded_amount unconditionally,
-- because under the NEW rule refund_registration_tx enforces
--   refunded_amount = net_to_org_before - net_to_org_after
-- (the 'refund_split_mismatch' guard). A LEGACY row does not satisfy that
-- identity. On it,
--   refunded_amount        = orig - retained
--   true owed-back         = net_before - net_after
--                          = (orig - fee(orig)) - (retained - fee(retained))
--   over-recovery          = fee(orig) - fee(retained)
-- i.e. the platform's commission on the refunded portion — 10% of it for a
-- percent org. A legacy row that ALSO carries payout_statement_id would therefore
-- claw a gross-scale figure back against a net-scale payment. That is the UNSAFE
-- direction: the organizer is billed for money they never received.
--
-- Those rows are exactly selectable: raw->'original_amount' is written by the old
-- branch and by nothing else — 20260811094000 removed the key when it stopped
-- rewriting `amount`, and refund-policy.test.ts pins its absence.
--
-- WHY THIS MIGRATION DOES NOT REPAIR THEM. The corrective needs net_before, which
-- needs platform_fee_before — the commission frozen at capture. The legacy branch
-- OVERWROTE that column with the re-struck retention fee, and stashed only
-- `original_amount`, not the fee. It is therefore not derivable from
-- raw.original_amount plus the stored columns:
--   * payments.platform_fee holds fee(retained), not fee(orig);
--   * registration_audit carries {amount, note} on the refund row and
--     {method, amount = registrations.total_amount} on the 'paid' row — no fee,
--     and no row at all for refunds predating 20260808140000;
--   * organizations.commission_* are CURRENT terms and mutable, and reading them
--     would retroactively reprice an entry under terms that were not in force —
--     exactly what _shared/confirm.ts freezes platform_fee onto the row to avoid;
--   * inverting platform_fee/amount to recover a rate assumes commission_type
--     = 'percent' and un-rounds an integer product, and computeFee's `fixed`
--     branch clamps to the total, so even a flat-fee org's fee(orig) and
--     fee(retained) can differ.
-- Guessing it would write a money figure derived from an assumption. Refusing to
-- deploy is the only safe answer, so this RAISES rather than warns. It fires only
-- on rows that are genuinely at risk — a legacy row with no payout stamp was
-- never settled, so there is nothing to claw back and nothing to over-recover —
-- and 20260811095800 is what keeps that true once it IS settled, by stamping
-- payout_clawback_id in the same breath as the earn stamp (see the hint below).
-- Clearing it is per-row bookkeeping, not a code change; see
-- .superpowers/sdd/2026-08-11-commission-payouts-money-model/task-9-report.md
-- for the reconstruction recipe (the settling statement's own commission_cents
-- snapshot is an independent record of the pre-refund platform_fee).
do $$
declare
  v_hazard integer;
  v_legacy integer;
begin
  select count(*) filter (
           where p.payout_statement_id is not null
             and p.payout_clawback_id is null),
         count(*)
    into v_hazard, v_legacy
    from public.payments p
   where p.status = 'partially_refunded'
     and p.raw ? 'original_amount';

  if v_legacy > 0 then
    raise notice
      'backfill_processor_fees: % legacy partially_refunded row(s) carry raw.original_amount.', v_legacy;
  end if;

  if v_hazard > 0 then
    raise exception using
      errcode = 'raise_exception',
      message = format(
        '%s legacy partially_refunded payment(s) carry BOTH raw.original_amount and a payout_statement_id',
        v_hazard),
      detail =
        'Their refunded_amount is a GROSS-scale figure (struck off payments.amount by the '
        'pre-2026-08-11 refund branch), but 20260811095700 sizes the payout clawback from '
        'refunded_amount as a NET-scale figure. Deploying would over-recover the platform''s '
        'commission on the refunded portion from organizers who were never paid it.',
      hint =
        'List them with: select id, registration_id, amount, platform_fee, net_to_org, '
        'refunded_amount, raw->>''original_amount'' from payments where status = '
        '''partially_refunded'' and raw ? ''original_amount'' and payout_statement_id is not null '
        'and payout_clawback_id is null; then restate refunded_amount as '
        '(net_to_org at settlement - current net_to_org) using the settling statement''s '
        'commission_cents snapshot. See task-9-report.md. '
        'THIS GATE DEPENDS ON 20260811095800_clawback_only_after_settlement.sql AS WELL AS '
        'ON 20260811095700. It ignores UNSTAMPED legacy rows only because 095800 has '
        'payout_mark_paid set payout_clawback_id on any row that is already '
        '''partially_refunded'' when it is first earn-stamped, which permanently excludes it '
        'from the clawback. Under 095700 alone that row is earn-stamped with a NULL clawback '
        'stamp and the NEXT statement recovers its GROSS-scale refunded_amount — so reverting '
        '095800 turns every unstamped legacy row into this same over-recovery hazard, and this '
        'gate must then be widened to fire on all of them regardless of payout_statement_id.';
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- The backfill itself.
-- ---------------------------------------------------------------------------
-- FINDING the payload is half the job, and getting it wrong fails SILENTLY. No
-- caller ever stored a bare PayMongo body: _shared/confirm.ts is handed
-- {source, session_id, session} by payment-verify and {source, event} by
-- payments-webhook, and confirm_payment_tx writes that wrapper into payments.raw
-- verbatim. A backfill that only read raw->'data'->'attributes' would match zero
-- production rows and report success. The candidate list below is the one in
-- _shared/confirm.ts#reportedProcessorFee, in the same order, most specific
-- first, each required to actually carry a `payments` array to be chosen.
--
-- SELECTING the payment within it mirrors _shared/paymongo.ts#pmFeeFromAttributes:
-- take the element whose attributes.status = 'paid'. A session can carry an
-- abandoned attempt followed by a successful one, and element 0 would report the
-- fee on the attempt the runner did NOT complete — typically a typed zero, which
-- is indistinguishable from a genuinely free payment.
--
-- Unlike pmFeeFromAttributes this NEVER falls back to payments[0]: a session with
-- no captured payment yields nothing and the row stays 'none'. That is the same
-- refusal reportedProcessorFee makes before calling it, so the pair of them
-- agrees with what confirm.ts would have recorded had it been reading the fee at
-- the time.
--
-- (A) NEVER 'none' WITH A NON-ZERO FEE. payout_open_statement's processing sum
-- filters on processor_fee_source in ('actual','predicted'), so a non-zero fee
-- left tagged 'none' is silently dropped from the statement's processing line.
-- The single UPDATE below writes both columns together — a fee never lands
-- without a source, by construction rather than by discipline — and rows with no
-- recoverable fee are not updated at all, so they keep fee 0 with source 'none'.
--
-- IDEMPOTENCY. The candidate set is `processor_fee_source = 'none'` and every
-- updated row leaves it as 'historical', so an updated row can never be a
-- candidate again. Rows that are skipped are skipped by a predicate over
-- immutable stored data, so they are skipped identically every run. A second run
-- therefore matches nothing and returns 0.
create or replace function public.backfill_processor_fees_once()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with candidate as (
    select p.id, a.attrs
      from public.payments p
      -- left join, not cross join: a row with no usable payload must still reach
      -- the UPDATE's predicate and be rejected there, rather than vanishing from
      -- the CTE in a way that reads as "nothing to do".
      left join lateral (
        select c.attrs
          from (values
            (1, p.raw #> '{session,data,attributes}'),                 -- payment-verify wrapper
            (2, p.raw #> '{event,data,attributes,data,attributes}'),   -- payments-webhook wrapper
            (3, p.raw #> '{data,attributes}'),                         -- a bare PayMongo response body
            (4, p.raw #> '{attributes}'),                              -- a bare resource
            (5, p.raw)                                                 -- an attributes object already
          ) as c(ord, attrs)
         -- `#>` and `->` return NULL (never raise) on a missing path, on a JSON
         -- scalar and on a top-level array, so a junk payload simply matches no
         -- candidate.
         where jsonb_typeof(c.attrs -> 'payments') = 'array'
         order by c.ord
         limit 1
      ) a on true
     where p.processor_fee_source = 'none'
  ),
  recovered as (
    select c.id,
           (
             select e #>> '{attributes,fee}'
               from jsonb_array_elements(c.attrs -> 'payments') e
              where e #>> '{attributes,status}' = 'paid'
              limit 1
           ) as fee_text
      from candidate c
  )
  update public.payments p
     -- The ONLY two columns this migration writes. net_to_org, amount,
     -- platform_fee and refunded_amount are deliberately absent.
     set processor_fee_cents  = r.fee_text::integer,
         processor_fee_source = 'historical'
    from recovered r
   where p.id = r.id
     -- Only write a genuinely numeric fee. A JSON null, a missing key, a decimal
     -- or a string all fail this and leave the row at 0/'none' — an unknown fee
     -- recorded as unknown, rather than a fabricated one recorded as fact.
     and r.fee_text ~ '^[0-9]+$';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- `revoke ... from public` does NOT lock a function here: anon and authenticated
-- keep EXECUTE through Supabase's named-role default privileges, which was a
-- proven payment bypass in this repo (20260808110000's header, and the fix in
-- 20260808120000). The explicit per-role revoke is the load-bearing line, not the
-- one above it. This function rewrites money-adjacent columns across the whole
-- payments table, so it is service_role-only; function-grants.test.ts enumerates
-- every security-definer function in public and will fail if that ever drifts.
revoke all on function public.backfill_processor_fees_once() from public;
grant execute on function public.backfill_processor_fees_once() to service_role;
revoke execute on function public.backfill_processor_fees_once() from anon, authenticated;

comment on function public.backfill_processor_fees_once() is
  'One-shot, idempotent: recovers each payment''s real processor fee from the PayMongo '
  'payload already stored in payments.raw and tags it ''historical''. Writes '
  'processor_fee_cents and processor_fee_source only — settled money (net_to_org, amount, '
  'platform_fee, refunded_amount) is never repriced. Returns the number of rows changed; '
  'a second run returns 0.';

select public.backfill_processor_fees_once();
