-- Bookers need their transaction and ticket, not global access to every Passport
-- they manage. booked_by_user_id is server-owned; no client write grant is added.
create policy registrations_read_booker on public.registrations
 for select to authenticated using(booked_by_user_id = (select auth.uid()));
create policy payments_read_booker on public.payments
 for select to authenticated using(exists (
   select 1 from public.registrations r where r.id=payments.registration_id
     and r.booked_by_user_id=(select auth.uid())
 ));
create policy registration_addons_read_booker on public.registration_addons
 for select to authenticated using(exists (
   select 1 from public.registrations r where r.id=registration_addons.registration_id
     and r.booked_by_user_id=(select auth.uid())
 ));

-- Existing policies call these predicates even for anonymous readers. Preserve
-- their grants; a missing caller id returns no rows, including suspended orgs.
create or replace function public.auth_registered_event_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
 select r.event_id from public.registrations r
 where r.user_id=auth.uid() or r.booked_by_user_id=auth.uid()
$$;
create or replace function public.auth_registered_org_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
 select r.org_id from public.registrations r
 where r.user_id=auth.uid() or r.booked_by_user_id=auth.uid()
$$;
revoke all on function public.auth_registered_event_ids(), public.auth_registered_org_ids() from public;
grant execute on function public.auth_registered_event_ids(), public.auth_registered_org_ids() to anon, authenticated, service_role;
