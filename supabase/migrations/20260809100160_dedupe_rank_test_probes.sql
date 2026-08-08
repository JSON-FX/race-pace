-- Test-support only. Neither function is called by any application code path.
--
-- The critical bug fixed in 20260809100150_dedupe_paid_wins_tiebreak.sql
-- (winner-selection ignoring status, expiring a genuinely paid registration
-- in favour of an abandoned pending one) lives entirely inside a
-- `row_number() over (partition by event_id, user_id order by ...)` clause
-- that only ever runs against real rows in public.registrations. The table's
-- own partial unique index (registrations_one_live_per_event) makes it
-- impossible -- for any client, including service_role, via any sequence of
-- inserts/updates -- to ever have two 'pending'/'paid' rows for the same
-- (event_id, user_id) coexist, even transiently within one statement:
-- Postgres checks a non-deferred unique index immediately per row, not at
-- statement or transaction end. Verified directly: both a single multi-row
-- UPDATE and two sequential single-row UPDATEs flipping two 'cancelled' rows
-- to 'paid' for the same (event_id, user_id) 23505 on the second row. So
-- `public.dedupe_live_registrations()` itself cannot be exercised end-to-end
-- against a real duplicate without dropping or disabling the index (DDL this
-- repo has no `pg`/raw-Postgres dependency to run, and none was added).
--
-- These two functions are how the fix gets REAL test coverage anyway,
-- without touching the index or the table's live-row invariant:
--
-- 1. _dedupe_rank_probe(id_a, id_b) runs the CURRENTLY DEPLOYED ordering
--    clause -- `(status = 'paid') desc, created_at, id` -- against two real
--    registration rows the test controls. Because it neither filters on
--    `status in ('pending','paid')` nor partitions by (event_id, user_id),
--    the two rows can belong to two DIFFERENT events (so the unique index
--    never sees them as a conflict) while still carrying their real,
--    genuine 'pending'/'paid' status values -- no synthetic data, no JSON
--    literals standing in for a status. This proves the ordering rule
--    behaves correctly (paid always outranks pending, regardless of which
--    was created first) against the exact expression string currently
--    inside dedupe_live_registrations().
--
-- 2. _dedupe_source_contains(needle) confirms the ACTUAL DEPLOYED
--    dedupe_live_registrations() function's source contains a given
--    substring, via pg_get_functiondef. This is the piece that makes the
--    coverage regression-proof: _dedupe_rank_probe's ORDER BY clause is a
--    hand-kept copy (see the header of that function below), so on its own
--    it would NOT fail if someone reverted dedupe_live_registrations()'s
--    ORDER BY back to `created_at, id` without touching this file. Asserting
--    the real function's source still contains `(status = 'paid') desc`
--    closes that gap: THAT assertion fails the moment the real ORDER BY
--    regresses, independent of whether anyone remembers to update the probe.
--
-- service_role only, both read-only (stable, no writes to any table).
create or replace function public._dedupe_rank_probe(id_a uuid, id_b uuid)
returns table (id uuid, rn bigint)
language sql
stable
security definer
set search_path = ''
as $$
  -- Keep this ORDER BY clause identical to the one inside
  -- dedupe_live_registrations()'s `ranked` CTE
  -- (20260809100150_dedupe_paid_wins_tiebreak.sql). It is a hand-kept copy,
  -- not a shared reference -- see _dedupe_source_contains below for the
  -- assertion that actually guards against this copy drifting out of sync
  -- unnoticed.
  select id, row_number() over (order by (status = 'paid') desc, created_at, id) as rn
    from public.registrations
   where id in (id_a, id_b)
$$;

revoke all on function public._dedupe_rank_probe(uuid, uuid) from public;
grant execute on function public._dedupe_rank_probe(uuid, uuid) to service_role;

create or replace function public._dedupe_source_contains(needle text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select pg_get_functiondef(p.oid) like ('%' || needle || '%')
       from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'dedupe_live_registrations'
      limit 1),
    false
  )
$$;

revoke all on function public._dedupe_source_contains(text) from public;
grant execute on function public._dedupe_source_contains(text) to service_role;
