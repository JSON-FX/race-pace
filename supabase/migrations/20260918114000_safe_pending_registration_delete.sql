-- The old DELETE policy read payments under authenticated RLS. payments_read_own
-- reads registrations, so even a valid single cancellation recursed. Inspect
-- payment evidence under a narrow definer function and keep ordered lines out
-- of the runner's direct-delete path altogether.
create function public.registration_payment_clear_for_delete(p_registration_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.payments p
    where p.registration_id = p_registration_id
      and (p.provider = 'paymongo' or p.status::text not in ('pending','failed'))
  ) and not exists (
    select 1 from public.single_payment_captures c
    where c.registration_id = p_registration_id
  );
$$;
revoke all on function public.registration_payment_clear_for_delete(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.registration_payment_clear_for_delete(uuid)
  to authenticated,service_role;

drop policy if exists registrations_delete_own_pending on public.registrations;
create policy registrations_delete_own_pending on public.registrations
for delete to authenticated using (
  (select auth.uid()) = user_id
  and status = 'pending'
  and booking_order_id is null
  and public.registration_payment_clear_for_delete(id)
);
