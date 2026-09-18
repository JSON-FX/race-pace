-- Freeze the price terms that the runner accepted when a checkout session was
-- minted. Organization settings can change while PayMongo is still open; a
-- later capture must use the terms of that checkout, not today's org settings.
-- Historical payments remain null/false and keep their legacy handling.
alter table public.payments
  add column checkout_fee_mode text,
  add column checkout_platform_fee integer,
  add column checkout_provider_managed_fee boolean not null default false,
  add constraint payments_checkout_terms_together check (
    (checkout_fee_mode is null and checkout_platform_fee is null and not checkout_provider_managed_fee)
    or (checkout_fee_mode in ('absorb','pass_on') and checkout_platform_fee between 0 and 2147483647
      and (not checkout_provider_managed_fee or checkout_fee_mode='pass_on'))
  );

-- payments uses column-scoped writes in parts of the app. Record the new
-- service-role privileges explicitly instead of relying on defaults.
revoke update (checkout_fee_mode,checkout_platform_fee,checkout_provider_managed_fee)
  on public.payments from anon,authenticated;
grant select,update (checkout_fee_mode,checkout_platform_fee,checkout_provider_managed_fee)
  on public.payments to service_role;
