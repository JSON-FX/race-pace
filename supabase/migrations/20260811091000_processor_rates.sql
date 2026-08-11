-- The rate card. Design 2026-08-11 §3.3.
--
-- Data rather than code so it can be corrected without a deploy — and versioned
-- by effective date so a prediction made in August is still explainable in
-- December.
--
-- This table predicts. It NEVER decides. The ledger reads the provider's own
-- reported fee (§2), so a stale row here cannot make a report wrong; it can only
-- make a pass-on surcharge under- or over-collect, which §5 detects from actuals.

create table if not exists processor_rates (
  id             uuid primary key default gen_random_uuid(),
  provider       text not null default 'paymongo',
  method         text not null,
  scope          text not null default 'local'
                   check (scope in ('local', 'international')),
  -- VAT-INCLUSIVE basis points. 350 = 3.50%. The commonly-quoted PayMongo
  -- figures are ex-VAT; every one of them x 1.12 lands on the published rate
  -- (3.125% -> 3.50%, 1.34% -> 1.50%). Storing ex-VAT and deducting VAT-inclusive
  -- is precisely the reconciliation failure this design exists to prevent.
  percent_bps    integer not null check (percent_bps >= 0),
  fixed_cents    integer not null default 0 check (fixed_cents >= 0),
  effective_from timestamptz not null default now(),
  effective_to   timestamptz,
  note           text,
  created_by     uuid references auth.users(id),
  check (effective_to is null or effective_to > effective_from)
);

-- At most one CURRENT row per method. Historical rows accumulate with an
-- effective_to, which is what makes the lookup below unambiguous.
create unique index if not exists processor_rates_one_current
  on processor_rates (provider, method, scope) where effective_to is null;

create index if not exists processor_rates_lookup_idx
  on processor_rates (provider, method, scope, effective_from desc);

alter table processor_rates enable row level security;

drop policy if exists processor_rates_read on processor_rates;
-- Readable by any signed-in user: the pass-on breakdown on the pay screen is
-- rendered from it, and it is a published price list, not a secret.
create policy processor_rates_read on processor_rates for select to authenticated using (true);

drop policy if exists processor_rates_write on processor_rates;
create policy processor_rates_write on processor_rates
  for all using (auth_is_super_admin()) with check (auth_is_super_admin());

grant select on processor_rates to authenticated;
-- Tables created inside a migration do NOT inherit the default privileges that
-- dashboard-created tables get. Without this, every service-role read fails.
grant all on processor_rates to service_role;

-- Seed, VAT-INCLUSIVE.
--
-- Only card/gcash/paymaya are reachable today — METHOD_MAP in
-- payment-session/index.ts offers no others. The rest are seeded so enabling a
-- method is a UI change rather than a schema change.
--
-- GrabPay and ShopeePay are deliberately absent: their quoted 1.34-2.2% ex-VAT
-- is a range across integration tiers rather than a rate, so seeding either end
-- would be a guess in a table whose whole job is to be right.
insert into processor_rates (provider, method, scope, percent_bps, fixed_cents, note)
values
  ('paymongo', 'card',     'local',         350, 1500, 'Quoted 3.125% + ₱13.39 ex-VAT'),
  ('paymongo', 'card',     'international', 450, 1500, 'Quoted 4.02% + ₱13.39 ex-VAT'),
  ('paymongo', 'gcash',    'local',         150,    0, 'Quoted 1.34% ex-VAT'),
  ('paymongo', 'paymaya',  'local',         150,    0, 'Quoted 1.34% ex-VAT'),
  ('paymongo', 'qrph',     'local',         150,    0, 'Quoted 1.34% ex-VAT'),
  -- Least certain of the six. The source quotes "~0.71% OR ₱13.39, varies by
  -- partnered bank" — two different shapes, not a range. Seeded as a percentage
  -- and to be corrected from real settlements before the method is enabled.
  ('paymongo', 'dob',      'local',          80,    0, 'Quoted ~0.71% ex-VAT — UNCONFIRMED'),
  ('paymongo', 'billease', 'local',         150,    0, 'Quoted 1.34% ex-VAT')
on conflict do nothing;

-- The rate in force AT A GIVEN MOMENT — not today's.
--
-- Predicting a March payment with August's rate would make every historical
-- drift comparison meaningless, since the "disagreement" would just be the rate
-- change itself.
create or replace function public.processor_rate_at(
  p_provider text, p_method text, p_scope text, p_at timestamptz
) returns table (percent_bps integer, fixed_cents integer)
language sql
stable
security definer
set search_path = ''
as $$
  select r.percent_bps, r.fixed_cents
  from public.processor_rates r
  where r.provider = p_provider
    and r.method   = p_method
    and r.scope    = p_scope
    and r.effective_from <= p_at
    and (r.effective_to is null or r.effective_to > p_at)
  order by r.effective_from desc
  limit 1;
$$;

revoke all on function public.processor_rate_at(text, text, text, timestamptz) from public;
grant execute on function public.processor_rate_at(text, text, text, timestamptz) to authenticated;
grant execute on function public.processor_rate_at(text, text, text, timestamptz) to service_role;
