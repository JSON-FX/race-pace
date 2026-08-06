-- Admin visual parity V3: the Registrations table's Runner cell needs an email
-- second line (see docs/superpowers/specs/2026-08-06-admin-visual-parity-spec.md,
-- "Table cell composition"). No table in this schema stores a runner's email —
-- `profiles` deliberately doesn't duplicate it (see 20260718182546_init_orgs_profiles.sql),
-- and `auth.users.email` has no RLS policy granting `authenticated` direct SELECT, so
-- `admin_registrations_v` (security_invoker — see 20260804120000_admin_list_views.sql)
-- cannot simply join it: the join would 42501 for every caller.
--
-- Same shape as checkin_roster (20260806150000_checkin_rpcs.sql): a SECURITY DEFINER
-- function that runs its own org-admin authorization check (auth_can_admin_org) rather
-- than widening any RLS policy or view. This is scoped to exactly the columns an admin
-- needs (registration id + email) for one event, nothing else from auth.users leaks.
create or replace function public.admin_registration_emails(p_event_id uuid)
returns table (registration_id uuid, email text)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, u.email::text
  from registrations r
  join events e on e.id = r.event_id
  join auth.users u on u.id = r.user_id
  where r.event_id = p_event_id
    and auth_can_admin_org(e.org_id);
$$;

revoke all on function public.admin_registration_emails(uuid) from public;
grant execute on function public.admin_registration_emails(uuid) to authenticated;
