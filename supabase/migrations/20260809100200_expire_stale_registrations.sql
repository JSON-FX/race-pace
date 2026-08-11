-- Reclaim unpaid entries so an abandoned checkout does not hold a runner's
-- one-per-event slot forever.
--
-- WHY THIS DOES NOT COPY admin_cancel_registration's payment guard:
-- registrations-checkout upserts a payments row with status 'pending' and a
-- live PayMongo checkout_url in the SAME request that creates the
-- registration, so very nearly every pending registration has a pending
-- payment. admin_cancel_registration returns 'payment_in_flight' in exactly
-- that situation (20260806201000, line ~97) because an admin cancelling by
-- hand could race a capture that is seconds away. A sweep that adopted the
-- same guard would never expire anything at all.
--
-- The 24-hour window is what makes it safe instead: a PayMongo hosted checkout
-- session itself expires at 24 hours, so a session that old cannot capture.
-- The residual risk is handled rather than assumed away -- see
-- 20260809100300_confirm_payment_tx_expired.sql, which lets a late capture
-- resurrect an expired registration instead of stranding the money.
--
-- slots_taken IS NOT TOUCHED HERE. A pending registration never held a slot:
-- slots_taken is incremented only in confirm_payment_tx and decremented only
-- in refund_registration_tx. See 20260806201000's header for the
-- manufactured-capacity bug that decrementing here would recreate.
create or replace function public.expire_stale_registrations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.registrations
       set status = 'expired', expires_at = null
     where status = 'pending'
       and expires_at is not null
       and expires_at <= now()
    returning id
  ),
  -- The checkout session behind an expired entry can no longer capture; say so
  -- explicitly rather than leaving a 'pending' payment that looks in-flight
  -- forever on the payments screen.
  failed as (
    update public.payments p
       set status = 'failed'
      from expired e
     where p.registration_id = e.id
       and p.status = 'pending'
    returning p.id
  )
  select count(*) into v_count from expired;

  return v_count;
end;
$$;

revoke all on function public.expire_stale_registrations() from public;
grant execute on function public.expire_stale_registrations() to service_role;

-- Closing registration early should not leave entries nominally alive until
-- their 24 hours happen to run out -- nobody can pay for a closed event.
create or replace function public.expire_pending_on_event_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.registrations
     set status = 'expired', expires_at = null
   where event_id = new.id
     and status = 'pending';

  update public.payments p
     set status = 'failed'
    from public.registrations r
   where p.registration_id = r.id
     and r.event_id = new.id
     and r.status = 'expired'
     and p.status = 'pending';

  return new;
end;
$$;

create trigger events_close_expires_pending
  after update of status on public.events
  for each row
  when (old.status is distinct from new.status
        and new.status in ('cancelled', 'closed', 'completed'))
  execute function public.expire_pending_on_event_close();

-- A `returns trigger` function can't actually be invoked directly by a client
-- ("trigger functions can only be called as triggers" — Postgres refuses),
-- so the residual PUBLIC/anon/authenticated grant this function gets by
-- default is inert, not exploitable. Revoked anyway, matching this repo's
-- established convention for the other trigger functions in this schema
-- (fn_notify_on_checkin, fn_notify_on_event_change, fn_notify_on_registration,
-- rls_auto_enable — see 20260808110000_lock_down_function_grants.sql's Group
-- D): leaving one of a matched set closed and the rest open is exactly how
-- this class of bug keeps regressing in this codebase, per that migration's
-- own header. This migration predates 20260808110000 in commit history but
-- not in applied order, so it never got the same treatment.
revoke all on function public.expire_pending_on_event_close() from public, anon, authenticated;

-- Belt and braces. The lazy check in registrations-checkout means correctness
-- does not depend on this running; the sweep exists so admin rosters and the
-- payments screen stop showing entries that are notionally dead.
select cron.schedule(
  'expire-stale-registrations',
  '*/15 * * * *',
  $$select public.expire_stale_registrations()$$
);
