-- A guest has no Auth user. The recorded booker must see collection status on
-- their managed ticket; Passport management alone grants no transaction access.
create policy kit_releases_read_booker on public.kit_releases
for select to authenticated using (exists (
  select 1 from public.registrations r
  where r.id=kit_releases.registration_id and r.org_id=kit_releases.org_id
    and r.booked_by_user_id=(select auth.uid())
));
