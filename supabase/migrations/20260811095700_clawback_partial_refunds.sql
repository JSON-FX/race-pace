-- Recover a PARTIAL refund on an already-settled entry. Task 8c.
--
-- THE LEAK. A ₱2,000 entry confirms at net_to_org 191000 and is settled: statement
-- A transfers ₱1,910 and stamps the row with payout_statement_id. The runner then
-- cancels under a flat_fee policy; refund_registration_tx returns them ₱1,610 and
-- drops net_to_org to the ₱300 retention, with status 'partially_refunded'.
--
-- The next statement matched that row against NEITHER filter:
--   * earn     wants payout_statement_id is null  -- the row is stamped, excluded;
--   * clawback wanted status = 'refunded'         -- the row is partially, excluded.
-- So Race Pace paid the runner ₱1,610 out of its own account and never recovered it
-- from an organizer who had already been paid ₱1,910 for that entry. Both statements
-- balance internally, so nothing flagged it.
--
-- WHY IT WAS INVISIBLE. Under the pre-2026-08-11 rule a partial refund rewrote
-- `amount` down and re-struck commission, so the row described a SMALLER SALE rather
-- than a settled sale with money clawed back. 20260811094000_refund_net_to_org.sql
-- stopped rewriting `amount` — correctly, because rewriting it permanently breaks
-- `amount - processor_fee_cents = the provider's reported net_amount` — and that is
-- what leaves the row in a state neither filter anticipated.
--
-- THE RULE. A stamped row owes back whatever the organizer was paid minus what they
-- are still entitled to keep: (net_to_org at settlement) - (current net_to_org).
--
-- SIZING: refunded_amount, NOT net_to_org. net_to_org has ALREADY been overwritten
-- by the partial refund — it now holds the retention — so the settled figure is not
-- recoverable from it. refunded_amount is, because the partial branch of
-- refund_registration_tx writes `refunded_amount = p_refunded_amount` and
-- `net_to_org = p_retained_net` under a guard that RAISES unless
--   p_refunded_amount + p_retained_net = the net_to_org it read before the update
-- (20260811094000, 'refund_split_mismatch'). That guard is exactly the identity
--   refunded_amount = net_to_org_before - net_to_org_after
-- so refunded_amount IS the rule's difference, recorded rather than reconstructed.
-- It is also int NOT NULL default 0 with a `>= 0` check, so the term can never be
-- null and can never flip the sign of a clawback.
--
-- THE FULL-REFUND PATH IS UNTOUCHED. Its sum keeps reading net_to_org off
-- status = 'refunded' rows, byte-for-byte the expression that was dumped, with the
-- partial term ADDED to it rather than folded into it. The two are disjoint by
-- status, and a fully refunded row deliberately keeps its net_to_org
-- (20260811094000's own comment says so), so nothing about that number changes.
--
-- DISJOINTNESS, which is what stops a double-count. The new clawback term requires
-- payout_statement_id IS NOT NULL. Every other sum in this function — gross,
-- commission, processing, earn and refunds_in_period_cents — requires
-- payout_statement_id IS NULL. So a partially refunded row is in exactly one side:
-- unstamped, its retention is earned and its refunded_amount is netted out as
-- refunds_in_period; stamped, its refunded_amount is clawed back and it contributes
-- to none of the other five. Never both, by construction rather than by convention.
-- refunds_in_period_cents' sum is not touched at all.
--
-- BODY PROVENANCE. Both bodies are the LIVE bodies, dumped with
--   select pg_get_functiondef(p.oid) from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('payout_open_statement','payout_mark_paid');
-- NOT reconstructed from migration files. Dumped from LOCAL, not from --linked:
-- the hosted project whaqarofxdlzxrelbcrq has not had 20260811095000 or
-- 20260811095500 pushed, so its payout_open_statement is still the 3-column version
-- with no processing_cents and no refunds_in_period_cents. Local is built from these
-- migrations and its dump matches 20260811095500's body exactly, which is what makes
-- it the authoritative shape here. payout_mark_paid is identical in both.

-- ---------------------------------------------------------------------------
-- payout_open_statement
-- ---------------------------------------------------------------------------
-- Two edits to the dumped body and nothing else:
--   1. the clawback expression becomes the existing net_to_org sum PLUS a new
--      refunded_amount sum over status = 'partially_refunded' rows carrying an earn
--      stamp and no clawback stamp;
--   2. v_refunds' comment updated to say so.
-- The other five sums, the insert, and `net_owed = v_earn - v_refunds` are the dump.
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
  --   clawback = already-transferred money    (refunded OR partially refunded, HAS
  --              since refunded/reduced        a statement stamp, no clawback stamp)
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
    -- THE CLAWBACK, in two terms because the two cases are sized from different
    -- columns, not because they are two different rules.
    --   'refunded'           -> net_to_org, which a full refund leaves in place, so
    --                           it still reads as what was transferred. Verbatim
    --                           from the dump; this number must not move.
    --   'partially_refunded' -> refunded_amount, because net_to_org has already been
    --                           overwritten with the retention and no longer says
    --                           what was settled. See the header.
    -- Disjoint from each other by status, and from all five sums above by the stamp.
    coalesce(sum(p.net_to_org)          filter (where p.status = 'refunded'
                                                  and p.payout_statement_id is not null
                                                  and p.payout_clawback_id is null), 0)
  + coalesce(sum(p.refunded_amount)     filter (where p.status = 'partially_refunded'
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

-- ---------------------------------------------------------------------------
-- payout_mark_paid
-- ---------------------------------------------------------------------------
-- Widened to match, so the once-only guarantee covers the rows the sum now counts:
-- payout_clawback_id is still the gate, and a partially refunded row gets stamped
-- exactly as a fully refunded one does. Without this the recovery would repeat on
-- every subsequent statement, which is a worse bug than the leak it fixes.
--
-- ORDERING HAZARD, new with this change. The earn UPDATE above runs FIRST and stamps
-- unstamped paid/partial rows; the clawback UPDATE then sees them already stamped. A
-- fully refunded row was immune because the earn UPDATE's status filter never matched
-- it, but a partially refunded one now matches BOTH. So the clawback UPDATE excludes
-- rows whose earn stamp is this very statement:
--
--   p.payout_statement_id <> p_statement_id
--
-- Both operands are non-null there — the preceding predicate requires it, and
-- p_statement_id identifies the statement being settled — so plain <> is total.
-- Without it, an entry partially refunded BEFORE its first payout would be recorded
-- as "recovered" when it was only netted out of that statement's own earnings, and
-- because the clawback stamp can never be set twice, a LATER refund on that same row
-- would be permanently unrecoverable. The single edit to the dumped body is that
-- clawback UPDATE's WHERE clause; the earn UPDATE, the lock, the status guards and
-- the statement UPDATE are untouched.
create or replace function public.payout_mark_paid(
  p_statement_id uuid, p_reference text, p_note text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event  uuid;
  v_status text;
begin
  if not public.auth_is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select s.event_id, s.status into v_event, v_status
    from public.payout_statements s where s.id = p_statement_id for update;
  if v_event is null then return 'not_found'; end if;
  if v_status = 'paid' then return 'already'; end if;

  update public.payments p
     set payout_statement_id = p_statement_id
    from public.registrations r
   where r.id = p.registration_id
     and r.event_id = v_event
     and p.status in ('paid','partially_refunded')
     and p.payout_statement_id is null;

  update public.payments p
     set payout_clawback_id = p_statement_id
    from public.registrations r
   where r.id = p.registration_id
     and r.event_id = v_event
     and p.status in ('refunded','partially_refunded')
     and p.payout_statement_id is not null
     and p.payout_statement_id <> p_statement_id
     and p.payout_clawback_id is null;

  update public.payout_statements
     set status = 'paid', paid_at = now(), paid_by = auth.uid(),
         reference = p_reference, note = p_note
   where id = p_statement_id;

  return 'paid';
end;
$$;

-- Re-emitted verbatim from 20260811095500 / 20260807090300. `create or replace
-- function` keeps the existing ACL, so these are assertions rather than repairs — but
-- this repo has already been bitten twice by assuming a grant was in the state it
-- looked like: `revoke ... from public` does NOT lock a function (anon kept EXECUTE
-- through Supabase's named-role default privileges, a proven payment bypass —
-- 20260808110000), and an event trigger once stripped `authenticated` from
-- client-called RPCs on every CREATE OR REPLACE (20260808130000). Both functions are
-- on function-grants.test.ts's AUTHENTICATED_ALLOWLIST and gate internally on
-- auth_is_super_admin(); losing that grant would break the payout console silently.
revoke all on function public.payout_open_statement(uuid)           from public;
revoke all on function public.payout_mark_paid(uuid, text, text)    from public;
grant execute on function public.payout_open_statement(uuid)        to authenticated;
grant execute on function public.payout_mark_paid(uuid, text, text) to authenticated;
revoke execute on function public.payout_open_statement(uuid)        from anon;
revoke execute on function public.payout_mark_paid(uuid, text, text) from anon;
