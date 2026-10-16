# Preserve paid group checkouts through registration failures

Status: implementation approved; staging acceptance required before production approval.

## Problem and scope

A paid, approved pre-screening checkout failed in `booking_payment_confirm` because the
`a` payment-attempt record shadowed a pre-screening SQL alias. PostgreSQL raised 42703.
The capture insert shared the failed transaction, so both the payment evidence and
registration update rolled back. Provider and worker retries repeated that failure.

Fix that branch with a follow-up migration. Extend the existing group capture table,
reconciliation worker, and checkout screens so an unexpected fulfillment failure keeps
durable evidence and can recover safely. This does not replace the payment engine.

## Invariants

- Retrieve a payment from its server-bound PayMongo session before observing it.
- Commit the provider capture in a separate database call before minting tickets or
  fulfilling the registration. If that write fails, do not acknowledge the webhook.
- `received` means payment observed and registration processing. It is not a settled
  registration, issued ticket, or organizer payout allocation.
- Consume the persisted capture during confirmation. Never overwrite it on replay.
- Payment ID uniqueness, event/order locks, and one fulfillment per order prevent
  duplicate tickets, slots, allocations, and delivery requests.
- Preserve every amount, currency, mode, ownership, deadline, approval, capacity,
  and fee check. Business mismatches remain `reconciliation_required` for review.
- Prevent another checkout, cancellation, or hold release while a capture is unresolved.
- Recover persisted captures without relying on another provider notification or GET.
- Scoped runner and organizer views expose progress, not raw provider payloads.
- An authorized organizer or platform administrator can request a logged retry of
  processing captures. Retry cannot clear a business review or force a paid state.

## Operational behavior

The existing five-minute reconciliation worker also selects received captures, even if
their attempt has stopped being a normal pending candidate. It first retries durable
evidence. Temporary provider failures retain the existing retry path. Fulfillment failures
record a safe error code, attempt count, and timestamps on the capture; SQLSTATE class 42
identifies code errors. Existing overdue alerts must include unresolved captures.

Runner checkout shows “Payment received. Registration processing.” and suppresses pay,
discount, and cancel actions. Organizer registration rows and details show this state
separately from paid. Administrators see safe diagnostic details and a retry control.
Business-review captures show “Payment needs review” and cannot use that retry control.

## Release boundary

Option B is active. A feature PR targets `main`; integrated CI deploys its exact revision
to staging. The protected production environment must remain awaiting owner approval.
No production data is changed and the reported payment is not recovered during this task.
After staging acceptance, present results and the exact candidate for production approval.
