-- A runner may hold at most ONE live entry per event. Without this, a fresh
-- idempotency key on each attempt produced a fresh row -- the existing
-- unique (user_id, idempotency_key) bounds retries of a single checkout call,
-- not how many entries a runner accumulates. Every duplicate entry consumes a
-- slot another runner could have taken.
--
-- Enforced by a partial unique index rather than a check in
-- registrations-checkout, because an application-level "does a row already
-- exist" read races: two concurrent checkouts both read zero rows, both
-- insert, both succeed. The index makes Postgres the arbiter.

-- How long an unpaid entry survives before the sweep reclaims it. Also the
-- single source of truth for the hold window -- do not repeat this literal.
alter table public.registrations
  add column expires_at timestamptz default (now() + interval '24 hours');

comment on column public.registrations.expires_at is
  'When an unpaid entry stops holding the runner''s one-per-event slot. Set on '
  'insert, cleared when the registration is paid. Null means "no hold to expire".';

-- Existing pending rows predate the column and would otherwise never expire.
update public.registrations
   set expires_at = created_at + interval '24 hours'
 where status = 'pending' and expires_at is null;

-- A paid entry has no hold to run out.
update public.registrations set expires_at = null where status <> 'pending';

-- Pre-existing duplicates would abort the CREATE UNIQUE INDEX below, so they
-- are resolved here rather than in a separate script that could be skipped:
-- a standalone cleanup is one more thing to remember, and forgetting it fails
-- `db push` halfway. Keep the earliest entry per (event, runner) and expire
-- the rest.
--
-- slots_taken is deliberately NOT adjusted for anything but 'paid' losers.
-- Read 20260806201000_admin_cancel_registration_rpc.sql before changing this:
-- an earlier version of that function decremented slots_taken when cancelling
-- unpaid registrations and manufactured capacity nobody had vacated. Rows
-- expired here that were 'paid' DID hold a slot, so those -- and only those --
-- are released, one decrement per released row.
--
-- The dedupe itself lives in public.dedupe_live_registrations()
-- (20260809100050_dedupe_live_registrations_fn.sql), not inline here, so
-- Task 10 can re-invoke the identical logic after the hosted push and confirm
-- it returns 0, and so it's callable directly from tests -- a partial unique
-- index makes it impossible to stage genuine duplicate 'pending'/'paid' rows
-- through any client once the index below exists, so this call is this
-- migration's only chance to exercise it against real pre-existing data.
select public.dedupe_live_registrations();

create unique index registrations_one_live_per_event
  on public.registrations (event_id, user_id)
  where status in ('pending', 'paid');
