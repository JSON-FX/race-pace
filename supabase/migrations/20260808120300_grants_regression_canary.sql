-- Permanent fixture function for the automated regression test guarding
-- 20260808120200_close_new_function_public_execute_gap.sql (Finding 1: PUBLIC gets EXECUTE on
-- new functions by Postgres's built-in default, and that survives a plain
-- `ALTER DEFAULT PRIVILEGES ... REVOKE ... FROM PUBLIC`, so an event trigger is what actually
-- has to close it — see that migration for the full account).
--
-- An earlier version of this test created its own throwaway function per test run, via a
-- `security definer` helper (`_test_create_probe_function`) called over the REST API as
-- service_role, so the (PostgREST-only) test harness could exercise DDL it otherwise has no way
-- to issue. That does not work as a regression guard: reproduced directly against this project
-- that a `CREATE FUNCTION` executed via `EXECUTE format(...)` inside a function invoked THROUGH
-- POSTGREST's pooled connection does not reliably fire `ddl_command_end` event triggers, even
-- though the exact same dynamic SQL invoked directly (the same connection class migrations use)
-- does — confirmed by instrumenting the event trigger to log every firing and comparing: zero
-- log rows for the PostgREST-routed case, one row every time for the direct case. The resulting
-- function ended up with PUBLIC still granted either way, so the test would have silently
-- proven nothing (or, worse, passed for the wrong reason) rather than actually guarding the
-- fix. Root cause not fully isolated (session_replication_role was 'origin' in both cases,
-- ruling out the obvious explanation), but the observed behavior was solid and reproducible
-- across multiple independent probes, so the approach was abandoned rather than a fix guessed
-- at. `_test_create_probe_function`/`_test_drop_probe_function` and the migrations that created
-- them were removed before ever being committed.
--
-- This function is created here — by a real migration, applied the same way (`supabase db
-- push`) every other function in this schema is — specifically so the regression test exercises
-- the actual production code path instead of a synthetic one. It deliberately carries no grant
-- statement of its own: the whole point is to prove the schema-wide defaults (this migration
-- included) are sufficient on their own, with nothing function-specific propping them up.
create or replace function public._grants_regression_canary()
returns void
language sql
security definer
set search_path = ''
as $$
  select 1
$$;
