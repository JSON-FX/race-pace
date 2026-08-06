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
--
-- `set search_path = ''` + fully schema-qualified, NOT `set search_path = public` as
-- this function originally shipped with. Review found that `public` still leaves
-- `pg_temp` implicit-first in the resolution order, and every unqualified reference
-- here — `registrations`, `events`, `auth_can_admin_org` — resolves through it. A
-- caller who can CREATE in `pg_temp` (any authenticated role always can; that schema
-- is per-session and needs no grant) can shadow any of those names with their own
-- pg_temp objects and this SECURITY DEFINER function will call THEIRS, not the real
-- ones — reproduced end to end against this exact function in review: a `pg_temp`
-- `user_roles` shadow made `auth_can_admin_org` (called unqualified, so through the
-- same vulnerable path) approve a rival org. `''` removes `public` (and therefore
-- `pg_temp`'s implicit position ahead of it) from the path entirely, so every name
-- MUST be schema-qualified or it doesn't resolve at all — verified after this fix by
-- re-attempting the same pg_temp shadow: it did not intercept the call.
-- `20260806190000_admin_kpi_aggregates.sql`, committed the same day, already uses
-- this hardened form — this function should have matched it from the start.
-- auth_can_admin_org itself is unchanged (pre-existing, shared by many policies —
-- hardening it is a separate follow-up, not folded into this migration).
-- CORRECTION (see 20260806202000_harden_auth_helper_search_path.sql): that
-- follow-up already happened, two migrations later. `auth_can_admin_org` (and
-- `auth_is_super_admin`, which it calls) were hardened to `search_path = ''` there.
-- Read the paragraph above as historical only — as of 20260806202000,
-- auth_can_admin_org IS hardened. Do not cite it as a live gap.
create or replace function public.admin_registration_emails(p_event_id uuid)
returns table (registration_id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, u.email::text
  from public.registrations r
  join public.events e on e.id = r.event_id
  join auth.users u on u.id = r.user_id
  where r.event_id = p_event_id
    and public.auth_can_admin_org(e.org_id);
$$;

revoke all on function public.admin_registration_emails(uuid) from public;
grant execute on function public.admin_registration_emails(uuid) to authenticated;
