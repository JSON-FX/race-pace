-- Drift detection. Design 2026-08-11 §5.
--
-- The rate card touches exactly two things: the pass-on surcharge and estimates
-- shown to humans. It NEVER touches the ledger — so drift cannot make a report
-- wrong. It can only make a pass-on charge under- or over-collect.
--
-- Which means drift is measurable from the platform's own money: every
-- confirmation stores predicted alongside actual. A rate change is detected
-- within hours from real transactions, instead of depending on somebody reading
-- the provider's pricing page.

-- ###########################################################################
-- ##  THE `with (security_invoker = true)` CLAUSE BELOW MUST BE REPEATED    ##
-- ##  ON EVERY `create or replace view` THAT TOUCHES THIS VIEW. EVER.       ##
-- ###########################################################################
--
-- Postgres does NOT carry reloptions forward across a replace. A second
-- `create or replace view processor_rate_drift_v as ...` that omits the clause
-- resets them to empty SILENTLY — no error, no warning, no notice. Nothing in a
-- migration log would show it.
--
-- What that costs here is not a subtle behaviour change. The view is granted to
-- `authenticated` (bottom of this file) and owned by `postgres`, which bypasses
-- RLS. Drop the clause and the view stops filtering by the caller's policies on
-- `payments` and starts returning EVERY organization's drift sample to ANY
-- signed-in user. An edit as innocuous as appending a column would do it.
--
-- Guarded by supabase/tests/processor-rates.test.ts:
--   "computes an org admin's sample from that org's payments alone (security_invoker)"
-- which signs in on the anon key precisely because service_role carries
-- rolbypassrls and therefore proves nothing about this property. That test goes
-- red the moment the clause goes missing. Do not delete it, and do not "fix" it
-- by reading through the service key.
create or replace view processor_rate_drift_v
with (security_invoker = true)
as
with recent as (
  select
    p.method,
    -- One scope today. payments carries no scope column: the charge is a peso
    -- amount and PayMongo reports the fee it took, so nothing on the row says
    -- whether the card was issued abroad. `local` is the scope every prediction
    -- is struck under (_shared/confirm.ts passes p_scope => 'local'), so it is
    -- the scope the comparison is against — asserted here rather than implied,
    -- and the column exists so an international-card sample can be split out on
    -- the day the payload tells us which is which.
    'local'::text as scope,
    p.processor_fee_cents,
    p.processor_fee_predicted_cents,
    -- The denominator, and the one figure it is easiest to get subtly wrong.
    -- See the implied_bps note below.
    p.amount,
    row_number() over (
      partition by p.method
      -- p.id only breaks ties. Several confirmations can share a created_at
      -- (a batch, or two webhooks in the same millisecond), and without a
      -- deterministic tiebreak the 20th and 21st rows would swap between
      -- executions of the same query — a detector that quietly changes its own
      -- answer is worse than one that is wrong consistently.
      order by p.created_at desc, p.id desc
    ) as rn
  from public.payments p
  -- ELIGIBILITY. 'actual' is the ONLY source that carries two independent
  -- numbers: the provider's own reported fee, and what the card said it would
  -- be. The other three do not, and each fails in a different direction:
  --
  --   'predicted'  — processor_fee_cents WAS COPIED FROM the prediction
  --                  (_shared/confirm.ts: `processorFee = processorFeePredicted`).
  --                  Including it compares a number to itself, contributes a
  --                  guaranteed delta of 0, and drags the disagreeing ratio
  --                  toward "no drift" — the dangerous direction for a detector,
  --                  because the reading that suppresses the alarm is the one
  --                  that gets believed.
  --   'historical' — the backfill (20260811092000) recovered a real fee from
  --                  payments.raw but wrote no prediction; those rows predate the
  --                  rate card entirely, so there is nothing to compare against.
  --   'none'       — neither figure is known.
  --
  -- The predicted-is-not-null test is not redundant with the source test: an
  -- 'actual' row confirmed while no rate card row existed for its method has a
  -- real fee and a NULL prediction (confirm.ts only predicts `if (rate)`), and
  -- its delta would be NULL. Excluded, so a missing rate card reads as a smaller
  -- sample rather than as agreement.
  where p.processor_fee_source = 'actual'
    and p.processor_fee_predicted_cents is not null
    and p.method is not null
    and p.amount > 0
  -- No status filter, deliberately. A refunded entry still cost what it cost:
  -- 20260811094000 stopped rewriting `amount`, and neither refund branch touches
  -- processor_fee_cents or the prediction, so a refunded row remains an honest
  -- observation of what the provider charged to process it. PayMongo does not
  -- return its fee, which is precisely why the row still counts.
),
sample as (
  select
    r.method,
    r.scope,
    r.processor_fee_cents - r.processor_fee_predicted_cents as delta,
    -- Solve the rate back out of what was actually charged.
    --
    -- THE DENOMINATOR IS `amount`, NOT the entry's base price, and that is the
    -- whole difference between measuring drift and measuring the fee mode. In
    -- pass-on mode payment-session grosses the charge up and confirm.ts predicts
    -- against that same grossed-up figure — `predictProcessorFee(charged, rate)`,
    -- where `charged` is payments.amount (and is reconciled to what the provider
    -- says it captured when the two disagree). Dividing by a ₱2,000 base while
    -- the provider took its cut of a ₱2,150.26 charge would read 376 bps against
    -- a carded 350, on every pass-on payment, forever.
    ((r.processor_fee_cents - c.fixed_cents)::numeric * 10000) / r.amount as implied_bps,
    c.percent_bps as card_bps
  from recent r
  -- INNER join: a method with no current rate card row produces no row at all.
  -- There is no card to have drifted from, and processor_rates_one_current
  -- guarantees this matches at most once, so the join cannot duplicate a payment.
  join public.processor_rates c
    on  c.provider     = 'paymongo'
    and c.method       = r.method
    and c.scope        = r.scope
    and c.effective_to is null
  where r.rn <= 20
)
select
  s.method,
  s.scope,
  count(*)::integer as sample_size,
  -- Disagreements IN THE DOMINANT DIRECTION, by more than ₱1. Strictly more:
  -- a delta of exactly 100 centavos does not count.
  --
  -- Direction matters because a rate change moves every payment the same way.
  -- Six payments ₱5 over and four ₱5 under is a sample where ten of ten
  -- "disagree" and the rate has not changed at all — flagging it would teach
  -- whoever reads the banner to stop reading it.
  greatest(
    count(*) filter (where s.delta >  100),
    count(*) filter (where s.delta < -100)
  )::integer as disagreeing,
  -- Median rather than mean, so one unusual payment cannot move the reported
  -- figure. This is the number a human is shown next to card_bps.
  (percentile_cont(0.5) within group (
    order by s.implied_bps::double precision
  ))::integer as median_implied_bps,
  -- Constant within the group: the join above resolves exactly one current card
  -- row per (provider, method, scope). max() is only here to satisfy group by.
  max(s.card_bps)::integer as card_bps,
  sum(s.delta)::bigint as delta_cents,
  -- At least 80% of the sample, in one direction. `count(*) * 0.8` is numeric
  -- (0.8 is a numeric literal, not a float), so 5 * 0.8 is exactly 4 and four of
  -- five flags — "at least 80%" is inclusive at the boundary, not a coin toss on
  -- a binary fraction.
  --
  -- The five-row floor is what stops a brand-new method from raising an alarm
  -- off its first payment. A single outlier is not a pricing change; fourteen of
  -- fourteen is.
  (count(*) >= 5
   and greatest(
         count(*) filter (where s.delta >  100),
         count(*) filter (where s.delta < -100)
       ) >= count(*) * 0.8) as drifting
