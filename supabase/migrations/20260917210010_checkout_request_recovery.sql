-- A PayMongo create call may succeed while the Edge response or payment-row
-- update is lost. Keep the exact request on the payment before making that
-- external call so a retry can reuse PayMongo's idempotency key and payload.
alter table public.payments add column checkout_request jsonb;

comment on column public.payments.checkout_request is
  'Frozen server-built provider create request for safe checkout recovery; never replace after insert.';

-- Existing table grants cover the new column, but state them explicitly so
-- the migration does not rely on grant inheritance being remembered.
grant select (checkout_request) on public.payments to authenticated;
grant insert (checkout_request) on public.payments to service_role;

create function public.guard_payment_checkout_request()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.checkout_request is distinct from old.checkout_request then
    raise exception 'checkout_request_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_payment_checkout_request() from public, anon, authenticated;
grant execute on function public.guard_payment_checkout_request() to service_role;

create trigger payments_checkout_request_immutable
  before update on public.payments for each row
  execute function public.guard_payment_checkout_request();
