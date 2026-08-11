-- Claw back only refunds that land AFTER settlement. Corrects 20260811095700.
--
-- THE DEFECT, introduced by 20260811095700 and confirmed by running the sequence.
-- An entry partially refunded BEFORE its first payout was billed to the organizer on
-- the next statement — money they were never transferred. Over-charge: the unsafe
-- direction, and worse than the leak 095700 closed.
--
--   1. ₱2,000 entry, net_to_org 191000. Runner partially refunds EARLY, before any
--      payout: they get 161000, the organizer retains 30000, status
--      'partially_refunded', row UNSTAMPED.
--   2. Statement A: the earn filter matches (unstamped), so A earns the 30000
--      retention and reports the 161000 in refunds_in_period_cents. The clawback
--      filter does not match — no stamp yet. net_owed 30000. Correct.
--   3. payout_mark_paid(A): the earn UPDATE stamps payout_statement_id = A. 095700's
--      `payout_statement_id <> p_statement_id` predicate then skips the clawback
--      UPDATE, so payout_clawback_id stays NULL.
--   4. Statement B, WITH NO NEW REFUND ANYWHERE: the clawback filter now matches —
--      status 'partially_refunded', payout_statement_id not null (step 3),
--      payout_clawback_id null. It recovers the full refunded_amount, 161000.
--
--   => net_owed_cents = -161000, billing the organizer ₱1,610 they never received.
--
-- 095700's `<>` predicate was itself correct and is still needed in spirit: without
-- it the clawback UPDATE would claim rows the earn UPDATE had just stamped in the
-- same call. What it got wrong was leaving payout_clawback_id NULL afterwards, which
-- left the row permanently eligible for a clawback it had already accounted for. The
-- row was never over-paid, so there was never anything to recover.
--
-- THE MISSING DISTINCTION: whether the refund happened BEFORE or AFTER the money was
-- transferred.
--   * netted   -- refund preceded settlement. The statement that settled the row
--                 earned only the RETENTION and reported the refund in
--                 refunds_in_period_cents. Nothing was over-paid. Nothing to recover.
--   * clawback -- refund followed settlement. The statement paid the full net_to_org
--                 and the organizer now holds money that went back to the runner.
--
-- WHERE IT IS KNOWABLE: payout_mark_paid's earn UPDATE. A row it is earn-stamping
-- that is ALREADY 'partially_refunded' is, by definition, a row whose refund this
-- statement's own earnings already netted — the earn sum reads net_to_org, which the
-- refund had already reduced to the retention. So that refund is settled business at
-- the instant the stamp goes on, and the earn UPDATE marks it accounted for by
-- setting payout_clawback_id in the same statement. A 'paid' row has no refund to
-- account for and keeps a NULL clawback stamp, so a LATER refund on it is still
-- recovered normally — which is 095700's fix, preserved intact.
--
-- payout_clawback_id therefore reads as "the refund recorded on this row has been
-- accounted for", by netting or by recovery. That is a widening of the stamp's
-- meaning, not a new mechanism: it is still one stamp, still set exactly once, still
-- the once-only gate. `payout_statement_id` still means "these earnings were
-- transferred".
--
-- CONSEQUENCE: the `<>` predicate is now redundant and is REMOVED. The earn UPDATE
-- claims those rows via payout_clawback_id, so the clawback UPDATE's existing
-- `payout_clawback_id is null` gate already excludes them. Keeping a predicate that
-- no longer does anything would misrepresent which line is load-bearing. The clawback
-- UPDATE returns to its pre-095700 shape apart from the widened status list.
--
-- payout_open_statement IS NOT MODIFIED. Its clawback filter already requires
-- `payout_clawback_id is null`, so setting that stamp at settlement is sufficient and
-- the sums are correct as they stand. Its body was dumped and re-read to confirm this
-- rather than assumed; re-emitting an unchanged 90-line body would be transcription
-- risk with no benefit. The five earn-side sums, refunds_in_period_cents and
-- `net_owed = v_earn - v_refunds` are untouched, so the earn / clawback /
-- refunds_in_period disjointness argument in 095700's header still holds verbatim:
-- every earn-side sum requires payout_statement_id IS NULL, the clawback requires
-- IS NOT NULL.
--
-- BODY PROVENANCE. The LIVE body, dumped with
--   select pg_get_functiondef(p.oid) from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'payout_mark_paid';
-- (last written by 20260811095700), NOT reconstructed from migration files. Dumped
-- from LOCAL, not --linked: hosted whaqarofxdlzxrelbcrq is still on the pre-Task-6
-- three-column payout_open_statement and has none of 095000/095500/095700, so its
-- dump does not describe this branch. Two edits and nothing else:
--   1. the earn UPDATE also sets payout_clawback_id, via a CASE on status;
--   2. the clawback UPDATE drops `and p.payout_statement_id <> p_statement_id`.
-- The gate, the FOR UPDATE lock, the not_found/already guards, the widened status
-- list, the statement UPDATE and the return values are the dump.
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

  -- Earn stamp. A row that is ALREADY partially refunded when it is first settled had
  -- its refund netted out of THIS statement's earnings (the earn sum reads net_to_org,
  -- which the refund had already dropped to the retention), so that refund is
  -- accounted for here and now — never a clawback. Marking it in the same UPDATE is
  -- what makes the two mutually exclusive; leaving it NULL is exactly the over-charge
  -- 095700 shipped. A 'paid' row keeps a NULL clawback stamp so that a refund landing
  -- LATER is still recovered.
  --
  -- `else p.payout_clawback_id` rather than `else null`: this UPDATE requires a NULL
  -- payout_statement_id, and the clawback UPDATE requires a NON-NULL one, so the
  -- clawback stamp is provably already NULL on every row reached here. Writing the
  -- column back to itself keeps that an assumption this statement does not depend on.
  update public.payments p
     set payout_statement_id = p_statement_id,
         payout_clawback_id  = case
                                 when p.status = 'partially_refunded' then p_statement_id
                                 else p.payout_clawback_id
                               end
    from public.registrations r
   where r.id = p.registration_id
     and r.event_id = v_event
     and p.status in ('paid','partially_refunded')
     and p.payout_statement_id is null;

  -- Clawback stamp: money already transferred on an EARLIER statement and since
  -- refunded. Rows the UPDATE above just touched are excluded by `payout_clawback_id
  -- is null`, which it set — no ordering predicate needed.
  update public.payments p
     set payout_clawback_id = p_statement_id
    from public.registrations r
   where r.id = p.registration_id
     and r.event_id = v_event
     and p.status in ('refunded','partially_refunded')
     and p.payout_statement_id is not null
     and p.payout_clawback_id is null;

  update public.payout_statements
     set status = 'paid', paid_at = now(), paid_by = auth.uid(),
         reference = p_reference, note = p_note
   where id = p_statement_id;

  return 'paid';
end;
$$;

-- Re-emitted verbatim from 20260811095700 / 20260807090300. `create or replace
-- function` keeps the existing ACL, so these are assertions rather than repairs — but
-- `revoke ... from public` does NOT lock a Postgres function here: anon retains
-- EXECUTE through Supabase's named-role default privileges, which was a proven
-- payment bypass (20260808110000). payout_mark_paid is on function-grants.test.ts's
-- AUTHENTICATED_ALLOWLIST and gates internally on auth_is_super_admin().
revoke all on function public.payout_mark_paid(uuid, text, text)    from public;
grant execute on function public.payout_mark_paid(uuid, text, text) to authenticated;
revoke execute on function public.payout_mark_paid(uuid, text, text) from anon;
