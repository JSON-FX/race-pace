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
-- Everything else is unchanged from 20260723100000_money_txn_rpcs.sql:
-- 'paid' is still 'already' (replay-safe), refunded/cancelled still
-- 'not_pending' (never re-confirm).
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
  v_event uuid;
  v_user uuid;
  v_live integer;
begin
  select status, category_id, event_id, user_id
    into v_status, v_category, v_event, v_user
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

  update public.payments
     set status = 'paid', method = p_method, platform_fee = p_fee,
         net_to_org = p_net, raw = p_raw
   where registration_id = p_registration_id;

  update public.registrations
     set status = 'paid', ticket_token = p_token, expires_at = null
   where id = p_registration_id;

  update public.categories set slots_taken = slots_taken + 1 where id = v_category;

  return 'paid';
end;
$$;

revoke all on function public.confirm_payment_tx(uuid, text, int, int, text, jsonb) from public;
grant execute on function public.confirm_payment_tx(uuid, text, int, int, text, jsonb) to service_role;
