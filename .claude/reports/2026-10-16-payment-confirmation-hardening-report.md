# Payment confirmation repair and focused hardening

## Result

Repaired the approved pre-screening branch in `booking_payment_confirm`. The payment-attempt
record `a` shadowed the pre-screening alias and raised SQLSTATE 42703. Capture evidence was
previously inserted inside that same transaction and rolled back with fulfillment.

The group payment service now records verified provider captures before ticket generation
and fulfillment. Existing reconciliation retries stored evidence without another provider
request. Runner and organizer screens distinguish processing from paid. Authorized admin
retries are audited and cannot force a review capture to paid.

## Scope and safeguards

- Additive migration; older Edge bundles can still use the confirmation RPC.
- First stored provider evidence remains immutable on replay.
- Signed notifications require evidence for the exact notified payment before acknowledgement.
- Received captures block duplicate checkout, discounts, hold release and settlement.
- Existing capacity engine retained. Observation cannot revive an expired slot claim.
- Tenant-scoped progress hides diagnostics from runners. Raw payloads stay service-only.
- Business mismatches remain under review; tickets and allocations remain atomic.

## Local validation

- Backend/shared full suite: 118 files, 1,034 tests passed before the final capacity refinement.
- Final capacity refinement: 23 recovery/grant tests and 102 related integration tests passed.
- Runner full suite: 77 files, 554 tests passed; final targeted booking suite: 8 tests passed.
- Admin full suite: 131 files, 1,085 tests passed; final detail suite: 16 tests passed.
- Both app type checks and production builds passed.
- Shared UI types and 13 tests passed. Component audit: no remaining or duplicated primitives.
- Frozen Deno graph and type checking for the three affected Edge entry points passed.
- Webhook/reconciliation focused suite: 17 tests passed.
- Final clean migration replay: 182 versions passed. Final backend/shared suite: 118 files, 1,037 tests passed.

The reset local gateway retained an obsolete Auth upstream and returned 502 during the first
post-reset run. Restarting that isolated gateway restored Auth health; the unchanged full suite
then passed. This was a local test-stack issue, not a source change.

The first runner production build hit a transient Google font loader failure. An unchanged
retry completed successfully. No dependency or font configuration change was needed.

Independent review found two issues during implementation: unsafe capacity-claim revival,
and acknowledgement without the exact notified payment. Both were corrected and covered by
regressions. The final independent review passed with no remaining blockers.

## Release boundary

Verified Option B activation. Feature work uses an isolated branch from main, with a PR to
main. Required integrated CI deploys staging. The production environment requires the owner's
separate approval and administrator bypass is disabled.

Hosted staging acceptance remains required. Production deployment and recovery of the
reported payment are explicitly deferred until the owner sees and approves those results.
No production data was changed during implementation.

## Rollout and recovery

Apply the additive migration first, then deploy Edge functions and both apps from the same
candidate. Confirm test-mode pre-screened payment, organizer paid status, signed ticket,
allocation invariant, replay, and received-capture recovery on staging.

After explicit production approval, deploy that accepted candidate and inspect live identities.
Recover the reported payment through provider verification and the normal confirmation path.
Never manually patch a registration's paid flag. If app rollback is necessary, retain durable
capture evidence and use a reviewed compatible Edge bundle or forward migration; database
writes are not rolled back by an app rollback.
