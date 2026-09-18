# Durable refund requests implementation

Branch: feature/admin-ui-changes. Inherit docs/specs/refund-request-ownership.md and docs/issues/issue-paymongo-refund-events.md. Existing uncommitted readiness work stays intact. No commit or hosted deploy included.

1. Add service-only request/inbox schema and atomic claim/bind/reconcile RPCs in a new migration. Preserve registration→payment locks, immutable money terms, legacy pending state and terminal success. Validate migration and new refund-requests tests plus function grants.
2. Update shared provider contract: stable Idempotency-Key and request metadata for POST, GET refund status for pending reconciliation. Keep fake provider deterministic. Validate provider adapter unit tests.
3. Replace refund orchestration with DB claim, provider operation and atomic result reconciliation. Persist callbacks before applying them. Keep preview read-only and use existing pending/error UI contract. Validate signed backend refund tests, concurrency tests, and local API scenarios.
4. Repair test gate assumptions without altering QA data: serialize files, remove obsolete empty-seed-event requirement, use current payout signature. Validate full pnpm test on simulator-only runtime; preserve and restore user's test credentials.
5. Repeat Computer + PayMongo test-mode payment/refund callback with temporary webhook relay, record exact actual fees/outcomes, then disable relay. Review changes and update readiness evidence.

Acceptance: one logical provider refund per concurrent request group; no lost early callbacks; no terminal success reversal; immutable amount across retries; explicit grants verified; full backend gate passes; Computer outcome verified. Uncertain requests older than the provider's retention window are blocked from automatic POST and reported for review. New behavior remains local until separately deployed.

Validation: pnpm exec vitest run supabase/tests/refund-requests.test.ts supabase/tests/function-grants.test.ts; pnpm exec vitest run supabase/tests/paymongo-refund-events.test.ts; pnpm exec vitest run supabase/tests/backend.test.ts; pnpm test; git diff --check. No lint command is provided by this repository. Runtime and selected type checks must be reported precisely.

Assumptions: no new policy choices, no real transfers, and no migration edits applied to hosted Supabase. Durable inbox retries are driven by callback delivery, binding, and authenticated refund checks; no always-on scheduler is introduced.

## Completed local verification — 2026-09-16

- Migration20260915174500 applied and recorded in local history. Hosted unchanged.
- Full backend:48files /457tests passed. Full admin:92files /756tests passed. Admin typecheck and git diff --check passed. Deno standalone typecheck unavailable on host; Edge Functions executed in local Supabase runtime.
- Repaired legacy preview mocks for the authoritative RPC boundary. Full backend fixture failures resolved by serialization/current payout revision API and nonempty seeded event support.
- Review caught a second distinct successful refund after a failed attempt/retry. Added durable review_required discrepancy, refused automatic claims and clean webhook/action success, and tested small partial double success. Final follow-up review passed.
- Computer: fresh PayMongo GCash test checkout, livemode=false. Event592bae02-d354-43f6-8572-4090ea4093db; registration2179ad95-0379-4d9d-8ca6-7f7c1419829c; checkoutcs_b5694579547a87ca606ec373; paymentpay_pyL947jqP829ctdMCmndwpdL.
- Original checkout callback returned200. Actual gross100000centavos, processor2500, commission0, organizer97500.
- Computer admin preview: originalPHP1000, retainedPHP25, returnPHP975. Submitted via Confirm refund. Provider refundref_WUB61U8gaYCqNWdtwqFr5JtS succeeded. Both original payment.refund.updated and payment.refunded callbacks returned200 without manual replay. Database: one succeeded request, review_required=false, one refund audit, refunded_amount97500, categoryslots_taken0. Admin visibly shows Refunded and PHP975 refund summary.
- Temporary provider webhook disabled, relay and tunnel stopped. User's local test credential/runtime restored. No commit/push or hosted deployment.
- Pending status Check refund status is component-tested; provider completed quickly, so that button was not exercised on a naturally pending browser refund. Owner ticket browser confirmation remains a separate checklist item.

## Refund fee clarification

User confirmed intent that the original processor fee remains retained on cancellation. PayMongo documents that transaction fees are not returned, but permits refunding the full original payment amount if the merchant covers that cost. Current app policy refunds net after retained fees, so the test returnsPHP975 ofPHP1000. Do not describe this as an unconditional full original-payment refund. Review runner-facing policy disclosure/labels before pilot.

Sources: https://docs.paymongo.com/do/docs/payment-acceptance-disputes and https://docs.paymongo.com/docs/payment-acceptance-refunds (verified2026-09-16).
