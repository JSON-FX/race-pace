-- supabase/migrations/20260818120000_org_management.sql
--
-- Organization management: suspend and delete, from the platform console.
--
-- Three changes, each with an incident behind it. See
-- docs/specs/2026-08-18-org-management-design.md.
--
-- AMENDED IN PLACE 2026-08-18 (review round 1), which is allowed only because
-- this migration has only ever run through a local `db reset` and has never
-- been pushed to the hosted project. See task-2-report.md for the review that
-- produced these changes. Do not treat this header as license to edit any
-- OTHER migration in place — the rest of this repo's migrations have run
-- against the hosted project and a follow-up migration is required instead.

-- ---------------------------------------------------------------------------
-- 1. A suspended org must stay visible to the people who manage it
-- ---------------------------------------------------------------------------
-- `orgs_read_active` was `using (is_active = true)` — for EVERY authenticated
-- caller, super admin included. Suspending an org therefore removed it from the
-- one page a super admin would un-suspend it from, and blanked the console for
-- the org's own staff. Recorded as a KNOWN LIMITATION in
-- apps/web/lib/queries/organizations.ts before this migration existed.
--
-- The predicate is `auth_can_admin_org(id)` inlined rather than called, per
-- 20260808161720: passing a COLUMN to that function defeats STABLE and forces
-- per-row re-evaluation, which that migration measured taking a query from
-- 4.9ms to 1,220ms and into a production statement timeout (57014) on exactly
-- this shape of predicate. Inlined here from the start rather than shipped
-- correlated and fixed later. `org_id is not null` keeps the `in` exactly
-- equivalent to `auth_can_admin_org`'s own EXISTS in the presence of
-- super_admin rows, whose org_id is NULL. Anonymous callers match neither
-- branch, so the storefront still cannot see a suspended organization.
drop policy if exists orgs_read_active on organizations;
create policy orgs_read_active on organizations
  for select using (
    is_active
    or (select public.auth_is_super_admin())
    or id in (
      select ur.org_id
      from public.user_roles ur
      where ur.user_id = (select auth.uid())
        and ur.org_id is not null
        and ur.role in ('editor', 'admin')
    )
  );

-- ---------------------------------------------------------------------------
-- 2. A suspended org's events leave the storefront
-- ---------------------------------------------------------------------------
-- `events_read_published` was `status <> 'draft'` and never looked at the org,
-- so suspending an organization left its whole catalog on sale. Hiding the org
-- row alone does nothing here: events are read by their own policy.
--
-- An UNCORRELATED `org_id in (select id from organizations where is_active)`,
-- not a correlated `exists (... where o.id = events.org_id ...)`: 20260808161720
-- exists because a correlated per-row subplan on this table's read path put a
-- production query 250x over budget. The uncorrelated form lets the planner
-- hoist the inner select into a hashed InitPlan evaluated once per statement —
-- on the hottest anonymous query in the app, so this shape is not optional.
--
-- `events_read_org_admin` (auth_can_admin_org(org_id)) is a separate permissive
-- policy and is untouched — policies are OR'd, so org staff keep full sight of
-- their own events while suspended.
drop policy if exists events_read_published on events;
create policy events_read_published on events
  for select using (
    status <> 'draft'::event_status
    and org_id in (select id from public.organizations where is_active)
  );

