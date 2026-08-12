-- The refund rule. Design 2026-08-11 §6.
--
-- THE RUNNER IS REFUNDED EXACTLY WHAT THE ORGANIZER WOULD HAVE BEEN PAID.
--
-- That is not a coincidence: both quantities are
-- `amount - platform_fee - processor_fee_cents`, so `refund == net_to_org`
-- holds by definition. It is what lets the existing clawback — which already
-- reads net_to_org off refunded rows — keep working with no change.
--
-- This SUPERSEDES 2026-08-06 §5, which returned the commission on a refund so
-- neither party kept anything. Race Pace's commission is now an earned service
-- fee, retained. PayMongo does not return its fee under any circumstances.
-- On a ₱2,000 GCash entry: the runner receives ₱1,910, Race Pace keeps ₱60,
-- PayMongo kept ₱30, and the organizer returns ₱1,910.
--
-- The 'retained amount is a smaller sale' rule goes with it: Race Pace has
-- already kept its full commission, so re-striking commission on the organizer's
-- retention would charge twice for one sale. p_retained_fee is therefore GONE
-- rather than defaulted — a caller still passing it is a caller that has not
-- been updated, and should fail loudly rather than silently double-charge.
--
-- BODY PROVENANCE. This is the LIVE body, dumped with
--   select pg_get_functiondef(p.oid) from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'refund_registration_tx';
-- (last written by 20260808140000_money_txn_audit.sql, amended by
-- 20260808150000_partial_refund_audit.sql), with five edits and nothing else:
--   1. p_retained_fee dropped from the signature.
--   2. v_amount (payments.amount) -> v_net (payments.net_to_org); the
--      partial/full decision is keyed on it.
--   3. the refund_exceeds_net_to_org guard added.
--   4. the partial branch's `amount` / `platform_fee` assignments and the
--      'original_amount' raw key removed.
--   5. everything else — the full branch's payments UPDATE, the slots_taken
--      decrement, and BOTH registration_audit inserts (action 'refunded' on the
--      full path, 'partially_refunded' on the partial one; that column is
--      check-constrained, so those strings are copied from the dump verbatim) —
--      left alone.
--
-- p_refunded_amount KEEPS its `default null` from the dump. Deliberate, and not
-- the same question as p_retained_fee: the five edits above do not include
-- removing it, and the standing instruction is to prefer the dump on anything
-- they do not cover. Concretely, the default is what keeps the 4-key call form
-- resolvable — refund-policy.test.ts's dropped-4-arg-overload regression test
-- and the four-argument call sites in money-txn.test.ts both depend on it — and
-- null has always meant "refund everything", which under this rule resolves to
-- the whole of net_to_org: the correct full refund, never an over-refund, since
-- net_to_org is also the cap.
--
-- It is NOT needed by payments-webhook. An earlier draft of this header claimed
-- removing the default would 404 that caller; that was wrong and is corrected
-- here, because the whole value of a dumped-body migration is that the next
-- engineer can trust this block. PostgREST resolves an RPC by the set of
-- argument NAMES present in the JSON body, and payments-webhook/index.ts always
-- sends the key (`p_refunded_amount: parked.refunded_amount ?? null`); an
-- explicit null survives JSON.stringify and binds fine to a parameter with no
-- default. The webhook reaches this function either way.
drop function if exists public.refund_registration_tx(uuid, uuid, text, jsonb, int, int, int);
drop function if exists public.refund_registration_tx(uuid, uuid, text, jsonb);

