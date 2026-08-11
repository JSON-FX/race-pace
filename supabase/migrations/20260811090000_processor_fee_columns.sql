-- Three-party ledger. Design 2026-08-11 §3.
--
-- The ledger had two parties. PayMongo's processing fee appeared nowhere, so
-- Race Pace's commission silently absorbed it and the platform's real margin on
-- a card payment was 10% - 3.5% - ₱15 with no way to see that. A clean 3% is
-- not expressible while the processor's cost is invisible.

alter table payments
  add column if not exists processor_fee_cents integer not null default 0
    check (processor_fee_cents >= 0),
  add column if not exists processor_fee_predicted_cents integer
    check (processor_fee_predicted_cents is null or processor_fee_predicted_cents >= 0),
  add column if not exists processor_fee_source text not null default 'none'
    check (processor_fee_source in ('actual', 'predicted', 'historical', 'none'));

comment on column payments.processor_fee_cents is
  'What the processor actually took, in centavos. The only processor figure the ledger trusts.';
comment on column payments.processor_fee_predicted_cents is
  'What the rate card said this would cost. Kept ONLY to detect rate drift; never used in payout arithmetic.';
comment on column payments.processor_fee_source is
  '''actual'' read from the provider payload; ''predicted'' rate-card estimate awaiting reconciliation; '
  '''historical'' a real fee recovered by backfill but ABSORBED by the platform under pre-2026-08-11 terms; '
  '''none'' unknown. The invariant net_to_org = amount - processor_fee_cents - platform_fee holds for '
  '''actual'' and ''predicted'' ONLY — ''historical'' violates it deliberately, and that violation is the '
  'record that the platform paid for processing on that entry.';

-- Who bears the processing cost. Deliberately NOT folded into commission_type:
-- an org can be on a flat peso commission AND pass-on mode. Mode and rate are
-- negotiated separately, so they are stored separately.
alter table organizations
  add column if not exists fee_mode text not null default 'absorb'
    check (fee_mode in ('absorb', 'pass_on'));

comment on column organizations.fee_mode is
  '''absorb'': the runner pays the sticker price and the organizer bears processing. '
  '''pass_on'': the surcharge is grossed up onto the runner and the organizer receives the full sticker price. '
  'Super admin only.';

-- 3% for organizations created from here on. Existing rows keep their terms:
-- a default is for rows that do not exist yet. Same reasoning as
-- 20260807090100_commission_and_refund_policy.sql.
alter table organizations alter column commission_rate set default 0.03;

alter table payout_statements
  add column if not exists processing_cents bigint not null default 0;
