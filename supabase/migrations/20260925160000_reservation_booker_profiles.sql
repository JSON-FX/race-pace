-- Organizers need the name and avatar of a reservation booker before that
-- person registers. Keep the existing registration profile policy intact.
create policy profiles_read_reservation_org_admin on public.profiles
for select to authenticated using (
  exists (
    select 1 from public.event_reservations r
    where r.user_id = profiles.id
      and public.auth_can_admin_org(r.org_id)
  )
);
