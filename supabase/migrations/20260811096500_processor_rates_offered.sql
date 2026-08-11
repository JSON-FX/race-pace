-- Which rate-card rows describe a method a runner can actually choose.
--
-- WHY A COLUMN AND NOT A CONSTANT IN THE WEB APP.
-- The list of offerable methods lives today in METHOD_MAP
-- (supabase/functions/payment-session/index.ts) — `{ card, gcash, maya }` — which
-- is Deno. apps/web is Node and cannot import it, so a web-side copy would be two
-- sources of truth for one product fact, in two runtimes, with no shared test
-- between them. `processor_rates` is the rate card of record, and "can a runner
-- pick this" is a property of the rate card; the runner pay screen reads the same
-- table and would otherwise grow a third copy.
--
-- WHAT IT IS NOT. This does not gate charging: payment-session still validates
-- the method against METHOD_MAP, and nothing here can authorise a method that
-- map rejects. It gates what organizer-facing FORECASTS are allowed to rank
-- over. Before this column, the settlement projection ranked every seeded rate
-- and picked `dob` (80 bps, and its own seed note says UNCONFIRMED) as the
-- cheapest — quoting an optimistic end no runner could reach.
alter table public.processor_rates
  add column if not exists offered boolean not null default false;

comment on column public.processor_rates.offered is
  'True when a runner can actually choose this method at checkout (METHOD_MAP in '
  'payment-session/index.ts). Rows seeded ahead of being enabled stay false so '
  'organizer-facing forecasts never quote a rate nobody can reach. Defaults to '
  'FALSE, which means a rate CHANGE — a new current row superseding an old one — '
  'must set it explicitly or the method drops out of every forecast. '
  'supabase/tests/processor-rates.test.ts asserts the offered set and goes red if '
  'that happens.';

-- Exactly the three METHOD_MAP offers. `card` is marked on both scopes: offered
-- is a property of the METHOD, and whether a card happens to be issued abroad is
-- not something the runner chooses. Scope stays a separate, explicit filter at
-- every call site.
update public.processor_rates
   set offered = true
 where provider = 'paymongo'
   and method in ('card', 'gcash', 'paymaya');
