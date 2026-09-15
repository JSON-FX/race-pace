# Refund feedback implementation report

Plan: docs/plans/2026-09-15-refund-feedback.md. Branch: feature/admin-ui-changes.

Refund preview and outcome feedback COMPLETE locally. Follow-up payout-window test found a production blocker, documented separately. No payout schema fix or deployment in this slice.

## Refund feedback fixed; payout window blocker confirmed

- FIXED LOCALLY: authenticated server preview shares refund policy calculation with execution. Shows original payment, retained fees and runner refund. Submission checks expected amount before contacting provider. Pending/already responses retained; failure never reports success.
- PASS (Computer): c7b6b89a-88ad-4805-9705-cac7a527dff3 preview showed PHP 1000 / 45 / 955. Submitted refund; UI status Refunded and DB refunded_amount=95500, slots_taken=0. All three North QA registrations are now refunded. Existing North zero open payout statement is stale after this last post-payout refund; do not settle it.
- PASS: full admin suite 748 tests before final six action tests; final focused suite 21 passed; admin typecheck and whitespace check passed. Backend focused suite 33 passed plus one explicitly expected failure.
- FAIL: refund between opening and settlement allows a stale PHP 3820 statement to be marked paid when PHP 1910 remains owed. See docs/issues/issue-payout-stale-statement.md. Reproduced with authenticated RPCs and disposable fixtures, not an actual transfer.
- NEXT: prevent stale payout settlement, including new payments and fee changes between opening and payment. This is a production blocker. No hosted changes or real transfers.
