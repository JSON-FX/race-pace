-- Per-organization commercial terms. Design 2026-08-06 §9.5, §9.6.
--
-- Commission is charged PER REGISTRATION — already true, _shared/confirm.ts
-- computes the fee against one registration's total_amount at confirmation.
-- What is new is that the fee may be a flat peso amount rather than only a
-- percentage, and that how much a cancelling runner gets back is a policy
-- rather than always "everything".

alter table organizations
  add column if not exists commission_type text not null default 'fixed'
    check (commission_type in ('percent', 'fixed')),
  add column if not exists commission_flat_cents integer not null default 0
    check (commission_flat_cents >= 0),
  add column if not exists refund_policy text not null default 'flat_fee'
    check (refund_policy in ('full', 'none', 'flat_fee')),
  add column if not exists refund_fee_cents integer not null default 0
    check (refund_fee_cents >= 0);

comment on column organizations.commission_type is
  'How the per-registration platform fee is struck: ''percent'' uses commission_rate, ''fixed'' uses commission_flat_cents.';
comment on column organizations.refund_policy is
  '''full'' returns everything; ''none'' refuses refunds; ''flat_fee'' retains refund_fee_cents and treats the retention as a smaller sale.';

-- A partial refund leaves a real, smaller sale behind. refunded_amount records
-- what actually went back to the runner, since `amount` is rewritten to the
-- retained figure so every downstream sum keeps describing money we hold.
alter table payments
  add column if not exists refunded_amount integer not null default 0
    check (refunded_amount >= 0);

-- The column DEFAULTs above and this backfill deliberately disagree.
--
-- New organizations default to a flat fee and a flat-fee refund, as decided.
-- But the companion amounts default to 0, and a ₱0 flat commission earns the
-- platform nothing while a ₱0 retention is indistinguishable from a full
-- refund. Letting the two live orgs inherit the new defaults would silently
-- drop Race Pace's revenue on them from 10% to zero.
--
-- A default is for rows that do not exist yet. Rows that already exist keep the
-- terms they are actually operating under, and are changed deliberately in the
-- Commission UI instead.
update organizations set commission_type = 'percent' where commission_type = 'fixed';
update organizations set refund_policy   = 'full'    where refund_policy   = 'flat_fee';
