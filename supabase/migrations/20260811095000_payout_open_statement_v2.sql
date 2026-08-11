-- Statement arithmetic on the three-party ledger. Design 2026-08-11 §7.
--
-- The old version (20260807090300_payout_statements.sql) computed
-- `gross - commission - refunds`. That predates payments.processor_fee_cents
-- entirely, so on today's ledger it over-pays: a plain ₱2,000 GCash entry at 3%
-- settled at ₱1,940 when the organizer's share is ₱1,910 — the platform ate
-- PayMongo's ₱30 on every row. And after Task 7 it was worse for a partial
-- refund, where `amount` and `platform_fee` deliberately stay at the original
-- charge: an entry whose organizer retained ₱300 still settled at ₱1,940.
--
-- Reconstructing it as `gross - commission - processing - refunds` would only
-- add a fourth number that has to agree with the other three, and Task 7's
-- immutable `amount`/`platform_fee` guarantee that it cannot.
--
-- Instead: net_to_org is ALREADY the authoritative per-payment answer, written
-- at confirmation (20260811093000_confirm_payment_tx_processor_fee.sql) and
-- moved to the retention by a partial refund (20260811094000_refund_net_to_org.sql).
-- Sum it. Gross, commission and processing become presentational columns that
-- EXPLAIN the total rather than compute it. Two figures that must agree cannot
-- disagree when only one of them decides anything.
--
-- THE TWO-STAMP MECHANISM IS UNCHANGED. payout_statement_id still means "these
-- earnings were transferred" and payout_clawback_id still means "this refund was
-- recovered"; the filters that key on them are copied from 20260807090300
-- verbatim, and payout_mark_paid is not touched at all. Only the summed COLUMN
-- and the extra processing line are new.

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
                                                  and p.payout_clawback_id is null), 0)
  into v_gross, v_comm, v_proc, v_earn, v_refunds
  from public.payments p
  join public.registrations r on r.id = p.registration_id
  where r.event_id = p_event_id;

  -- net_owed is v_earn - v_refunds, NOT v_gross - v_comm - v_proc - v_refunds.
  -- The three presentational figures are stored beside it, never multiplied back
  -- into it.
  insert into public.payout_statements
    (org_id, event_id, gross_cents, commission_cents, processing_cents,
     refunds_cents, net_owed_cents, opened_by)
  values
    (v_org, p_event_id, v_gross, v_comm, v_proc,
     v_refunds, v_earn - v_refunds, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- How many of this event's UNSETTLED payments still carry an ESTIMATED
-- processing fee.
--
-- Surfaced as a warning rather than a block. Blocking would strand a payout
-- behind a provider outage; warning shows the risk without creating a new way to
-- be stuck. Settled rows are out of scope on purpose — once the money is out the
-- door the estimate is history, and looking back at it is the drift view's job.
--
-- Gated on auth_is_super_admin() like the other two payout functions, and NOT
-- because the count is secret in itself: it is a settlement figure for an
-- arbitrary event id, and this is the contract that
-- supabase/tests/function-grants.test.ts's AUTHENTICATED_ALLOWLIST states for
-- every entry on it — "client-called, each refuses unauthorized callers
-- internally". A security-definer function added to that list without an
-- internal refusal would make the list's own comment false. plpgsql rather than
-- sql for that reason alone: a guard that returns null instead of raising is a
-- guard the console cannot tell apart from "nothing to warn about".
create or replace function public.payout_unreconciled_count(p_event_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.auth_is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select count(*)::integer into v_count
  from public.payments p
  join public.registrations r on r.id = p.registration_id
  where r.event_id = p_event_id
    and p.status in ('paid','partially_refunded')
    and p.payout_statement_id is null
    and p.processor_fee_source = 'predicted';

  return v_count;
end;
$$;

revoke all on function public.payout_open_statement(uuid)        from public;
revoke all on function public.payout_unreconciled_count(uuid)    from public;
grant execute on function public.payout_open_statement(uuid)     to authenticated;
grant execute on function public.payout_unreconciled_count(uuid) to authenticated;

-- Belt-and-braces, matching 20260811093000/20260811094000's posture. `revoke ...
-- from public` alone has already been shown in this repo NOT to be the whole
-- story — anon kept EXECUTE through Supabase's named-role default privileges,
-- and that was a proven payment bypass (20260808110000_lock_down_function_grants.sql).
-- Those defaults were stripped by 20260808120000, so this is a no-op today;
-- asserted anyway, because payout_unreconciled_count is the first brand-new
-- function in `public` since, and "it should be a no-op" is exactly the
-- assumption that failed last time.
revoke execute on function public.payout_open_statement(uuid)     from anon;
revoke execute on function public.payout_unreconciled_count(uuid) from anon;
