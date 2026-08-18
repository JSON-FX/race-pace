-- supabase/migrations/20260818120000_org_management.sql
--
-- Organization management: suspend and delete, from the platform console.
--
-- Three changes, each with an incident behind it. See
-- docs/specs/2026-08-18-org-management-design.md.
--
-- AMENDED IN PLACE 2026-08-18 (review round 1, then the final whole-branch
-- review), which is allowed only because this migration has only ever run
-- through a local `db reset` and has never been pushed to the hosted project —
-- still true as of the final review. See task-2-report.md and
-- .superpowers/sdd/org-management/final-fix-report.md for the reviews that
-- produced these changes. Do not treat this header as license to edit any
-- OTHER migration in place — the rest of this repo's migrations have run
-- against the hosted project and a follow-up migration is required instead.

-- ---------------------------------------------------------------------------
-- 0. Two RLS predicates: "what does this caller hold an entry for?"
-- ---------------------------------------------------------------------------
-- Sections 1 and 2 below both need to ask whether the CALLER has a
-- registration in a given org / for a given event. The obvious way to write
-- that inside a policy is a plain subselect on public.registrations. It does
-- not work, and the failure is a hard one, not a subtlety:
--
--   permission denied for table registrations (42501)
--
-- ...for every ANONYMOUS storefront read of `events` and `organizations`.
-- An RLS policy expression is evaluated as the querying role, and the
-- executor checks table permissions for every relation in the plan at
-- executor startup — before any short-circuit, and whether or not the
-- subplan is ever run. `anon` holds SELECT on `user_roles` (which is why the
-- existing hoisted branch in section 1 works) but deliberately holds none on
-- `registrations`. Granting one would put every runner's entries one policy
-- mistake away from the public internet, to serve a predicate that only ever
-- needs to answer about the caller's own rows.
--
-- So these go through SECURITY DEFINER instead — the same mechanism, and the
-- same anon-executable exception, that auth_is_super_admin / auth_can_admin_org
-- / auth_can_check_in_event already are. supabase/tests/function-grants.test.ts
-- calls that exception out by name and its allowlist is edited alongside this
-- migration, deliberately, rather than being widened by default.
--
-- SET-RETURNING AND ARGUMENT-FREE, both on purpose. 20260808161720 measured a
-- policy predicate that takes a COLUMN going from 4.9ms to 1,220ms and into a
-- production statement timeout (57014), because a column argument defeats
-- STABLE and forces per-row re-evaluation. `id in (select
-- public.auth_registered_event_ids())` takes no argument and correlates with
-- nothing, so the planner hoists it into one hashed subplan per statement —
-- the same shape as that migration's `org_id in (select ...)` rewrite, just
-- with the table access moved behind a definer boundary. For an anonymous
-- caller auth.uid() is null and the set is empty, evaluated once.
-- registrations(user_id) has been indexed since 20260718183018.
create or replace function auth_registered_event_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.event_id from public.registrations r where r.user_id = auth.uid()
$fn$;

create or replace function auth_registered_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.org_id from public.registrations r where r.user_id = auth.uid()
$fn$;

-- Anon EXECUTE is a REQUIREMENT here, not an oversight: these are called from
-- inside SELECT policies on `events` and `organizations`, both of which the
-- anonymous storefront reads, and a policy evaluates as whatever role runs the
-- query. Revoking it would 42501 the whole storefront. The functions leak
-- nothing to anon in exchange — auth.uid() is null there, so they return the
-- empty set.
revoke all on function auth_registered_event_ids() from public;
revoke all on function auth_registered_org_ids() from public;
grant execute on function auth_registered_event_ids() to anon, authenticated, service_role;
grant execute on function auth_registered_org_ids()   to anon, authenticated, service_role;

-- Proof, not assumption. Inspecting pg_default_acl is not proof.
do $check$
declare
  fn text;
  who text;
