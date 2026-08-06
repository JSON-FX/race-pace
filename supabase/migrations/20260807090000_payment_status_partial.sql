-- A flat-fee refund returns part of the payment and RETAINS the rest, which is
-- real revenue for both parties. 'refunded' cannot express that: it drops the
-- row out of every `status = 'paid'` sum, which would erase money the organizer
-- actually keeps.
--
-- Alone in this file deliberately. ALTER TYPE ... ADD VALUE cannot run in the
-- same transaction as any statement that references the new value, and the
-- Supabase CLI wraps each migration file in one transaction — so the columns and
-- the aggregates that use 'partially_refunded' must land in later files.
alter type payment_status add value if not exists 'partially_refunded';
