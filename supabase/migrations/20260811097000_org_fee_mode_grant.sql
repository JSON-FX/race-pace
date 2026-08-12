-- Task 13 needs a super admin to change organizations.fee_mode from the
-- Commission console. Two things were in the way, and only the first was
-- expected.
--
-- (§3 below was revised after review, IN PLACE rather than as a follow-up
-- migration. That is only safe because this version has never been applied
-- anywhere but a local stack that `db reset` replays from scratch — `db push`
-- skips a version it has already recorded regardless of content, so editing a
-- file that HAS reached hosted silently diverges from what is live. See
-- 20260808120000's header for the incident that established the rule.)
--
-- ---------------------------------------------------------------------------
-- 1. THE MISSING COLUMN GRANT
-- ---------------------------------------------------------------------------
-- CHECKED BEFORE WRITING THIS, not assumed:
--
--   select has_column_privilege('authenticated','public.organizations','fee_mode','UPDATE');
--   -- f
--
-- while `name` (20260806180000) and the five terms columns (20260807090600)
-- both come back `t`. `fee_mode` was added by 20260811090000_processor_fee_
-- columns.sql, which added the column and nothing else — and organizations'
-- UPDATE grant has been column-scoped since 20260724140000_scope_org_update_
-- grant.sql revoked the table-level one. A new column on this table is
-- un-writable by `authenticated` until it is named here. That has now bitten
-- this repo three times: the branding editor, the rename, and the commercial
-- terms.
--
-- The failure this prevents is NOT the silent zero-rows one the terms migration
-- describes. A column with no grant is a hard error, reproduced locally:
--
--   set local role authenticated;
--   update public.organizations set fee_mode = 'pass_on' where id = ...;
--   -- ERROR: permission denied for table organizations
--
-- so the fee-mode control would have failed loudly on every attempt rather than
-- quietly. Either way it would not have worked. `.select("id")` in the server
-- action distinguishes the two cases for whoever reads the logs.
--
-- Scoped to the one column deliberately. `grant update on organizations` would
-- hand `authenticated` every column on the table including `is_active` and
-- `slug` — the table-level drift 20260724140000 exists to undo.
grant update (fee_mode) on organizations to authenticated;

-- ---------------------------------------------------------------------------
-- 2. THE POLICY THAT MAKES THAT GRANT MEAN MORE THAN IT LOOKS LIKE
-- ---------------------------------------------------------------------------
-- `organizations_super_admin_terms` (20260807090600) is
-- `for update using (auth_is_super_admin()) with check (auth_is_super_admin())`,
-- so it permits the write this task needs. But it is not the only UPDATE policy
-- on the table, and Postgres ORs permissive policies together:
--
--   organizations_update_branding_org_admin | w | auth_can_admin_org(id)
--   organizations_super_admin_terms         | w | auth_is_super_admin()
--
-- The branding policy is COLUMN-AGNOSTIC. RLS in Postgres cannot be scoped to a
-- column, so the only thing separating "an org admin may repoint their logo"
-- from "an org admin may rewrite their own commercial terms" is which columns
-- appear in the GRANT. Adding fee_mode to that grant would therefore also hand
-- every org admin the ability to flip their OWN organization to `pass_on` —
-- surcharging their runners and taking the full sticker price themselves —
-- straight through PostgREST, with no console involved.
--
-- That is not hypothetical. Verified against the local stack, signed in as the
-- seeded org admin muspo@racepace.test on the anon key:
--
--   update organizations set commission_rate = 0.0001 where id = <own org>
--   -- 200 OK, {"commission_rate": 0.0001}
--
-- i.e. the five commercial-terms columns granted in 20260807090600 are ALREADY
-- writable by any org admin for their own org, which contradicts that
-- migration's own header ("Super admins set commercial terms") and
-- lib/actions/commission.ts's ("Commercial terms are a PLATFORM capability, not
-- an org one"). That pre-existing hole is deliberately NOT fixed here — the
-- repair is to narrow `organizations_update_branding_org_admin`, which sits on
-- the branding and rename paths and belongs in its own change with its own
-- tests. It is reported rather than widened.
--
-- What IS in scope is not making it worse. A BEFORE UPDATE trigger is the only
-- mechanism that can express "this one column, only for this one caller", since
-- a policy cannot see the column list and cannot compare OLD to NEW.
--
-- ---------------------------------------------------------------------------
-- 3. WHY THE EXEMPTION IS BY ROLE AND NOT BY `auth.uid() is null`
-- ---------------------------------------------------------------------------
-- The obvious way to let migrations and the service key through is
-- `auth.uid() is null` — auth.uid() reads `request.jwt.claims->>'sub'`, which is
-- absent for both. It is also FAIL-OPEN, and fail-open is the exact failure mode
-- this file exists to prevent: the guard would be silently disabled for ANY
-- caller reaching Postgres without a `sub`, including a signed `authenticated`
-- token that simply has no `sub` claim, and including any future server path
-- that writes with the service key without forwarding the end user's JWT.
--
-- So the exemption is stated in terms of WHO IS CONNECTED rather than what a
-- claim happens to say. `rolbypassrls or rolsuper` is exactly the set of roles
-- that already ignore row-level security, i.e. the ones for which this guard was
-- never going to be the boundary anyway:
--
--   rolname       | rolsuper | rolbypassrls     reachable how
--   --------------+----------+-------------     -------------------------------
--   postgres      | f        | t                migrations, seed.sql, db reset
--   supabase_admin| t        | t                platform internals, restores
--   service_role  | f        | t                the service key
--   authenticator | f        | f                PostgREST's login role
--   authenticated | f        | f                every signed-in user  <- guarded
--   anon          | f        | f                (no UPDATE grant at all)
--
-- `authenticated` does not bypass RLS, so it can NEVER reach the exemption —
-- with a `sub`, without one, or with a forged-but-unsigned one. It always falls
-- through to auth_is_super_admin(). Pinned by processor-fee-ledger.test.ts,
-- which mints an `authenticated` JWT carrying NO `sub` and asserts it is still
-- refused, and which reads rolbypassrls straight out of pg_roles.
--
-- IF YOU ARE ADDING A SERVER PATH THAT WRITES organizations WITH THE SERVICE
-- KEY: it will bypass this guard, by design and by role. That is fine for a
-- trusted backend job and is not fine for anything that takes a fee_mode value
-- from a request. Route user-driven writes through an authenticated session so
-- the guard applies.
--
-- SECURITY INVOKER, not definer — and here that is load-bearing rather than
-- hygiene. `current_user` under a definer function is the OWNER (postgres),
-- which bypasses RLS, so a definer version of this function would exempt
-- everybody. Invoker is also all it needs: it takes no input, reads no table of
-- its own, and auth_is_super_admin() is already security definer.
create or replace function public.organizations_guard_fee_mode()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A save that merely mentions an unchanged fee_mode is not a change. Checked
  -- first so the common branding/rename write costs nothing.
  if new.fee_mode is not distinct from old.fee_mode then
    return new;
  end if;
  if public.auth_is_super_admin() then
    return new;
  end if;
  if exists (
    select 1 from pg_catalog.pg_roles r
     where r.rolname = current_user
       and (r.rolbypassrls or r.rolsuper)
  ) then
    return new;
  end if;
  raise exception 'fee_mode is a platform term: only a super admin may change it'
    using errcode = '42501';
end;
$$;

-- No `grant execute` on purpose, and none is needed: Postgres checks EXECUTE on
-- a trigger function when the TRIGGER is created (here, as the owner), not on
-- every fire — verified against this trigger with `authenticated` holding no
-- EXECUTE on it. Leaving it owner-only also keeps it clean under
-- `_function_grant_audit` / function-grants.test.ts. The event trigger from
-- 20260808120200 revokes PUBLIC/anon/authenticated on creation anyway; this
-- comment records that that outcome is intended, not tolerated.
revoke all on function public.organizations_guard_fee_mode() from public, anon, authenticated;

drop trigger if exists organizations_fee_mode_super_admin_only on organizations;
-- `before update of fee_mode` narrows the fire to statements that MENTION the
-- column; `is distinct from` inside narrows it again to ones that actually move
-- it. A branding save that happens to include an unchanged fee_mode is not an
-- error, and must not become one.
create trigger organizations_fee_mode_super_admin_only
  before update of fee_mode on organizations
  for each row execute function public.organizations_guard_fee_mode();
