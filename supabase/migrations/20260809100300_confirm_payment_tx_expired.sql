-- A PayMongo capture that lands AFTER the sweep expired its registration.
--
-- The 24-hour hold is longer than a PayMongo hosted checkout session lives, so
-- this is close to unreachable -- but "close to unreachable" is not a reason to
-- silently swallow captured money. Before this change confirm_payment_tx
-- returned 'not_pending' for an expired row, which meant PayMongo had the
-- runner's money and the platform had no registration, no ticket, and no
-- refund record.
--
-- Two outcomes, decided by whether the runner has since moved on:
--   * no other live entry  -> resurrect the expired row to 'paid'. The runner
--     paid for this event and now holds exactly one entry. Correct outcome.
--   * a live entry exists  -> 'conflict'. Confirming would violate
--     registrations_one_live_per_event and give one runner two slots. The
--     webhook logs it for manual refund rather than failing on a raw 23505.
--
-- Fix round 1: the v_live pre-check above is NOT a lock -- it is a plain
-- unlocked select. Two webhooks landing concurrently for two different
-- expired registrations of the same runner+event can both read v_live = 0
-- (neither has committed yet, so neither is visible to the other) and both
-- proceed to write 'paid'. registrations_one_live_per_event still prevents
-- an actual double-booking -- the second writer blocks on the first
-- writer's uncommitted index entry, then raises unique_violation once the
-- first commits -- but without a handler that violation used to escape the
-- function entirely as a raw, uncaught 23505, which confirm.ts's generic
-- error branch turns into a 500 ("confirm_write_failed"). That defeats the
-- whole point of returning 'conflict': the guaranteed-graceful outcome
-- would only be reached via PayMongo's retry, not on this call. The
-- pre-check stays (it is still the fast, common-case path, and avoids the
-- write + lock-wait entirely for the ordinary case); the exception handler
-- below is the backstop for the race the pre-check cannot see. It is scoped
-- to the registrations_one_live_per_event constraint by name specifically
-- so a unique_violation from some unrelated constraint still surfaces as a
-- hard error instead of being silently reported as 'conflict'.
--
-- Everything else is unchanged from 20260723100000_money_txn_rpcs.sql:
-- 'paid' is still 'already' (replay-safe), refunded/cancelled still
-- 'not_pending' (never re-confirm).
--
-- Merge note: 20260808140000_money_txn_audit.sql (main) landed on hosted
-- before this branch merged, and independently redefined this same function
-- to insert a `registration_audit` row on the success path (org_id/event_id/
-- total_amount added to the initial select for exactly that insert). Function
-- bodies have no equivalent of a view's "cannot drop columns" guard — a bare
-- `create or replace function` here would have silently discarded that audit
-- insert the moment this migration finally applies. This version carries
-- BOTH: the audit insert happens once, on the one success path shared by an
-- ordinary pending confirm and an expired-resurrect confirm, in the same
-- place main put it (after slots_taken, before `return 'paid'`) — so a
-- resurrect is audited exactly like any other payment, which is the correct
-- behaviour for an audit trail, not a gap being merged over.
create or replace function public.confirm_payment_tx(
  p_registration_id uuid, p_method text, p_fee int, p_net int, p_token text, p_raw jsonb
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.registration_status;
  v_category uuid;
  v_org uuid;
  v_event uuid;
  v_user uuid;
  v_amount int;
  v_live integer;
  v_constraint text;
begin
  select status, category_id, org_id, event_id, user_id, total_amount
    into v_status, v_category, v_org, v_event, v_user, v_amount
    from public.registrations where id = p_registration_id for update;
  if not found then return 'not_found'; end if;
  if v_status = 'paid' then return 'already'; end if;

  if v_status = 'expired' then
    select count(*) into v_live
      from public.registrations
     where event_id = v_event
       and user_id = v_user
       and id <> p_registration_id
       and status in ('pending', 'paid');
    if v_live > 0 then
      return 'conflict';
    end if;
  elsif v_status <> 'pending' then
    return 'not_pending';  -- refunded/cancelled: never re-confirm (replay-safe)
  end if;

  begin
    update public.payments
       set status = 'paid', method = p_method, platform_fee = p_fee,
           net_to_org = p_net, raw = p_raw
     where registration_id = p_registration_id;

    update public.registrations
       set status = 'paid', ticket_token = p_token, expires_at = null
     where id = p_registration_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'registrations_one_live_per_event' then
      return 'conflict';
    end if;
    raise;  -- some other constraint: a real bug, must not be swallowed
  end;

  update public.categories set slots_taken = slots_taken + 1 where id = v_category;

  insert into public.registration_audit
    (registration_id, org_id, event_id, action, detail, actor_role)
  values (p_registration_id, v_org, v_event, 'paid',
          jsonb_build_object('method', p_method, 'amount', v_amount), 'system');

  return 'paid';
end;
$$;

revoke all on function public.confirm_payment_tx(uuid, text, int, int, text, jsonb) from public;
grant execute on function public.confirm_payment_tx(uuid, text, int, int, text, jsonb) to service_role;

-- Belt-and-braces re-assertion, matching 20260808140000_money_txn_audit.sql's
-- own posture on this exact function: `create or replace` preserves existing
-- privileges (this function was hardened service_role-only by
-- 20260808110000_lock_down_function_grants.sql, already live on hosted), so
-- this should be a no-op — asserted explicitly anyway, on the function this
-- repo's one proven exploit (20260808110000's header) targeted directly.
revoke execute on function public.confirm_payment_tx(uuid, text, int, int, text, jsonb)
  from anon, authenticated;
