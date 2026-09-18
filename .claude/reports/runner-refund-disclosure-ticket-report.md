# Runner refund disclosure and ticket verification

Plan: docs/plans/2026-09-16-runner-refund-disclosure-ticket.md
Branch: feature/admin-ui-changes
Status: COMPLETE locally

Added policy notices to registration review and payment. Admin full-policy labels now describe refunds excluding fees. Money calculations, enum values, and backend grants remain unchanged.

Fixed historical QR tokens displaying an active pass after refund. Paid tokens retain the race pass; paid missing tokens offer recovery. Terminal payment bookmarks cannot restart checkout and explicit server refusals cannot use a stale checkout fallback.

Validation: site347tests/34files; admin756tests/92files; both typechecks; whitespacecheck. Computer verified local owner sign-in, refund disclosure, real provider test-mode payment return to correct owner ticket, My Races navigation, cross-owner refusal, provider refund and invalidated owner ticket/payment bookmark. All payment activity test-only. Temporary webhook/tunnel stopped.

Deviation: lifecycle investigation exposed the adjacent old payment-bookmark/refusal fallback bug, fixed with eight additional regressions. No monetary policy change. Registration review was inspected before the waiver and was not submitted. QA owner/account and initial pending registration were created through the authorized local API fixture flow.

Git: fetched origin; branch already contains mainf13f4bb, ahead1/behind0. No merge/rebase needed. No additional design updates on main; external design reference not supplied. Current changes stay uncommitted; no push/deploy.

Remaining app readiness work is in the end-to-end checklist, including race-day operations, reports/exports, pending-provider UI, notifications and hosted parity.
