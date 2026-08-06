-- Follow-up to 20260806200000/20260806201000 (admin visual parity V3): those two
-- migrations were hardened to `search_path = ''`, but review found that hardening
-- a CALLER cannot help when the function it calls is the vulnerable one. Every
-- authorization decision in this app ultimately runs through `auth_can_admin_org`,
-- which calls `auth_is_super_admin` — both shipped (in 20260720150000_user_roles.sql)
-- with `set search_path = public` and an unqualified `user_roles` reference. Postgres
-- implicitly searches `pg_temp` FIRST whenever it isn't explicitly listed in the path,
-- so `public` alone still leaves it there. Reproduced end to end against BOTH
-- 20260806200000/201000's hardened functions (see task-v3-report.md's addendum): an
-- attacker holding no role on org B creates `pg_temp.user_roles` claiming
-- admin-on-org-B, and `auth_can_admin_org(orgB)` — despite being CALLED as
-- `public.auth_can_admin_org(...)` from a `search_path = ''` caller — still returns
-- true, because once execution enters the function body, its OWN `search_path=public`
-- takes over and `pg_temp` is still implicit-first there. The same shadow flips
-- `registrations_read_org_admin` and every other RLS policy built on this helper —
-- measured going from 0 to 1 visible row for a non-member.
--
-- Fix: `set search_path = ''` + fully qualify `public.user_roles` and the
-- `public.auth_is_super_admin()` call, on both functions. Signatures, return types
-- and behaviour are UNCHANGED — this is a name-resolution hardening, not a policy
-- change. `auth_can_admin_org` still accepts `role in ('editor','admin')` and super
-- admins; that boundary (an editor can read/cancel any registration or enumerate any
-- runner's email in their org, same as an admin) was already reviewed and confirmed
-- as the project owner's intended boundary, not something this migration touches.
--
-- `auth_can_check_in_event` (20260806150000_checkin_rpcs.sql) is the same shape —
-- same unqualified `user_roles`, same `set search_path = public`, same call into
-- `auth_is_super_admin()` — and is hardened here too, on the same reasoning. Its own
-- callers (`checkin_events`, `checkin_roster`) are PR2 (check-in), out of scope for
-- this migration, and are called out in task-v3-report.md's enumeration rather than
-- silently left unmentioned.
create or replace function public.auth_is_super_admin() returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'super_admin');
$$;

create or replace function public.auth_can_admin_org(target uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select public.auth_is_super_admin()
      or exists (select 1 from public.user_roles
                 where user_id = auth.uid() and org_id = target and role in ('editor','admin'));
$$;

create or replace function public.auth_can_check_in_event(p_org_id uuid, p_event_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.auth_is_super_admin()
      or exists (
        select 1 from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.org_id = p_org_id
          and ur.role in ('marshal', 'editor', 'admin')
          and (ur.event_scope is null or ur.event_scope = p_event_id)
      );
$$;
