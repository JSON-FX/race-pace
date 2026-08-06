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
-- Deliberately restricted to PENDING/FAILED-payment registrations. A PAID
-- registration must go through refund_registration_tx (money movement +
-- slot release together, atomically) — "Cancel" flipping registrations.status
-- straight to 'cancelled' on a paid row would strand the org's revenue and the
-- runner's captured payment with no refund record. Cancelling an unpaid
-- registration is just bookkeeping: no money to move, but the category slot
-- (if one was reserved) is released the same way a refund releases one.
create or replace function public.admin_cancel_registration(p_registration_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_category_id uuid;
  v_status registration_status;
  v_payment_status payment_status;
begin
  select r.org_id, r.category_id, r.status, p.status
    into v_org_id, v_category_id, v_status, v_payment_status
  from registrations r
  left join payments p on p.registration_id = r.id
  where r.id = p_registration_id
  for update of r;

  if not found then
    return 'not_found';
  end if;

  if not auth_can_admin_org(v_org_id) then
    return 'unauthorized';
  end if;

  if v_status = 'cancelled' then
    return 'already';
  end if;

  if v_status <> 'pending' or v_payment_status = 'paid' then
    return 'not_cancellable';
  end if;

  update registrations set status = 'cancelled' where id = p_registration_id;
  update categories set slots_taken = greatest(slots_taken - 1, 0) where id = v_category_id;

  return 'cancelled';
end;
$$;

revoke all on function public.admin_cancel_registration(uuid) from public;
grant execute on function public.admin_cancel_registration(uuid) to authenticated;
