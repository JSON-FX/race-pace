-- Refund policy in the money transaction. Design 2026-08-06 §5, §9.6.
--
-- A refund returns the commission too: Race Pace gives back its platform_fee
-- alongside the organizer's net_to_org. Under a 'flat_fee' policy the RETAINED
-- amount is treated as a smaller sale — the org's normal commission rule runs
-- against it — so the row keeps describing a real sale and every downstream sum
-- works unchanged.
--
-- The retained split is computed by the CALLER (functions/_shared/refund.ts via
-- computeFee) rather than here, so percent-vs-flat and its clamp live in exactly
-- one place instead of being reimplemented in PL/pgSQL and drifting.

-- Adding parameters does NOT replace the existing function: Postgres identifies
-- functions by name + argument types, so `create or replace` with three extra
-- params creates an OVERLOAD. The old 4-arg version would still win for every
-- existing 4-arg call site (payments-webhook, _shared/refund.ts) as an exact
-- match, and none of the logic below would ever run. It has to go.
drop function if exists public.refund_registration_tx(uuid, uuid, text, jsonb);

create or replace function public.refund_registration_tx(
  p_registration_id uuid,
  p_refunded_by     uuid,
  p_note            text,
  p_provider_refund jsonb,
  p_refunded_amount int default null,
  p_retained_fee    int default 0,
  p_retained_net    int default 0
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status   public.registration_status;
  v_category uuid;
  v_raw      jsonb;
  v_amount   int;
  v_partial  boolean;
begin
  select r.status, r.category_id into v_status, v_category
    from public.registrations r where r.id = p_registration_id for update;
  if not found then return 'not_found'; end if;
  if v_status = 'refunded' then return 'already'; end if;
  if v_status <> 'paid' then return 'not_paid'; end if;

  select p.amount, p.raw into v_amount, v_raw
    from public.payments p where p.registration_id = p_registration_id;

  -- p_refunded_amount null means "refund everything", which keeps the four-arg
  -- behaviour for any caller that has not been taught about policy yet.
  v_partial := p_refunded_amount is not null and p_refunded_amount < v_amount;

  if v_partial then
    -- The entry SURVIVES a partial refund — the runner keeps their place, so the
    -- registration stays 'paid' and the slot stays taken. Only the payment row
    -- changes, and it changes to describe the smaller sale that remains.
    update public.payments
       set status          = 'partially_refunded',
           refunded_amount = p_refunded_amount,
           amount          = v_amount - p_refunded_amount,
           platform_fee    = p_retained_fee,
           net_to_org      = p_retained_net,
           raw = coalesce(v_raw, '{}'::jsonb) || jsonb_build_object(
                   'refunded_at', now(),
                   'refunded_by', p_refunded_by,
                   'note', p_note,
                   'partial', true,
                   -- `amount` is now the retained figure, so the original is
                   -- recoverable only from here.
                   'original_amount', v_amount,
                   'provider_refund', p_provider_refund)
     where registration_id = p_registration_id;
    return 'partially_refunded';
  end if;

  update public.registrations set status = 'refunded' where id = p_registration_id;

  -- A fully refunded row KEEPS its original amount/platform_fee/net_to_org. That
  -- is deliberate and load-bearing: payout_open_statement reads net_to_org off
  -- refunded rows to size a clawback. See 20260807090300_payout_statements.sql.
  update public.payments
     set status = 'refunded',
         refunded_amount = v_amount,
         raw = coalesce(v_raw, '{}'::jsonb) || jsonb_build_object(
                 'refunded_at', now(),
                 'refunded_by', p_refunded_by,
                 'note', p_note,
                 'provider_refund', p_provider_refund)
   where registration_id = p_registration_id;

  update public.categories set slots_taken = greatest(slots_taken - 1, 0) where id = v_category;

  return 'refunded';
end;
$$;

revoke all on function public.refund_registration_tx(uuid, uuid, text, jsonb, int, int, int) from public;
grant execute on function public.refund_registration_tx(uuid, uuid, text, jsonb, int, int, int) to service_role;