from sample s
group by s.method, s.scope;

comment on view processor_rate_drift_v is
  'Predicted vs actual processing fees over the last 20 payments per method. '
  'Reads only processor_fee_source = ''actual'' rows: those are the only ones carrying two '
  'independent figures, since a ''predicted'' row''s actual IS its prediction. '
  'A positive delta_cents means the platform UNDER-collected in pass-on mode and '
  'absorbed the difference — the organizer always receives what was promised.';

comment on column processor_rate_drift_v.disagreeing is
  'How many of the sample_size payments differ from the rate card by MORE than ₱1 in the '
  'dominant direction — i.e. the larger of (actual over predicted) and (actual under '
  'predicted), never their sum. Reads directly as the banner''s "the last N of M payments '
  'cost X%", and drifting is exactly disagreeing >= 80% of sample_size once sample_size >= 5.';

comment on column processor_rate_drift_v.median_implied_bps is
  'The rate solved back out of what the provider actually took: '
  '(processor_fee_cents - card fixed_cents) * 10000 / amount, median over the sample. '
  'The denominator is payments.amount — the grossed-up charge in pass-on mode, and the same '
  'figure the prediction was struck on — so this measures rate drift and not the fee mode.';

-- security_invoker means the caller's RLS on `payments` applies, so an org admin
-- sees drift computed from their own rows only and a super admin sees all of it.
grant select on processor_rate_drift_v to authenticated;
-- Views created inside a migration do NOT inherit the default privileges that
-- dashboard-created objects get, so service_role needs saying out loud — the same
-- reason 20260811091000 spells it out for processor_rates and 20260807090200 does
-- for the money aggregate views. Without it every server-side read fails.
grant select on processor_rate_drift_v to service_role;
