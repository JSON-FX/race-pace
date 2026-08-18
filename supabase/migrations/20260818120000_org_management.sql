-- supabase/migrations/20260818120000_org_management.sql
--
-- Organization management: suspend and delete, from the platform console.
--
-- Three changes, each with an incident behind it. See
-- docs/specs/2026-08-18-org-management-design.md.

-- ---------------------------------------------------------------------------
-- 1. A suspended org must stay visible to the people who manage it
-- ---------------------------------------------------------------------------
-- `orgs_read_active` was `using (is_active = true)` — for EVERY authenticated
-- caller, super admin included. Suspending an org therefore removed it from the
-- one page a super admin would un-suspend it from, and blanked the console for
-- the org's own staff. Recorded as a KNOWN LIMITATION in
-- apps/web/lib/queries/organizations.ts before this migration existed.
--
-- auth_can_admin_org short-circuits on auth_is_super_admin(), so one predicate
-- covers both. Anonymous callers match neither branch, so the storefront still
-- cannot see a suspended organization.
drop policy if exists orgs_read_active on organizations;
create policy orgs_read_active on organizations
  for select using (is_active or auth_can_admin_org(id));

-- ---------------------------------------------------------------------------
-- 2. A suspended org's events leave the storefront
-- ---------------------------------------------------------------------------
-- `events_read_published` was `status <> 'draft'` and never looked at the org,
-- so suspending an organization left its whole catalog on sale. Hiding the org
-- row alone does nothing here: events are read by their own policy.
--
-- `events_read_org_admin` (auth_can_admin_org(org_id)) is a separate permissive
-- policy and is untouched — policies are OR'd, so org staff keep full sight of
-- their own events while suspended.
drop policy if exists events_read_published on events;
create policy events_read_published on events
  for select using (
    status <> 'draft'::event_status
    and exists (
      select 1 from organizations o
       where o.id = events.org_id and o.is_active
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Deleting an organization
-- ---------------------------------------------------------------------------
-- WHY THIS IS A FUNCTION AND NOT `delete from organizations`:
--
-- registrations.category_id -> categories is ON DELETE NO ACTION, while
-- registrations AND categories both cascade from organizations. Postgres does
-- not promise it reaches the registrations before the categories, so a plain
-- delete can abort with a foreign-key violation on any org that has both — it
-- works on an empty test org and fails on a real one.
--
-- The order below is explicit, and the whole thing is one transaction.
create or replace function delete_organization_tx(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_blocking int;
  v_counts   jsonb;
begin
  if not exists (select 1 from organizations where id = p_org_id) then
    raise exception 'org_not_found' using errcode = 'P0002';
  end if;

  -- The money guard is re-checked HERE, not only in the Edge Function, so the
  -- invariant survives any future caller. `refunded` and `partially_refunded`
  -- block as hard as `paid`: a refund is still money that moved and still a
  -- PayMongo record that may have to be reconciled.
  select count(*) into v_blocking
    from payments
   where org_id = p_org_id
     and status in ('paid', 'refunded', 'partially_refunded');
  if v_blocking > 0 then
    raise exception 'org_has_payments: % settled payment(s)', v_blocking
      using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'events',            (select count(*) from events            where org_id = p_org_id),
    'categories',        (select count(*) from categories        where org_id = p_org_id),
    'registrations',     (select count(*) from registrations     where org_id = p_org_id),
    'payments',          (select count(*) from payments          where org_id = p_org_id),
    'checkins',          (select count(*) from checkins          where org_id = p_org_id),
    'members',           (select count(*) from user_roles        where org_id = p_org_id),
    'payout_statements', (select count(*) from payout_statements where org_id = p_org_id)
  ) into v_counts;

  -- Registrations first: this is the ordering the NO ACTION constraint needs.
  -- Cascades registration_addons, registration_audit, payments, checkins.
  delete from registrations where org_id = p_org_id;
  delete from categories    where org_id = p_org_id;
  -- Cascades events, addons, form_fields, payout_statements, user_roles.
  delete from organizations where id = p_org_id;

  return v_counts;
end;
$fn$;

-- 20260808120200 installs an event trigger that revokes EXECUTE on every newly
-- created function, so this grant is not optional — and a missing grant has
-- bitten this repo three times. service_role ONLY: the org-provision Edge
-- Function is the sole caller, and nothing reachable by a browser should be
-- able to erase an organization.
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