create or replace function public.refund_registration_tx(
  p_registration_id uuid,
  p_refunded_by     uuid,
  p_note            text,
  p_provider_refund jsonb,
  p_refunded_amount int default null,
  p_retained_net    int default 0
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status   public.registration_status;
  v_category uuid;
  v_org      uuid;
  v_event    uuid;
  v_raw      jsonb;
  v_net      int;
  v_partial  boolean;
begin
  select r.status, r.category_id, r.org_id, r.event_id
    into v_status, v_category, v_org, v_event
    from public.registrations r where r.id = p_registration_id for update;
  if not found then return 'not_found'; end if;
  if v_status = 'refunded' then return 'already'; end if;
  if v_status <> 'paid' then return 'not_paid'; end if;

  -- net_to_org, NOT amount: `amount` includes Race Pace's earned commission and
  -- PayMongo's non-returnable fee, and in pass_on mode is the grossed-up total
  -- the runner paid. Neither is ours to hand back.
  select p.net_to_org, p.raw into v_net, v_raw
    from public.payments p where p.registration_id = p_registration_id;

  -- Nothing can refund more than the organizer received. A caller still
  -- computing from `amount` overdraws here rather than silently paying the
  -- runner out of the commission.
  if p_refunded_amount is not null and p_refunded_amount > v_net then
    raise exception 'refund_exceeds_net_to_org: % > %', p_refunded_amount, v_net
      using errcode = '22003';
  end if;

  -- p_refunded_amount null means "refund everything", which now means the whole
  -- of net_to_org — see the provenance note above. It therefore cancels the
  -- entry and frees the slot, so a caller that ALSO names a retention is
  -- self-contradictory: taking the full branch would silently discard the
  -- retention both parties agreed to. The likeliest such caller is
  -- payments-webhook settling a flat-fee refund parked before this migration, so
  -- this must raise rather than resolve one way or the other.
  if p_refunded_amount is null and coalesce(p_retained_net, 0) > 0 then
    raise exception 'refund_retention_without_amount: retained % with no refunded amount', p_retained_net
      using errcode = '22003';
  end if;

  v_partial := p_refunded_amount is not null and p_refunded_amount < v_net;

  -- THE SPLIT MUST BALANCE. `net_to_org` is written from p_retained_net
  -- unvalidated, and the identity below is exactly what this function's own
  -- guarantee — and payout_open_statement's `Σ net_to_org` — rests on:
  --
  --   refunded_amount + net_to_org + platform_fee + processor_fee_cents = amount
  --
  -- which reduces to `p_refunded_amount + p_retained_net = v_net` because the
  -- other two terms are immutable here. Without this check a caller carrying a
  -- pre-2026-08-11 split (refund struck off `amount`, retention off a re-struck
  -- commission) passes the over-refund guard, writes a row that is short or long
  -- by the difference, and is paid out on that figure with nothing to flag it.
  -- Raising makes that corruption structurally impossible rather than a runbook
  -- item.
  if v_partial and p_refunded_amount + coalesce(p_retained_net, 0) <> v_net then
    raise exception 'refund_split_mismatch: % + % <> %', p_refunded_amount, p_retained_net, v_net
      using errcode = '22003';
  end if;

  if v_partial then
    -- The entry SURVIVES: the runner keeps their place, so the registration
    -- stays 'paid' and the slot stays taken.
    --
    -- `amount` is NOT rewritten. The old version overwrote it with the retained
    -- figure and stashed the original in raw.original_amount, which under the
    -- three-party ledger would permanently break
    -- `amount - processor_fee_cents = the provider's net_amount`.
    -- platform_fee is untouched for the same reason: it was earned at capture.
    -- Only net_to_org moves, down to what the organizer kept.
    update public.payments
       set status          = 'partially_refunded',
           refunded_amount = p_refunded_amount,
           net_to_org      = p_retained_net,
           raw = coalesce(v_raw, '{}'::jsonb) || jsonb_build_object(
                   'refunded_at', now(),
                   'refunded_by', p_refunded_by,
                   'note', p_note,
                   'partial', true,
                   'provider_refund', p_provider_refund)
     where registration_id = p_registration_id;

    insert into public.registration_audit
      (registration_id, org_id, event_id, action, detail, actor_id, actor_role)
    values (p_registration_id, v_org, v_event, 'partially_refunded',
            jsonb_build_object('amount', p_refunded_amount, 'note', p_note), p_refunded_by, 'admin');

    return 'partially_refunded';
  end if;

  update public.registrations set status = 'refunded' where id = p_registration_id;

  -- A fully refunded row KEEPS its amount/platform_fee/processor_fee_cents/
  -- net_to_org. That is deliberate and load-bearing: payout_open_statement reads
  -- net_to_org off refunded rows to size a clawback. See
  -- 20260807090300_payout_statements.sql.
  update public.payments
     set status = 'refunded',
         refunded_amount = v_net,
         raw = coalesce(v_raw, '{}'::jsonb) || jsonb_build_object(
                 'refunded_at', now(),
                 'refunded_by', p_refunded_by,
                 'note', p_note,
                 'provider_refund', p_provider_refund)
   where registration_id = p_registration_id;

  update public.categories set slots_taken = greatest(slots_taken - 1, 0) where id = v_category;

  insert into public.registration_audit
    (registration_id, org_id, event_id, action, detail, actor_id, actor_role)
  values (p_registration_id, v_org, v_event, 'refunded',
          jsonb_build_object('amount', v_net, 'note', p_note), p_refunded_by, 'admin');

  return 'refunded';
end;
$$;

revoke all on function public.refund_registration_tx(uuid, uuid, text, jsonb, int, int) from public;
grant execute on function public.refund_registration_tx(uuid, uuid, text, jsonb, int, int) to service_role;

-- Belt-and-braces, matching 20260811093000's posture on confirm_payment_tx. A
-- freshly created function has no direct grants to these roles, so this is a
-- no-op — asserted anyway, because this function was one of the two targets of
-- the proven exploit in 20260808110000_lock_down_function_grants.sql's header,
-- and `revoke ... from public` alone has already been shown here not to be the
-- whole story: anon keeps EXECUTE via default privileges.
revoke execute on function public.refund_registration_tx(uuid, uuid, text, jsonb, int, int)
  from anon, authenticated;
