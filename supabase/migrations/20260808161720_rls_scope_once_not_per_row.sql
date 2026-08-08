-- Make the admin read policies evaluate the caller's scope ONCE per query
-- instead of once per row.
--
-- THE BUG (measured 2026-08-09, hosted project, ~5,900 payments):
-- The Payments page was intermittently failing with Postgres 57014,
-- "canceling statement due to statement timeout". The same count(*) over
-- admin_payments_v took 4.9 ms as `postgres` (RLS bypassed) and 1,220 ms as
-- `authenticated`. The plan showed why:
--
--   Seq Scan on registrations r  (actual time=7.784..720.719 rows=1964)
--     Filter: (EXISTS(SubPlan 1) OR auth_can_admin_org(org_id))
--     SubPlan 1 -> Index Scan ... (loops=1964)
--
-- Two permissive SELECT policies OR'd together, both re-evaluated per row:
-- `auth_can_admin_org(org_id)` takes a COLUMN, so being STABLE does not save
-- it, and `auth.uid()` unwrapped is re-read for every row. The resulting
-- predicate is also not sargable, so registrations_org_id_idx could not be
-- used at all. Four such queries run in parallel per page load, which is what
-- pushed them past the 8s statement_timeout.
--
-- THE FIX: express the same conditions so the planner hoists them into an
-- InitPlan / hashed subplan evaluated once, and so the org comparison stays a
-- plain column-IN-set that an index can serve. Wrapping any auth.* call in
-- `(select ...)` is the standard Supabase idiom for this.
--
-- ACCESS SEMANTICS ARE UNCHANGED — that is the point, and it is verified, not
-- assumed. `auth_can_admin_org(t)` is by definition
--   auth_is_super_admin() OR exists(user_roles where user_id = auth.uid()
--                                   and org_id = t and role in ('editor','admin'))
-- so the inlined form below is the same predicate, just hoisted. The
-- `org_id is not null` guard keeps `IN` exactly equivalent to the original
-- equality-EXISTS in the presence of super_admin rows, whose org_id is NULL.
--
-- The helper functions are deliberately NOT modified: they are still correct
-- and are used by other policies and RPCs. Only these six SELECT policies
-- change, and each is recreated with the same name, same command, same
-- PERMISSIVE default and the same PUBLIC role list it had before.

-- ── payments ────────────────────────────────────────────────────────────────

drop policy if exists payments_read_org_admin on public.payments;
create policy payments_read_org_admin on public.payments
for select using (
  (select public.auth_is_super_admin())
  or org_id in (
    select ur.org_id
    from public.user_roles ur
    where ur.user_id = (select auth.uid())
      and ur.org_id is not null
      and ur.role in ('editor', 'admin')
  )
);

drop policy if exists payments_read_own on public.payments;
create policy payments_read_own on public.payments
for select using (
  -- The correlated EXISTS stays (it is a primary-key lookup and cheap); only
  -- auth.uid() is hoisted, which is what was costing a re-read per row.
  exists (
    select 1
    from public.registrations r
    where r.id = payments.registration_id
      and r.user_id = (select auth.uid())
  )
);

-- ── registrations ───────────────────────────────────────────────────────────

drop policy if exists registrations_read_org_admin on public.registrations;
create policy registrations_read_org_admin on public.registrations
for select using (
  (select public.auth_is_super_admin())
  or org_id in (
    select ur.org_id
    from public.user_roles ur
    where ur.user_id = (select auth.uid())
      and ur.org_id is not null
      and ur.role in ('editor', 'admin')
  )
);

drop policy if exists registrations_read_own on public.registrations;
create policy registrations_read_own on public.registrations
for select using ((select auth.uid()) = user_id);

-- ── profiles ────────────────────────────────────────────────────────────────

drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own on public.profiles
for select using ((select auth.uid()) = id);

drop policy if exists profiles_read_org_admin on public.profiles;
create policy profiles_read_org_admin on public.profiles
for select using (
  -- The EXISTS wrapper is LOAD-BEARING and must not be flattened to
  -- `super_admin OR exists(...)`: the original grants a super admin access to
  -- a profile only if that profile has at least one registration. Hoisting the
  -- super-admin test out of the EXISTS would widen access to every profile in
  -- the system, including those with no registrations at all. Both inner tests
  -- are hoisted instead, which changes the cost without changing the answer.
  exists (
    select 1
    from public.registrations r
    where r.user_id = profiles.id
      and (
        (select public.auth_is_super_admin())
        or r.org_id in (
          select ur.org_id
          from public.user_roles ur
          where ur.user_id = (select auth.uid())
            and ur.org_id is not null
            and ur.role in ('editor', 'admin')
        )
      )
  )
);
