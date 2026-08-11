-- Fixes a critical bug in public.dedupe_live_registrations()
-- (20260809100050_dedupe_live_registrations_fn.sql): its winner-selection
-- ordered candidates by `created_at, id` alone, ignoring status. The
-- realistic way a duplicate forms is a first checkout going 'pending' and
-- being abandoned, then a later attempt actually completing payment -- in
-- that order the abandoned 'pending' row is EARLIER and used to survive,
-- while the 'paid' row -- the one the runner actually completed -- ranked
-- second, got expired, and had its slot released. A runner who genuinely
-- paid was left with a dead pending stub and no live registration, and
-- capacity that was legitimately consumed was handed back to the category.
--
-- Ruled: PAID ALWAYS WINS, THEN EARLIEST. `(status = 'paid') desc` sorts
-- true before false, so any paid row outranks any pending row for the same
-- (event_id, user_id) regardless of timestamps; `created_at, id` remains the
-- tiebreak within a status (paid-vs-paid or pending-vs-pending duplicates,
-- which the index should make impossible going forward, but the function
-- still needs a deterministic order for them).
--
-- Not editing 20260809100050 in place: it has already been applied on this
-- machine (and may already be applied wherever else this branch has been
-- pulled), so changing its body would make a fresh `db reset` disagree with
-- an environment that ran the incremental `db push` sequence up through
-- 100050 before this fix existed. `create or replace function` in a new,
-- later migration is the safe way to change an existing function's
-- behaviour post-hoc.
--
-- 20260809100100_one_registration_per_event.sql only ever called this
-- function (select public.dedupe_live_registrations();) -- no separate
-- inline copy of the CTE exists to drift out of sync with this fix.
create or replace function public.dedupe_live_registrations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired_count integer;
begin
  with ranked as (
    select id, category_id, status,
           row_number() over (
             partition by event_id, user_id
             order by (status = 'paid') desc, created_at, id
           ) as rn
      from public.registrations
     where status in ('pending', 'paid')
  ),
  losers as (
    select id, category_id, status from ranked where rn > 1
  ),
  released as (
    update public.categories c
       set slots_taken = greatest(c.slots_taken - sub.n, 0)
      from (select category_id, count(*) as n from losers where status = 'paid' group by category_id) sub
     where c.id = sub.category_id
    returning c.id
  ),
  expired as (
    update public.registrations r
       set status = 'expired', expires_at = null
      from losers l
     where r.id = l.id
    returning r.id
  )
  select count(*) into v_expired_count from expired;

  return v_expired_count;
end;
$$;

comment on function public.dedupe_live_registrations() is
  'Expires all but the winning pending/paid registration per (event_id, user_id) -- '
  'paid always wins over pending regardless of timestamps, earliest created_at/id '
  'is the tiebreak within a status -- releasing slots_taken for any paid loser. '
  'Idempotent -- returns 0 once no duplicates remain. service_role only.';
