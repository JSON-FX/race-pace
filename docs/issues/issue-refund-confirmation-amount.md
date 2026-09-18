# Refund confirmation misstates the amount
 refund drawer, confirmation and success toast advertise PHP 1000, but provider path and ledger use PHP 955. RefundModal derives its amount from total_amount instead of refund policy/net_to_org; success ignores pending/already result. Correct amount preview and outcome messaging before launch.

Observed in a real local Computer walkthrough. Next implementation must obtain a server-authorized refund preview, present retained fees clearly, and report succeeded, pending and already-refunded outcomes accurately. Preserve existing money policy and provider-first transaction flow.

## Refund feedback fixed; payout window blocker confirmed

- FIXED LOCALLY: authenticated server preview shares refund policy calculation with execution. Shows original payment, retained fees and runner refund. Submission checks expected amount before contacting provider. Pending/already responses retained; failure never reports success.
- PASS (Computer): c7b6b89a-88ad-4805-9705-cac7a527dff3 preview showed PHP 1000 / 45 / 955. Submitted refund; UI status Refunded and DB refunded_amount=95500, slots_taken=0. All three North QA registrations are now refunded. Existing North zero open payout statement is stale after this last post-payout refund; do not settle it.
- PASS: full admin suite 748 tests before final six action tests; final focused suite 21 passed; admin typecheck and whitespace check passed. Backend focused suite 33 passed plus one explicitly expected failure.
- FAIL: refund between opening and settlement allows a stale PHP 3820 statement to be marked paid when PHP 1910 remains owed. See docs/issues/issue-payout-stale-statement.md. Reproduced with authenticated RPCs and disposable fixtures, not an actual transfer.
- NEXT: prevent stale payout settlement, including new payments and fee changes between opening and payment. This is a production blocker. No hosted changes or real transfers.
