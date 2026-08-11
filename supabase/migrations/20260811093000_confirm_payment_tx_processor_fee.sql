-- confirm_payment_tx records the processor's cut. Design 2026-08-11 §4.1.
--
-- Body pasted verbatim from pg_get_functiondef against the linked project, NOT
-- from any migration file — the same procedure and for the same reason as
-- 20260808140000_money_txn_audit.sql. This function has been rewritten four
-- times; only the live definition is authoritative. (Cross-checked: the dump is
-- character-identical to 20260809100300_confirm_payment_tx_expired.sql, which is
-- the most recent of the four — so nothing had drifted on hosted.)
--
-- The ONLY edits: three new parameters, and three assignments added to the
-- EXISTING `update public.payments`. No new statement, no changed logic. The
-- `for update` row lock, the expired/conflict branch and its unique_violation
-- backstop, the registrations update, the slots_taken increment and the
-- registration_audit insert are all untouched.
--
-- Adding parameters with DEFAULTs creates an OVERLOAD, and Postgres resolves an
-- exact 6-arg call to the OLD function every time — so the new logic would never
-- run for any existing caller. The same trap 20260807090400_refund_policy_tx.sql
-- documented. Drop the old one; the defaults preserve its behaviour for any
-- 6-arg call site not yet updated.
drop function if exists public.confirm_payment_tx(uuid, text, int, int, text, jsonb);

create or replace function public.confirm_payment_tx(
  p_registration_id         uuid,
  p_method                  text,
  p_fee                     integer,
  p_net                     integer,
  p_token                   text,
  p_raw                     jsonb,
  p_processor_fee           integer default 0,
  p_processor_fee_predicted integer default null,
  p_processor_fee_source    text    default 'none'
) returns text
language plpgsql
security definer
set search_path = ''
as $function$
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
           net_to_org = p_net, raw = p_raw,
           processor_fee_cents           = coalesce(p_processor_fee, 0),
           processor_fee_predicted_cents = p_processor_fee_predicted,
           processor_fee_source          = coalesce(p_processor_fee_source, 'none')
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
$function$;

revoke all on function public.confirm_payment_tx(uuid, text, integer, integer, text, jsonb, integer, integer, text) from public;
grant execute on function public.confirm_payment_tx(uuid, text, integer, integer, text, jsonb, integer, integer, text) to service_role;

-- Belt-and-braces, matching 20260809100300's posture on this same function. A
-- freshly created function has no direct grants to these roles, so this is a
-- no-op — asserted anyway, because this function is the one this repo's single
-- proven exploit (20260808110000's header) targeted directly, and `revoke ...
-- from public` alone has already been shown here not to be the whole story.
revoke execute on function public.confirm_payment_tx(uuid, text, integer, integer, text, jsonb, integer, integer, text)
  from anon, authenticated;
