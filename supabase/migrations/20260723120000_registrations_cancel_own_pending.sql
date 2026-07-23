-- Let a runner cancel (delete) their own registration while it is still unpaid.
-- Guard the non-atomic money path: even when registrations.status is still 'pending',
-- block the delete if a payment for it has actually been captured or refunded
-- (paid/refunded) -- otherwise a stuck-pending row whose payment already went through
-- could be hard-deleted, cascading away the captured payment record. A pending or
-- failed payment does not block (the registration is genuinely unpaid).
-- Pending registrations never took a category slot, so no slot bookkeeping is needed.
-- Deleting the row cascades to its payment and addons (both ON DELETE CASCADE).
grant delete on registrations to authenticated;

create policy "registrations_delete_own_pending" on registrations
  for delete using (
    auth.uid() = user_id
    and status = 'pending'
    and not exists (
      select 1 from payments p
      where p.registration_id = registrations.id
        and p.status in ('paid', 'refunded')
    )
  );
