# Implementation Report — Payment safety and reconciliation

**Plan:** `docs/plans/2026-09-18-paymongo-provider-fees.md`
**Branch:** `feature/admin-ui-changes`
**Status:** PARTIAL — local gates pass; staging provider scenarios remain.

## Summary

Refunds now prefer the settled PayMongo payment ID already recorded in the capture inbox. Historical payments still resolve through the checkout session, and failed payment attempts cannot be selected for a refund. The expiry worker and lost checkout-response recovery have focused branch tests. Capture discrepancies create a deduplicated platform notification while keeping the capture inbox durable. Direct runner deletion can no longer remove a group order line or a pending PayMongo checkout.

## Tasks completed

- Updated `supabase/functions/_shared/refund.ts`, `payments.ts`, and `paymongo.ts` to use settled capture evidence for refunds.
- Added `20260918113000_payment_capture_review_notifications.sql` for platform review alerts.
- Added `20260918114000_safe_pending_registration_delete.sql` to remove recursive row-level security and protect ordered and provider-backed pending rows.
- Restricted group checkout redirects to the exact PayMongo checkout origin.
- Added focused tests for refund resolution, checkout recovery, nonempty expiry worker paths, capture alerts, ordered-line deletion, and checkout URL validation.

## Validation results

- Local migration replay: pass.
- Payment, capture, refund, grants, and provider-path tests: 113/113 across 11 files passed (including a later focused recovery rerun).
- Capture notification, pending registration delete, and function grants: 10/10 passed.
- Runner and admin TypeScript checks: pass.
- A full concurrent backend run had 663/669 passing. Six `backend.test.ts` failures involved shared seeded fixtures while other agents were testing. Isolated `backend.test.ts` later passed 34/34.
- A financial run passed 72/73. Its only failure was the existing organization-column allowlist missing the new optional check-in setting; the owning agent was notified.
- `git diff --check`: pass.

## Staging evidence and remaining work

Staging contains six historical PayMongo payments: four paid, one refunded, and one partially refunded. All six record an actual processor fee. The paid and refunded rows have no simple-ledger mismatch. The partial refund retains ₱20 organizer net from a ₱100 charge after a ₱74.50 refund; its original organizer net was ₱94.50. No capture inbox row exists yet because these payments predate the inbox deployment.

The new migrations and functions are **local only**. A controlled staging sandbox test still needs a fresh paid capture, duplicate and late callback, lost checkout response, and a nonempty provider-confirmed expiry. The notification must be observed in a signed-in platform account. Payout and report reconciliation should be checked against that fresh provider evidence before production promotion.

## Deviations from the plan

The direct-delete fix arose from a P1 group checkout review finding. Investigation showed the old delete policy also recursed through payments row-level security for ordinary single registrations. The follow-up migration restores single unpaid cancellation and prevents deletion of chargeable or ordered rows.

## Review

Scoped diff review found no remaining local logic or grant issue. Hosted provider behavior remains the material unverified risk.
