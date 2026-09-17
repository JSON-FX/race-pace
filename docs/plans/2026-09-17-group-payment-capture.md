# Group provider dispatch and atomic confirmation

Status: implemented locally for paid-order dispatch/confirmation; validation in linked report. Builds on group-payment-preparation and group-checkout-architecture. No open product questions: same-category groups, immutable attempts, one capture fulfills the whole order, individual signed tickets, and explicit reconciliation on mismatches/extra captures are inherited decisions.

## Scope

Implement internal PayMongo V1 session dispatch and authenticated verification, with service-only durable request/session/capture storage and atomic registration/financial allocation confirmation. Public flags remain disabled. No live-money calls. Refund execution, automatic expiry worker, reporting/payout integration and grouped browser UI remain subsequent release gates.

## Tasks

1. Provider adapter: freeze itemized request with order/attempt metadata, stable Idempotency-Key and strict response/capture parsing. Return every concrete paid capture; no failed-payment/intent-only fallback. Missing fees remain unknown. VALIDATE: group-paymongo tests and Deno check.
2. Migration: private durable dispatch records, capture ledger and participant allocations with org_id, explicit RLS/grants. Single dispatch claim; unknown outcomes block fresh attempts. Record returned session before exposing URL. Atomic confirmation checks frozen amount/currency/environment/session/order, then all registrations/capacity together. Persist mismatches/extra captures for reconciliation without partial tickets. VALIDATE: local migration + DB concurrency/replay/rollback tests and function grants.
3. Internal endpoint: verified booker, server-configured return URL and flags; session action freezes/claims before provider I/O; verify action retrieves stored provider session and processes paid captures. Use per-registration signed token and a durable delivery-pending record after fulfillment. Webhook integration may route only bound group session metadata through the same verification path. VALIDATE: handler tests, provider mock tests, Deno checks.
4. Review, full backend/shared validation excluding separate fake-provider backend.test.ts, update report/roadmap. No hosted deployment or browser charge claimed. VALIDATE: git diff --check plus new-file whitespace.

## Invariants and failure behavior

- Price/actor/provider payload never comes from client input. Dispatch request is immutable, and only one caller receives permission to create a provider session. Existing ready sessions are reused; unknown/creating outcomes do not get automatically redispatched.
- PayMongo idempotency is retained 24 hours; Checkout Sessions do not auto-expire. No automatic retry after uncertainty window or assumption that local expiry cancels a provider session.
- A capture is recorded once by provider payment ID. Same capture replay is a no-op; another capture for an already fulfilled order becomes reconciliation. No duplicate legacy payment rows are manufactured.
- Confirmation locks category, order, attempt and registrations. Expired group holds reallocate all slots or none. Cancellation, changed entries, duplicate event entries, unavailable capacity or provider mismatches preserve the capture and create a durable reconciliation requirement.
- Actual fees are allocated by stable largest remainder. Missing actual fee retains null actual/net allocations, blocking any future paid-out claim until reconciled. Predicted quote stays separate.
- Delivery outbox insertion is atomic with tickets. Email sending itself and refunds need later workers.

Official references: https://docs.paymongo.com/reference/idempotent-requests , https://docs.paymongo.com/reference/checkout-session-resource , https://docs.paymongo.com/reference/expire-a-checkout-session . Existing code: _shared/paymongo.ts, _shared/ticket.ts, booking_order_prepare_payment and group reservation capacity guard.


## Outcome and boundaries

See [implementation report](../../.claude/reports/2026-09-17-group-payment-capture-report.md) and [review](../../.claude/code-reviews/2026-09-17-group-payment-capture.md). Provider calls are covered by deterministic mocks; no PayMongo sandbox charge or browser group walkthrough is claimed. Zero-gross order confirmation, reconciliation/refund execution, uncertain dispatch recovery, provider expiry, delivery, reporting and grouped UI remain explicit activation gates.
