# Open payout statement can settle an outdated amount

Confirmed locally on 2026-09-15. Production blocker.

Reproduction uses a disposable organization with two PHP 2000 entries, each net PHP 1910. Open a PHP 3820 statement. Refund one entry for PHP 1910 before marking the statement paid. payout_mark_paid returns paid and leaves net_owed_cents=382000 even though current payable net is 191000. Test ran through an authenticated platform admin. Fixture cleaned up.

Root cause: payout_open_statement stores aggregates. payout_mark_paid stamps the current unstamped payment rows without checking that their membership or amounts still match the saved statement. Refunded rows drop out of the earn stamp. The stale total remains payable; a later statement may never recover the unstamped refunded row. New payments between opening and settlement are another required test case.

Reproduction: supabase/tests/payout-statements-v2.test.ts, KNOWN test. It is explicitly marked it.fails to retain the known failing requirement. It was also run without that marker and failed exactly at expected paid refusal. Evidence: /tmp/rp-payout-window-failure.log. This expected failure is NOT a readiness pass.

Next fix requires a forward migration and an explicit policy for changed statements: invalidate/recalculate and require fresh review before recording a transfer, with atomic locking and coverage for refunds, new entries, partial refunds, fee corrections and concurrent mutation. Do not silently change an amount after a transfer reference has been submitted. No payout database fix was applied in this slice.

## Stale payout settlement fixed locally — 2026-09-15

- Migration 20260915123631 saves payment financial snapshots and statement revisions. Open/refresh/settle lock registration and payment writes for their short transaction, preventing changes between comparison and stamping. No network work occurs while locked.
- Settlement refuses changed financial rows and old caller revisions without writing payment stamps or a transfer reference. Legacy three-argument callers fail closed with review_required. Existing open statements need explicit refresh; paid history remains unchanged.
- Admin now offers Refresh statement and sends the reviewed revision. Refresh recalculates the original accounting formulas and increments revision; it never marks a statement paid. Reopening a settlement dialog clears old references/errors.
- PASS: full refund window regression, new entries, partial refunds, processor corrections, stale caller after refresh, concurrent duplicate settlement, simultaneous refund/settlement, replay, organization-admin refusal and function grants. Final backend run: 32 passed, zero expected failures.
- PASS: full admin suite 754 passed; final payout page checks 6 passed, typecheck and diff check passed.
- PASS (Computer): old North statement 87ed5a86-ba10-4528-b3c2-e8449efbbded rejected QA-STALE-MUST-REJECT without marking paid. Explicit refresh changed zero to PHP -955 recovery. Reviewed and recorded simulated recovery QA-SIMULATED-RECOVERY-20260915-002. UI now shows three settled statements, net PHP zero. No real transfer.
- Deployment: local only. Migration must precede updated admin deployment; old clients deliberately cannot settle. Snapshot function internal only; refresh and settlement recheck super-admin authorization. Hosted not changed.
- Limitation: conservative table locks serialize payout work across events and briefly block writes; load/latency validation is still required before production volume. This protects ledger recording, not manual transfers made outside the app before review. Real payment provider lifecycle and production readiness remain unverified.