begin
  foreach fn in array array['auth_registered_event_ids()', 'auth_registered_org_ids()'] loop
    foreach who in array array['anon', 'authenticated', 'service_role'] loop
      if not has_function_privilege(who, fn, 'EXECUTE') then
        raise exception '%: % EXECUTE grant missing — RLS on events/organizations will 42501', fn, who;
      end if;
    end loop;
  end loop;
end
$check$;

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
--
-- THE FOURTH BRANCH — a runner who holds a registration in this org — was
-- added in the final whole-branch review, and it is not a convenience. Spec
-- decision 3 promises "Existing paid entries, tickets ... keep working", and
-- the suspend dialog tells the operator "Paid entries stay valid". Without
-- this branch a suspended org's row is unreadable to its own paying runners,
-- and apps/site/lib/registration.ts's REG_SELECT carries `organizations(
-- fee_mode, commission_type, commission_rate, commission_flat_cents)` on the
-- same read as the registration. A null embed there falls to `mapReg`'s
-- `org?.fee_mode ?? 'absorb'` default, which shows a pass_on org's runner the
-- STICKER price on their own ticket instead of the grossed-up total they were
-- actually charged. That is a money figure being wrong on the page a runner
-- would take to a dispute, not a cosmetic gap.
--
-- Same hoisted shape as the branch above and for the same 20260808161720
-- reason: `id in (select public.auth_registered_org_ids())` is uncorrelated
-- and argument-free, so it becomes one hashed subplan per statement. A
-- correlated `exists (... where r.org_id = organizations.id ...)` would be
-- re-planned per row on a table every storefront page reads. Section 0
-- explains why the lookup lives behind a SECURITY DEFINER function rather
-- than being written inline. registrations.org_id is `not null`, so the set
-- never contains a null and needs no guard.
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
    or id in (select public.auth_registered_org_ids())
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

-- A RUNNER'S OWN TICKET SURVIVES THE SUSPENSION. Same finding as the fourth
-- branch of `orgs_read_active` above, on the table that actually blanks the
-- page: a runner holding a paid entry matches neither `events_read_published`
-- (the org is no longer active) nor `events_read_org_admin` (they are not org
-- staff), so REG_SELECT's `events(name, status, event_date, hero_image_url,
-- inclusions, ...)` embed came back null and /ticket/<id> rendered mapReg's
-- literal "Event" fallback with no hero image, no date and no inclusions.
--
-- A THIRD PERMISSIVE POLICY rather than a fourth OR-arm inside
-- `events_read_published`: policies are OR'd either way, and keeping this
-- separate leaves that policy's name true — it is about what is on sale, and
-- this is about what someone already bought. It also deliberately does NOT
-- re-check `status <> 'draft'` or the org's `is_active`: an entry cannot exist
-- for an event that was never published, and re-drafting or suspending after
-- the fact must not retroactively blank a ticket already paid for.
--
-- Hoisted, not correlated, per 20260808161720 — this policy is OR'd onto the
-- hottest anonymous query in the app. For an anonymous caller `auth.uid()` is
-- null, so the set comes back empty, once per statement, and the storefront is
-- unchanged. See section 0 for why the lookup is a SECURITY DEFINER function
-- and not an inline subselect on `registrations`.
drop policy if exists events_read_own_registration on events;
create policy events_read_own_registration on events
  for select using (id in (select public.auth_registered_event_ids()));

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

  -- TOCTOU guard, part 1: lock this org's registrations, THEN its payments —
  -- in that order, deliberately. `confirm_payment_tx` locks the registration
  -- row first (`select ... from registrations where id = p_registration_id
  -- for update`) and only touches the payment row afterward, via a plain
  -- `update payments`. An earlier version of this function locked payments
  -- first and registrations second, which is the opposite order, and two
  -- sessions taking locks in opposite orders is a textbook deadlock: with a
  -- settle and a delete running concurrently, each can end up holding the
  -- lock the other one wants. Reproduced on the local DB (`ERROR: deadlock
  -- detected`, 40P01) before this fix. Matching `confirm_payment_tx`'s order
  -- here makes that deadlock structurally impossible — whichever transaction
  -- reaches the registrations lock first simply makes the other one wait,
  -- never the other way around.
  --
  -- This also makes the FIRST guard count below (immediately after these
  -- locks) load-bearing rather than decorative: if a settle is already in
  -- flight when we arrive, we now block on ITS registrations lock until it
  -- commits, and that first count then sees the row it just marked 'paid' —
  -- converting what used to be a race into a clean `org_has_payments`
  -- refusal instead of a deadlock error surfacing to the caller. `raise
  -- exception` aborts the function immediately, so execution never reaches
  -- the SECOND guard count (further below) in this scenario — that one
  -- covers a different case entirely; see its own comment.
  perform 1 from public.registrations where org_id = p_org_id for update;
  perform 1 from public.payments      where org_id = p_org_id for update;

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
  -- deletes. This is NOT the check that catches a settle already in flight —
  -- that one is the FIRST count above, and `raise exception` aborts the
  -- function on the spot, so execution only reaches this second count when
  -- the first one found nothing. What THIS count catches instead: a
  -- registration + payment inserted, and settled to 'paid', by a transaction
  -- that started and committed entirely AFTER the `for update` locks above
  -- were taken — `for update` only locks rows that already existed at that
  -- moment, so a brand-new row is invisible to it and would otherwise sail
  -- past the first check unguarded.
  --
  -- Residual, deliberately not closed, and REACHABLE — not unreachable, which
  -- is what an earlier draft of this comment claimed. A payment settled
  -- entirely inside the window between this check and the commit of the
  -- deletes below still slips past both counts, because `for update` locks
  -- only rows that existed when it ran.
  --
  -- What the two Edge Function refusals actually cover, checked rather than
  -- assumed: `registrations-checkout` refuses to create a registration for a
  -- suspended org, and `payment-session` refuses to mint a checkout session
  -- for one (both `org_suspended`, 409). Neither is a general lock on this
  -- race, for two reasons:
  --
  --   1. The console's Delete item is UNCONDITIONAL — apps/web/app/(admin)/
  --      organizations/org-actions.tsx renders it for an active org just as
  --      readily as a suspended one. So the org reaching this function is not
  --      guaranteed to be suspended, and against an ACTIVE org both refusals
  --      are inert and checkout can create and settle an entry at any moment.
  --   2. Even for a suspended org they are narrowing, not closing. A PayMongo
  --      hosted session minted BEFORE the suspension stays valid for its own
  --      24 hours, and the settlement path — `payments-webhook` →
  --      `_shared/confirm.ts` → `confirm_payment_tx` — reads nothing about
  --      `is_active` (nor does `payment-verify`, which calls the same
  --      `confirmPayment`). PayMongo drives that callback, not the runner's
  --      browser, so no client-side refusal is in its way.
  --
  -- Closing it would need locking the `organizations` row itself against
  -- concurrent insert, which this function does not do. Left open because the
  -- exposure is bounded: an org with even one settled payment is refused
  -- outright by both counts above, so the only organizations that ever reach
  -- these deletes have no payment history at all, and the window is the few
  -- milliseconds between the second count and this transaction's commit. The
  -- outcome if it is ever hit is the same reconciliation problem as the
  -- second residual below — money moved at the processor with no surviving
  -- local record of it.
  --
  -- Second, separate residual, also deliberately not closed: a `pending`
  -- payment never blocks a delete (by design — see the test at
  -- org-management.test.ts:100-108), so an org can be deleted while a
  -- PayMongo webhook for one of its pending payments is still in flight. That
  -- webhook's `confirm_payment_tx` call then finds no matching registration,
  -- returns `not_found`, and touches nothing — the database stays consistent
  -- — but money may already have moved at the processor with no local record
  -- of it. Reconciling that is a PayMongo-dashboard/ops problem, not one this
  -- function can solve by blocking on `pending`, which would make every
  -- delete wait on arbitrary in-flight checkouts instead.
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
