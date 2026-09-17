# Implement provider-calculated PayMongo fees

Status: in progress. Branch: `feature/admin-ui-changes`. Goal: keep the advertised runner price fixed for the pilot while deriving the actual processor deduction from the captured PayMongo payment. This follows [the spec](../specs/paymongo-provider-fees.md). The user clarified that Race Pace's fee and PayMongo's fee come out of the ₱100 price. The earlier pass-on implementation remains unapproved for the pilot; group checkout stays gated.

## Tasks

1. Add a follow-up migration for immutable checkout fee-mode and platform-fee snapshots on single payments. Preserve historical rows. Audit grants. Validate with local migration replay and function-grant tests.
2. Extend the PayMongo adapter to create `/v2/checkout_sessions` when pass-on is requested. Send `pass_on_fees: true`, base and platform line items, and stable registration metadata. Continue retrieving checkout sessions through the documented `/v1` GET. Test request body and parsing with a fetch stub.
3. Create one session at registration. Freeze terms with the payment row. Reuse that PayMongo session at payment for absorb and pass-on; never mint an untracked second chargeable URL or fall back to a stored URL after a failed eligibility check. Validate registration and payment-session integration tests.
4. Change the runner pay page to show a known pre-processing subtotal and state that PayMongo sets the processing fee and final total. Do not read `processor_rates` or quote a local processing amount in pass-on mode. Validate component tests and typecheck.
5. Make single-payment confirmation fail closed when a real PayMongo capture lacks valid gross/fee/net values. Use the frozen platform fee, reconcile `payments.amount` to provider gross, and require provider net to cover the agreed entry plus platform fee in pass-on mode. Preserve fake-provider tests and legacy completed rows. Validate webhook replay, retry, refund and ledger tests.
6. Replace the gated group-payment preparation, provider request, and capture allocation with provider-managed fees. Use a follow-up SQL migration, preserving old migration files. New quote totals are pre-processing only. Confirm group captures against the frozen subtotal and distribute actual surcharge and fee deterministically. Validate group preparation, capture, refund, report and function-grant tests.
7. Verify the fixed-price absorb checkout on staging first. For a ₱100 entry, prove that PayMongo charges ₱100, records the actual fee, and leaves `10000 - platform_fee - processor_fee` centavos for the organizer. Complete sandbox payments for each enabled method with user handoff, then reconcile browser, provider and database amounts. Keep production unchanged until the test matrix passes.
8. Before launch, expire abandoned/cancelled/paid sessions through PayMongo, record mismatched or duplicate captures durably, and alert for manual reconciliation. A frozen checkout request plus PayMongo idempotency key now recover uncertain creation within 23 hours; the controlled live recovery test is pending. Validate refund and settlement behavior after fee changes.

### Task 8 sequence

1. Add a service-only, row-level-security-protected capture inbox keyed by PayMongo payment ID. Store the provider amount, fee, net, session, registration, and raw evidence before attempting fulfillment. Mark an extra, mismatched, or late capture for review. Validate the database function and grants locally.
2. Make both webhook and redirect verification use the inbox through their shared confirmation path. A replay of the same payment must be harmless; a different paid payment must remain visible and must never mint a second ticket. Validate focused confirmation tests.
3. Block opening, refreshing, and marking paid a payout statement while that event has an unresolved capture. Validate payout tests, including replay and extra-capture cases.
4. Add explicit PayMongo checkout expiration and a scheduled staging worker. Never mark a provider session expired on an uncertain response. Fetch a paid session into the capture inbox instead. Validate failure, ongoing-payment, paid, and already-expired responses before enabling the schedule.
5. Run a controlled staging test for lost checkout response, session expiry, and duplicate/late capture using synthetic entries. Reconcile provider, inbox, payment, ticket, and settlement. Keep production untouched.

## Checks

Run focused unit/integration tests after each task, then site and admin typechecks/tests, root backend suite against isolated local Supabase and fake Edge provider, `git diff --check`, and a scoped code review. Record exact staging evidence and remaining risks in `docs/operations/launch-progress.md`.

## Safety

Never edit an applied migration. No live PayMongo charge, production migration, or sample production data is authorized by this plan. A sandbox checkout may be created automatically, but final payment entry remains a user handoff under browser policy.