-- ---------------------------------------------------------------------------
-- 3. Deleting an organization
-- ---------------------------------------------------------------------------
-- WHY THIS IS A FUNCTION AND NOT `delete from organizations`:
--
-- NOT because a plain delete fails on the ordering hazard below — it doesn't.
-- Verified 2026-08-18 against this exact fixture (one event, two categories,
-- a registration in each): `delete from organizations` succeeds. All of the
-- cascades and the `registrations_category_id_fkey` NO ACTION check resolve
-- inside the SAME top-level statement's after-trigger queue, so by the time
-- that constraint is checked the registrations are already gone. (The
-- constraint itself is real — `delete from categories` directly, with
-- registrations still present, does fail with a foreign key violation — a
-- plain org-level delete just never reaches that state.)
--
-- The actual reasons this is a function:
--   1. The money guard and the deletes must be one atomic unit. A plain
--      `delete from organizations` has no way to check `payments` first and
--      abort before touching anything.
--   2. Task 5 (the console's delete action) consumes the returned counts —
--      events/categories/registrations/payments/checkins/members/statements —
--      to show what was removed. A bare `delete` returns nothing structured.
--   3. Defence in depth: the explicit `registrations` → `categories` →
--      `organizations` order costs nothing and survives a future schema change
--      that turns the NO ACTION constraint into one Postgres does enforce
--      mid-cascade (e.g. a deferred or per-row trigger). It is insurance
--      against a hazard that does not currently reproduce, not a fix for one
--      that does.
create or replace function delete_organization_tx(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_blocking int;
  v_counts   jsonb;
begin
  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'org_not_found' using errcode = 'P0002';
  end if;

  -- TOCTOU guard, part 1: lock every payment row for this org before we look
  -- at any of them. `confirm_payment_tx` locks the specific payment row it
  -- settles, so if one is mid-flight, this blocks here until that transaction
  -- commits or rolls back — we then see its final status, never a stale
  -- READ COMMITTED snapshot racing an in-progress settle.
  perform 1 from public.payments where org_id = p_org_id for update;

  -- The money guard is re-checked HERE, not only in the Edge Function, so the
  -- invariant survives any future caller. `refunded` and `partially_refunded`
  -- block as hard as `paid`: a refund is still money that moved and still a
  -- PayMongo record that may have to be reconciled.
  select count(*) into v_blocking
    from public.payments
   where org_id = p_org_id
     and status in ('paid', 'refunded', 'partially_refunded');
  if v_blocking > 0 then
    raise exception 'org_has_payments: % settled payment(s)', v_blocking
      using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'events',            (select count(*) from public.events            where org_id = p_org_id),
    'categories',        (select count(*) from public.categories        where org_id = p_org_id),
    'registrations',     (select count(*) from public.registrations     where org_id = p_org_id),
    'payments',          (select count(*) from public.payments          where org_id = p_org_id),
    'checkins',          (select count(*) from public.checkins          where org_id = p_org_id),
    'members',           (select count(*) from public.user_roles        where org_id = p_org_id),
    'payout_statements', (select count(*) from public.payout_statements where org_id = p_org_id)
  ) into v_counts;

  -- TOCTOU guard, part 2: re-run the guard immediately before the destructive
  -- deletes. Part 1's lock closes the race against a settle that was already
  -- in flight when we arrived; it holds no lock on a payment row that did not
  -- exist yet, so this second count is what catches one inserted (and already
  -- committed as paid) between the lock above and here.
  --
  -- Residual, deliberately not closed: a payment created and settled entirely
  -- AFTER this statement — inside the window between this check and the
  -- commit of the deletes below. Closing that would need locking the whole
  -- `organizations` row against concurrent insert, which this function does
  -- not do. Left open because it is unreachable in the flow this ships for:
  -- Task 3 makes `registrations-checkout` refuse a suspended org's event, and
  -- the console only offers delete on an org that has already been suspended
  -- — so by the time this function can be called, checkout can no longer
  -- create anything to race it with.
  select count(*) into v_blocking
    from public.payments
   where org_id = p_org_id
     and status in ('paid', 'refunded', 'partially_refunded');
  if v_blocking > 0 then
    raise exception 'org_has_payments: % settled payment(s)', v_blocking
      using errcode = 'P0001';
  end if;

  -- Registrations first, categories second: not required by the constraint
  -- set as it exists today (see the correction above), but the order the NO
  -- ACTION constraint WOULD need if it ever mattered, at zero cost to keep.
  -- Cascades registration_addons, registration_audit, payments, checkins.
  delete from public.registrations where org_id = p_org_id;
  delete from public.categories    where org_id = p_org_id;
  -- Cascades events, addons, form_fields, payout_statements, user_roles.
  delete from public.organizations where id = p_org_id;

  return v_counts;
end;
$fn$;

-- Postgres grants EXECUTE to PUBLIC on every newly created function by
-- built-in default, so this revoke/grant pair is not optional regardless of
-- what else is or isn't installed around it — a missing grant has bitten this
-- repo three times. (An earlier event trigger, 20260808120200, also enforced
-- this at DDL time; it was reversed by 20260808130000 because it fired on
-- CREATE OR REPLACE too and silently stripped grants from existing functions.
-- The guard now is `supabase/tests/function-grants.test.ts`, which enumerates
-- every SECURITY DEFINER function in `public` and fails if this one becomes
-- anon- or authenticated-executable.) service_role ONLY: the org-provision
-- Edge Function is the sole caller, and nothing reachable by a browser should
-- be able to erase an organization.
revoke all on function delete_organization_tx(uuid) from public;
grant execute on function delete_organization_tx(uuid) to service_role;

-- Proof, not assumption. Inspecting pg_default_acl is not proof.
do $check$
begin
  if not has_function_privilege('service_role', 'delete_organization_tx(uuid)', 'EXECUTE') then
    raise exception 'delete_organization_tx: service_role EXECUTE grant missing';
  end if;
  if has_function_privilege('authenticated', 'delete_organization_tx(uuid)', 'EXECUTE') then
    raise exception 'delete_organization_tx: authenticated must not hold EXECUTE';
  end if;
  if has_function_privilege('anon', 'delete_organization_tx(uuid)', 'EXECUTE') then
    raise exception 'delete_organization_tx: anon must not hold EXECUTE';
  end if;
end
$check$;
