-- Extracted so the dedupe in 20260809100100_one_registration_per_event.sql is
-- reusable and testable rather than a one-shot inline CTE. That migration
-- runs its dedupe exactly once, irreversibly, against whatever data exists
-- the moment it's applied -- on hosted, that means real 'paid' duplicates
-- (a genuine slots_taken adjustment) get cleaned up with no way to re-run
-- the exact same statement and see it happen again. Wrapping the logic in a
-- function gives two things that inline SQL in a migration can't: Task 10
-- can call this after the hosted push and confirm it returns 0 (proof the
-- one-time cleanup actually left no stragglers), and this repo's test suite
-- can call it directly against fixtures instead of only asserting on the
-- unique index's downstream behaviour.
--
-- Body is character-for-character the CTE from 20260809100100 (ranked /
-- losers / released), wrapped in a plpgsql function that returns how many
-- rows it expired. Idempotent by construction: with zero rows where
-- row_number() over (partition by event_id, user_id ...) > 1, `losers` is
-- empty, `released` updates nothing, the final update updates nothing, and
-- the function returns 0.
--
-- slots_taken is deliberately NOT adjusted for anything but 'paid' losers --
-- see 20260809100100's header and 20260806201000_admin_cancel_registration_rpc.sql
-- for why an unpaid registration never held a slot in the first place. This
-- function does not widen that exemption; it only relocates the SQL that
-- already implemented it.
--
-- service_role only: this bypasses the normal slots_taken ownership rule
-- (confirm_payment_tx / refund_registration_tx) the same way the inline
-- version did, and must not be reachable by anon or authenticated.
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
           row_number() over (partition by event_id, user_id order by created_at, id) as rn
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
  'Expires all but the earliest pending/paid registration per (event_id, user_id), '
  'releasing slots_taken for any paid loser. Idempotent -- returns 0 once no '
  'duplicates remain. service_role only.';

revoke all on function public.dedupe_live_registrations() from public;
grant execute on function public.dedupe_live_registrations() to service_role;
