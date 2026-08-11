-- Closes the PUBLIC half of Finding 1 (see 20260808120000's header for the full account of
-- what was tried first and why it didn't work). Short version: Postgres grants EXECUTE to
-- PUBLIC on every newly created function by built-in default, and — proven empirically against
-- three disposable scratch schemas on this project, Postgres 17.6 — `ALTER DEFAULT PRIVILEGES
-- ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` does not suppress that built-in default. The
-- `pg_default_acl` row it writes can look correct (no stored PUBLIC entry) while a function
-- created afterward gets one anyway. This is not a syntax mistake to fix with a different
-- ALTER DEFAULT PRIVILEGES incantation; ALTER DEFAULT PRIVILEGES has no mechanism that reaches
-- this specific built-in default for functions, full stop.
--
-- The standard working alternative for this exact, well-known Postgres limitation is an event
-- trigger that runs immediately after each `CREATE FUNCTION`/`CREATE PROCEDURE` in `public` and
-- explicitly revokes PUBLIC (and, redundantly with 20260808120000's default-privileges
-- statement but harmless to restate, anon/authenticated) from the object that command just
-- created. `ddl_command_end` fires once the object already exists, so this closes the window by
-- revoking immediately rather than by preventing the grant from happening — but that window
-- never has an external observer: the revoke runs synchronously as part of executing the same
-- CREATE FUNCTION command, before it returns control to whatever session issued it, so no other
-- session can ever see the function in its momentarily-PUBLIC-executable state.
--
-- Verified this actually works (not just "should", per the lesson of Finding 1 above) against a
-- disposable scratch schema before applying it here: created this exact trigger function +
-- event trigger scoped to that schema, created a plain new function afterward, and confirmed
-- `has_function_privilege('anon', ..., 'EXECUTE')`, `('authenticated', ...)`, and
-- `('service_role', ...)` all returned `false` — only the owner (`postgres`) retained EXECUTE.
-- Also verified directly against `public` itself the same way (a plain `create function`, no
-- grants, immediately checked with `has_function_privilege`): anon/authenticated correctly
-- denied, service_role correctly still allowed (via the separate named-default-privilege
-- mechanism 20260808110000/120000 maintain, untouched by this trigger).
-- `supabase/tests/function-grants.test.ts`'s "brand-new function... anon-unreachable by
-- default" test checks this against `_grants_regression_canary`, a permanent fixture function
-- added by 20260808120300 for exactly this purpose (see that migration for why: an earlier
-- version of this test tried creating its own throwaway function per-run via a service_role RPC
-- call routed through PostgREST, and that path does NOT reliably fire this event trigger —
-- reproduced and root-caused before abandoning it, documented there).
--
-- Scoped to `schema_name = 'public'` only — this project's application functions all live
-- there; auth/storage/extension schemas are Supabase-managed and out of scope.
--
-- Operational consequence, stated plainly and now actually true: every function created (or
-- REPLACED — `CREATE OR REPLACE FUNCTION` carries the same `CREATE FUNCTION` command tag, so
-- this fires on it too, resetting the replaced function's grants to owner-only same as a fresh
-- create) in `public` from now on needs its own explicit `grant execute on function ... to
-- authenticated` / `to service_role` in the SAME migration, every time, including migrations
-- that only change a function's body via CREATE OR REPLACE. Several existing migrations in this
-- repo (20260806203000 among them) redefine a function's body without repeating its grants,
-- relying on the original creating migration's grants having survived the replace — that
-- assumption no longer holds for anything created after this migration runs. This is a wider,
-- more consequential behavior change than 20260808110000/120000 alone and is called out
-- explicitly rather than left to be discovered as a silent 42501 in a future migration.
create or replace function public._revoke_execute_on_new_function()
returns event_trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  obj record;
begin
  for obj in select * from pg_event_trigger_ddl_commands()
  loop
    if obj.object_type in ('function', 'procedure') and obj.schema_name = 'public' then
      execute format(
        'revoke all on function %s from public, anon, authenticated',
        obj.object_identity
      );
    end if;
  end loop;
end;
$$;

drop event trigger if exists revoke_execute_on_new_public_function;
create event trigger revoke_execute_on_new_public_function
  on ddl_command_end
  when tag in ('CREATE FUNCTION', 'CREATE PROCEDURE')
  execute function public._revoke_execute_on_new_function();
