# Implementation Report — group provider dispatch and atomic confirmation

**Plan**: docs/plans/2026-09-17-group-payment-capture.md
**Branch**: feature/admin-ui-changes
**Status**: COMPLETE for internal paid-order dispatch/confirmation; public group checkout remains PARTIAL and disabled.

## Summary

Added a PayMongo V1 adapter, durable session dispatch, authenticated verification and atomic group fulfillment. The server freezes the exact request and attempt-specific provider idempotency key before network I/O. Concurrent/repeated clicks reuse a stored session; uncertain creation blocks another charge. Confirmation stores each captured payment once, creates distinct signed participant tickets, allocates actual processor fees and queues delivery in the same transaction.

Late captures either reallocate the entire group or become a durable reconciliation incident. Mismatched amounts/currency/environment, extra captures and capacity conflicts never produce partial tickets. Missing actual fees remain null in actual allocations; the earlier predicted quote remains separate.

## Files

- CREATE supabase/functions/_shared/groupPaymongo.ts and supabase/tests/group-paymongo.test.ts: provider adapter, itemization, safe response parsing, idempotency, bounded network requests, strict concrete-paid extraction.
- CREATE supabase/migrations/20260916174821_group_payment_capture.sql: private dispatch/capture/allocation/delivery ledgers, service-only claim/bind/unknown/confirm routines. Applied locally only.
- CREATE supabase/functions/_shared/groupPaymentService.ts and supabase/functions/group-payment/index.ts: booker authorization, trusted return URL, session dispatch, authoritative retrieval and signed ticket generation.
- UPDATE supabase/functions/payments-webhook/index.ts: verified group metadata routes to stored-session verification; unbound sessions and temporarily invisible captures are retried.
- UPDATE supabase/tests/group-payment-preparation.test.ts: eight group dispatch/capture scenarios using real local Auth, Data API and Postgres with the provider transport mocked.
- CREATE supabase/tests/group-webhook-routing.test.ts: four routing/signature/availability/retry checks.

## Validation

- Provider adapter: 23 deterministic tests passed, using mocked fetch; no real PayMongo requests.
- Focused provider + database preparation/capture + grants: 50 passed before the final webhook/UUID-normalization checks.
- Final focused kit-release + preparation/capture + webhook rerun: 29 passed.
- Deno typechecks passed for group-payment, its service/adapter and payments-webhook.
- Actual local group-payment HTTP endpoint returned 503 group_checkout_not_available, confirming default-disabled rollout.
- Full final backend/shared suite: 565 tests passed across 68 files, no skips (75.76 seconds).
- Tracked diff and all new slice files passed whitespace checks.
- No browser group checkout, PayMongo sandbox charge, printed QR scan or production build claimed.
- Separate fake-provider backend.test.ts remains excluded under the existing local PayMongo configuration.

## Review corrections

- Group provider metadata is consistently booking_order_id/payment_attempt_id. Malformed paid payment IDs fail verification instead of disappearing as unpaid.
- Provider idempotency uses the canonical database UUID even when input uses uppercase UUID text.
- A paid webhook whose provider GET still reports no concrete capture returns 503. It cannot silently acknowledge and lose that notification.

## Issues encountered

First broad run had a kit-release network fetch failure and eight conditional registration-gate skips after its health probe failed. Focused rerun passed; final broad validation is recorded above. No checks were weakened.

## Remaining activation gates

- Actual PayMongo TEST/browser experiment and provider fee-shape validation; no real charge was made in this slice.
- Free-order atomic confirmation (session creation currently explicitly refuses zero-gross orders).
- Refund execution for group/partial/extra/late captures and staff reconciliation workflow. Incidents are durable but refunds are not submitted automatically yet.
- Recovery worker for uncertain creation. It must use the saved exact request and original key within PayMongo's 24-hour window, not a new attempt; unknown attempts currently stay blocked.
- Explicit provider session-expiration worker. Local hold expiry does not expire a PayMongo session.
- Delivery worker: outbox records are committed, email is not sent yet.
- Group financial reporting/payout integration and grouped registration/payment/ticket UI. New actual allocations are deliberately separate from legacy payments to avoid duplicated provider gross.

No hosted migrations, commits, pushes or deployment. GROUP_PAYMENTS_ENABLED remains unset in the running stack. All group features must remain disabled for customers until these gates are complete.
