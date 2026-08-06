-- Admin visual parity V3: Registrations bulk "Cancel" action needs a real,
-- authorized write path. There is currently NO admin UPDATE/DELETE policy on
-- `registrations` at all — only `registrations_delete_own_pending` (the runner
-- cancelling their OWN unpaid registration, see
-- 20260723120000_registrations_cancel_own_pending.sql) and org-admin SELECT
-- (20260722100000_registrations_admin_read.sql). Granting UPDATE via RLS would
-- also require re-deriving the "which transitions are legal" state machine in a
-- WITH CHECK clause; a SECURITY DEFINER function that runs its own
-- auth_can_admin_org check — same shape as checkin_roster / refund_registration_tx
-- — keeps that logic in one place and keeps the UPDATE grant off the table.
--
-- Deliberately restricted to PENDING registrations with no in-flight or captured
-- payment. A PAID registration must go through refund_registration_tx (money
-- movement + slot release together, atomically) — "Cancel" flipping
-- registrations.status straight to 'cancelled' on a paid row would strand the
-- org's revenue and the runner's captured payment with no refund record.
--
-- IMPORTANT — a pending registration reserves NO category slot. Read
-- registrations-checkout/index.ts before assuming otherwise: it inserts the
-- registration as 'pending' and only ever READS categories.slots_taken (the
-- sold-out check). slots_taken is incremented ONLY at payment confirmation
-- (confirm_payment_tx, 20260723100000_money_txn_rpcs.sql:32, and the legacy
-- increment_slot) and decremented ONLY at refund (refund_registration_tx,
-- same file:71). This function previously (incorrectly) decremented
-- slots_taken on every cancel regardless — reproduced in review: cancelling
-- two never-paid registrations moved a category's slots_taken from 9 to 7,
-- i.e. it manufactured 2 slots of capacity that were never actually occupied.
-- At scale that oversells: bulk-cancelling N abandoned checkouts on a
-- sold-out category frees N slots nobody vacated. Fixed by removing that
-- update entirely — cancelling an unpaid registration is bookkeeping-only,
-- full stop.
--
-- IMPORTANT — a 'pending' registration.status does not mean "no money is
-- moving". registrations-checkout upserts a `payments` row with status
-- 'pending' (and a live PayMongo checkout_url) in the SAME request that
-- creates the registration — see registrations-checkout/index.ts's
-- `db.from("payments").upsert(...)` right after the registration insert.
-- That checkout can complete seconds later via payments-webhook ->
-- confirmPayment -> confirm_payment_tx, independently of anything this
-- admin does. Cancelling while that payment is still 'pending' races it:
-- confirm_payment_tx's own guard (money_txn_rpcs.sql:21, "v_status <>
-- 'pending': never re-confirm") would silently no-op the webhook AFTER
-- PayMongo has already captured the money, leaving it captured with no
-- ticket and no refund record. So this function additionally blocks on a
-- payments row whose status is 'pending' (non-terminal — might still
-- complete) or already 'paid'/'refunded' (money already moved; those cases
-- shouldn't reach here with registrations.status = 'pending' in the first
-- place, but are rejected defensively rather than assumed impossible). Only
-- a MISSING payments row or one that's terminally 'failed' (money never
-- captured) is safe to cancel.
--
-- `set search_path = ''` + fully schema-qualified, NOT `set search_path = public`
-- as this function originally shipped with — see
-- 20260806200000_admin_registration_emails_rpc.sql's header comment for the
-- exact pg_temp-shadowing attack this closes (reproduced end to end in review
-- against this function too: a rival org's admin cancelled a registration they
-- had no authority over by shadowing user_roles in pg_temp). auth_can_admin_org
-- itself is unchanged — hardening it is a separate follow-up.
create or replace function public.admin_cancel_registration(p_registration_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_status public.registration_status;
  v_payment_status public.payment_status;
begin
  select r.org_id, r.status, p.status
    into v_org_id, v_status, v_payment_status
  from public.registrations r
  left join public.payments p on p.registration_id = r.id
  where r.id = p_registration_id
  for update of r;

  if not found then
    return 'not_found';
  end if;

  if not public.auth_can_admin_org(v_org_id) then
    return 'unauthorized';
  end if;

  if v_status = 'cancelled' then
    return 'already';
  end if;

  if v_status <> 'pending' then
    return 'not_cancellable';
  end if;

  -- Non-terminal: the checkout could still complete out from under us.
  if v_payment_status = 'pending' then
    return 'payment_in_flight';
  end if;

  -- Terminal, but money already moved (or moved and came back) — belongs to
  -- refund_registration_tx, not here. Not expected to coexist with
  -- registrations.status = 'pending' today, but rejected explicitly rather
  -- than assumed unreachable.
  if v_payment_status in ('paid', 'refunded') then
    return 'not_cancellable';
  end if;

  -- v_payment_status is null (no payments row at all) or 'failed' (checkout
  -- never captured money): safe. No slot to release — see header comment.
  update public.registrations set status = 'cancelled' where id = p_registration_id;

  return 'cancelled';
end;
$$;

revoke all on function public.admin_cancel_registration(uuid) from public;
grant execute on function public.admin_cancel_registration(uuid) to authenticated;
