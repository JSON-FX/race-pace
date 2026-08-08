-- Supersedes 20260808120200_close_new_function_public_execute_gap.sql. Do not edit that
-- (already-applied) migration in place — this one reverses it instead.
--
-- The event trigger it installed (`revoke_execute_on_new_public_function`, firing on
-- `ddl_command_end` for `CREATE FUNCTION`/`CREATE PROCEDURE`) was meant to close the gap where
-- Postgres grants EXECUTE to PUBLIC on every newly created function by built-in default. It
-- worked for that. It also fired on every `CREATE OR REPLACE FUNCTION` — Postgres reports the
-- identical `CREATE FUNCTION` command tag for a replace as for a fresh create, and the trigger
-- had no way to distinguish them — which strips grants from an EXISTING function every time its
-- body is redefined, not just at creation. Reproduced: grant `authenticated` on a function,
-- `create or replace` it with no grant statement, and `authenticated` is silently gone
-- afterward. `service_role` only survived because it was never in the trigger's revoke list.
--
-- This repo already has migrations that redefine a function's body via CREATE OR REPLACE
-- without repeating its grants, relying on the original creating migration's grants having
-- survived the replace (20260806203000 is one). With the trigger installed, the next migration
-- that redefines `checkin_events`, `admin_cancel_registration`, one of the payout functions, or
-- any other client-called RPC in `public` the same way would silently strip `authenticated` from
-- it — an admin-console feature breaking with a runtime 42501, with nothing in that migration's
-- diff to explain why. Runtime DDL that can silently revoke a production grant is a worse risk
-- than the gap it closed. Dropped.
--
-- The canary function (20260808120300) existed only to give the trigger's regression test
-- something to check against; it has no purpose without the trigger and goes with it.
--
-- Replacement: no schema-level enforcement, just a test. `supabase/tests/function-grants.test.ts`
-- now enumerates every SECURITY DEFINER function in `public` via the audit helper below and
-- asserts none of them are anon-executable, and that only an explicit, test-file-level allowlist
-- is authenticated-executable. A migration that reintroduces this class of bug fails that test
-- instead of silently breaking a running app — the same protection, caught in CI/local test runs
-- instead of enforced (and capable of misfiring) at DDL time in production.
drop event trigger if exists revoke_execute_on_new_public_function;
drop function if exists public._revoke_execute_on_new_function();
drop function if exists public._grants_regression_canary();

-- supabase-js has no way to run arbitrary SQL (see test/env.ts — anon key + service key over
-- PostgREST only), so the test needs an RPC to read pg_proc/has_function_privilege itself.
-- service_role only: this reveals the full list of security-definer function names in `public`
-- and their exact anon/authenticated reachability, which is exactly the kind of schema detail
-- that shouldn't be anon- or authenticated-readable.
create or replace function public._function_grant_audit()
returns table (fn_name text, anon_exec boolean, auth_exec boolean)
language sql
security definer
set search_path = ''
as $$
  select p.proname::text,
         pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
         pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
$$;

revoke all on function public._function_grant_audit() from public, anon, authenticated;
grant execute on function public._function_grant_audit() to service_role;
