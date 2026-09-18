-- Four staging PayMongo GCash captures reported an actual 2.50% fee, while
-- the current prediction card said 1.50%. That undercharges pass-on runners
-- by about 1% and silently reduces the organizer's net. Preserve the old
-- interval so historical predictions remain explainable. The public 2.23%
-- ex-VAT GCash quote rounds to 2.50% with Philippine VAT; confirm account-
-- specific live pricing before production pass-on is enabled.
do $$
declare
  v_current public.processor_rates%rowtype;
  v_at timestamptz := clock_timestamp();
begin
  select * into v_current
  from public.processor_rates
  where provider = 'paymongo' and method = 'gcash' and scope = 'local'
    and effective_to is null
  for update;

  if not found then
    raise exception 'missing current GCash processor rate';
  end if;
  if v_current.percent_bps = 250 and v_current.fixed_cents = 0 then
    return;
  end if;
  if v_current.percent_bps <> 150 or v_current.fixed_cents <> 0 then
    raise exception 'unexpected GCash processor rate; review before replacing it';
  end if;

  update public.processor_rates
  set effective_to = v_at
  where id = v_current.id;

  insert into public.processor_rates
    (provider, method, scope, percent_bps, fixed_cents, effective_from, note, offered)
  values
    ('paymongo', 'gcash', 'local', 250, 0, v_at,
     '2.50% VAT-inclusive; verified against four staging PayMongo test captures',
     v_current.offered);
end $$;
