-- Let a runner cancel (delete) their own registration while it is still unpaid.
-- Pending registrations never took a category slot (increment_slot runs only on
-- payment confirmation), so no slot bookkeeping is needed here. Deleting the row
-- cascades to its pending payment and addons (both ON DELETE CASCADE).
grant delete on registrations to authenticated;

create policy "registrations_delete_own_pending" on registrations
  for delete using (auth.uid() = user_id and status = 'pending');
