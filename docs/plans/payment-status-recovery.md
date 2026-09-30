# Payment status recovery

Source investigation: [production paid-status incident](../issues/issue-production-paid-status-sync-2026-09-30.md).

Status: implemented and released through PR #212. [Production verification](../operations/payment-status-recovery-production-20260930.md) records customer recovery, provider replay, and recurring safeguards.

## Implementation

- Resolve single-registration `payment.paid` notifications against the bound provider checkout. Preserve canonical checkout handling and durable duplicate/extra-capture checks. Failed inbox writes must return retryable responses.
- Reconcile bound pending reservation, single-registration and group checkouts every five minutes. Use existing settlement functions. Claim at most 20 jobs with leases and oldest-attempt ordering; process four independent jobs concurrently. Never create or expire a provider checkout in this worker.
- Store service-only reconciliation outcomes. Inspect this environment's PayMongo webhook and notify platform operators on disabled/missing delivery. An independent SQL watchdog reports stale worker completion and overdue verification.
- Verify every pending reservation visit with six bounded attempts. Preserve return intent through sign-in. Stop timers when the component unmounts or payment reaches a terminal result.

## Validation and delivery

1. Regression tests for both notification shapes, early visibility, replay after retention, wrong checkout, extra capture, durable-write failures and invalid signature.
2. Database tests for all three candidate kinds, lease exclusion/recovery, private grants, review/paid exclusion, and deduplicated health alerts. Worker tests for authorization, provider errors and independent settlement routes.
3. Page/callback tests, full local CI, code review, then a staging pull request.
4. Deploy the exact staging migration and changed function dependencies. Configure the HTTP worker using the staging URL and existing worker secret. Exercise provider test captures and recovery with webhook delivery absent.
5. Promote staging to main, configure the production worker, reconcile the verified real capture, then enable the repaired live webhook. Read back capture, reservation/registration, reports, amounts, provider delivery and schedules. No synthetic production data or live test charge.

## Operational limits

The recurring worker covers bound pending checkouts. Provider outages retain pending state and raise operational alerts; no software can guarantee provider availability. Failed/expired/historical checkout audits remain an explicit incident sweep. Durable capture review holds are never cleared automatically.
