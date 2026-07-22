-- Atomic money-state transitions for confirm + refund. Each function body runs in a
-- single transaction (all writes commit or roll back together), replacing the prior
-- sequential, non-transactional Edge-Function writes. security definer + search_path=''
-- + fully schema-qualified + service_role-only. Row-locked for idempotency/race-safety.

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
begin
  select status, category_id into v_status, v_category
    from public.registrations where id = p_registration_id for update;
  if not found then return 'not_found'; end if;
  if v_status = 'paid' then return 'already'; end if;
  if v_status <> 'pending' then return 'not_pending'; end if;  -- refunded/cancelled: never re-confirm (replay-safe)

  update public.payments
     set status = 'paid', method = p_method, platform_fee = p_fee,
         net_to_org = p_net, raw = p_raw
   where registration_id = p_registration_id;

  update public.registrations
     set status = 'paid', ticket_token = p_token
   where id = p_registration_id;

  update public.categories set slots_taken = slots_taken + 1 where id = v_category;

  return 'paid';
end;
$$;

revoke all on function public.confirm_payment_tx(uuid, text, int, int, text, jsonb) from public;
grant execute on function public.confirm_payment_tx(uuid, text, int, int, text, jsonb) to service_role;

create or replace function public.refund_registration_tx(
  p_registration_id uuid, p_refunded_by uuid, p_note text, p_provider_refund jsonb
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.registration_status;
  v_category uuid;
  v_raw jsonb;
begin
  select status, category_id into v_status, v_category
    from public.registrations where id = p_registration_id for update;
  if not found then return 'not_found'; end if;
  if v_status = 'refunded' then return 'already'; end if;
  if v_status <> 'paid' then return 'not_paid'; end if;

  update public.registrations set status = 'refunded' where id = p_registration_id;

  select raw into v_raw from public.payments where registration_id = p_registration_id;
  update public.payments
     set status = 'refunded',
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

revoke all on function public.refund_registration_tx(uuid, uuid, text, jsonb) from public;
grant execute on function public.refund_registration_tx(uuid, uuid, text, jsonb) to service_role;
