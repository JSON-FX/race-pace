# One registration per event

**Date:** 2026-08-09
**Status:** Approved, ready for planning

## Problem

A runner can register for the same event any number of times. Nothing prevents
it at any layer.

`registrations` carries only `unique (user_id, idempotency_key)`
(`supabase/migrations/20260718183018_registrations_payments.sql:14`). The
idempotency key exists to make a *retried* checkout call safe, not to bound how
many entries a runner holds — a fresh key on a fresh attempt produces a fresh
row. `registrations-checkout` validates the event status, the category, the slot
count and the form fields, and never once asks whether this runner already has an
entry.

The cost is capacity. Every duplicate entry consumes a slot another runner could
have taken.

The hosted database currently holds 3 duplicate rows across 5,883 registrations
— one account (`5ed228e7-4a9a-4150-bb12-515032cb533a`) with 3 entries on event
`00000000-0000-0000-0000-000000010000` and 2 on `…010001`. All are `status=paid`
with captured payments and zero check-ins. This is seeded sample data.

## Requirement

A user holds at most one **live** entry per event, where live means `pending` or
`paid`. Exiting an event legitimately — `cancelled`, `refunded`, or the new
`expired` — frees them to enter again.

An unpaid entry does not hold the runner hostage indefinitely: it expires 24
hours after creation, or immediately if the event closes to registration before
then.

## Design

### 1. The gate is an index, not a check

```sql
create unique index registrations_one_live_per_event
  on registrations (event_id, user_id)
  where status in ('pending', 'paid');
```

Application-level "does a row already exist" logic races: two concurrent
checkouts both read zero rows, both insert, both succeed. A partial unique index
makes the database the arbiter — one insert wins, the other raises `23505`.

`cancelled`, `refunded` and `expired` sit outside the predicate, which is what
makes re-entry after a legitimate exit work without any extra branching.

### 2. Expiry of unpaid entries

**Schema:**

- New value `expired` on the `registration_status` enum.
- New column `registrations.expires_at timestamptz`, set to `created_at + 24
  hours` when a pending row is created, nulled when it becomes paid.

**Sweep** — `expire_stale_registrations()`, security definer, `set search_path =
''` and fully schema-qualified, matching the hardening applied in
`20260806202000_harden_auth_helper_search_path.sql`. It moves `pending` rows past
`expires_at` to `expired` and marks the attached payment `failed`. Scheduled via
pg_cron every 15 minutes.

**`slots_taken` is not touched.** A pending registration never held a slot —
`slots_taken` is incremented only at payment confirmation
(`20260723100000_money_txn_rpcs.sql:32`) and decremented only at refund (same
file, line 71). The header comment on
`20260806201000_admin_cancel_registration_rpc.sql` documents a bug where
cancelling unpaid registrations decremented `slots_taken` and manufactured
capacity nobody had vacated. The expiry sweep must not reintroduce it.

**Lazy backstop** — checkout treats a pending row already past its `expires_at`
as gone, regardless of whether the sweep has run. Correctness does not depend on
cron being healthy; the sweep exists to keep admin views honest.

**Early close** — a trigger on `events` status transitions expires that event's
pending rows the moment registration closes, rather than leaving them nominally
alive until their 24 hours are up.

### 3. The in-flight payment problem

`registrations-checkout` upserts a `payments` row with status `pending` and a
live PayMongo checkout URL in the *same request* that creates the registration.
Consequently almost every pending registration has a pending payment.

`admin_cancel_registration` refuses to act in exactly this situation — it returns
`payment_in_flight` (`20260806201000_admin_cancel_registration_rpc.sql:97`)
because cancelling while PayMongo might still capture would leave money taken
against a registration that no longer exists. If the expiry sweep adopted that
same guard it would never expire anything at all.

The 24-hour window is what resolves this: a PayMongo hosted checkout session
expires at 24 hours, so a session that old cannot capture. The residual risk is
near-nil but not zero, and is handled explicitly rather than assumed away:

`confirm_payment_tx` gains a resurrect path. An `expired` registration may still
confirm to `paid` — unless the runner has since acquired a live entry for that
event, in which case confirming would violate
`registrations_one_live_per_event`. In that case the function returns a distinct
`conflict` result which the webhook logs loudly for manual refund. Captured money
is never silently swallowed.

### 4. Checkout behaviour

`registrations-checkout` checks for a live entry before doing any other work and
returns `409 already_registered`, carrying the existing `registration_id` and
`checkout_url` so the client can route the runner to finishing payment instead of
dead-ending them. A `23505` from the index — the concurrent-request case — maps
to the same response.

### 5. UI

The governing principle: a runner should never reach a wall they could have been
warned about a screen earlier.

- **Event page category cards** (`apps/site/components/event/` and
  `apps/mobile/app/event/[id].tsx`) — the CTA reflects the runner's existing
  entry on *every* category of that event, not just the one they hold: `You're in
  · View entry` when paid, `Finish payment · expires in 23h` when pending.
- **Register page** — server-side redirect back to the event page with
  `?registered=<id>`, following the existing `?closed=` / `?soldout=` pattern in
  `apps/site/app/register/[categoryId]/page.tsx`.
- **My Races** — pending entries show a live countdown to expiry and an explicit
  `Cancel entry` action, so a runner can free themselves without waiting out the
  full 24 hours.
- **Admin registrations** — `expired` gets its own badge and filter value,
  distinct from `cancelled`. An abandoned checkout and a deliberate cancellation
  are different facts and an organizer should be able to tell them apart.

Visual execution goes through the `ui-ux-pro-max` skill.

### 6. Hosted data cleanup

Keep one entry per `(user_id, event_id)` — the paid one where there is one, otherwise
the earliest — delete the 3 extras, and
decrement `categories.slots_taken` by the number deleted per category — otherwise
the `slots_taken == paid-registration-count` invariant that the demo seed
maintains is broken.

All affected rows belong to one test account and have zero check-ins, so nothing
else cascades. Delivered as a one-off script under `scripts/`, not a migration:
it describes the state of one database at one moment, not a schema change every
environment should replay.

## Testing

New suite under `supabase/tests/`, following the existing pattern:

- A second live registration for the same event is rejected — both sequentially
  and under two concurrent inserts.
- Registering again after `cancelled` / `refunded` / `expired` succeeds.
- A pending row past `expires_at` is expired by the sweep, and its payment is
  marked failed.
- The sweep leaves `slots_taken` unchanged. This is the regression guard for the
  manufactured-capacity bug.
- Closing an event expires its pending rows.
- `confirm_payment_tx` resurrects an expired registration, and returns `conflict`
  rather than confirming when a live entry already exists.
- Checkout returns `already_registered` with the existing registration's id and
  checkout URL.

## Out of scope

- Making pending registrations reserve a real category slot. Considered and
  rejected: it would place slot accounting on the expiry path and destroy the
  `slots_taken == paid count` invariant, in exchange for oversell protection
  during a checkout window that is already bounded.
- Team or group registrations, where one account entering several runners is the
  intent rather than the bug.
- The stale cron target in `20260723090700_push_drain_cron.sql`, which still
  posts to the retired project ref `ytwdrsmclwghwktpupqd`. Unrelated to this
  work, but worth a separate fix.
