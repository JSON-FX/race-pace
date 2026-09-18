# Local webhook signing mismatch

User-authorized readiness investigation, 2026-09-16. No external issue created.

Severity low for application behavior, high for trustworthy local verification. Complexity low; confidence high.

## Evidence and cause
Registration-gate tests returned 401 in two late-capture cases. Both registration-gate.test.ts:600 and backend.test.ts:55 hardcode a historical signing key. payments-webhook/index.ts:16 reads PAYMONGO_WEBHOOK_SECRET from the runtime environment. The local functions environment differs after PayMongo test-mode configuration. The signature gate correctly rejects the stale test signature.

This is a longstanding test configuration assumption, not a production signature-verification defect. The duplicates were introduced before current provider testing.

## Fix
Use a shared test-only signer that reads the same local functions environment file without mutating process.env. Support an explicit file path for custom serve configurations. Require a loopback API target and a nonempty secret; fail clearly without printing it. Do not change provider credentials or application verification. Replace both duplicated signers and add configuration/signature tests.

## Validation
Run the signer tests, all registration-gate tests and signed webhook backend tests. Run commission/refund, processor-fee and payout lifecycle suites. Existing fake-checkout-only backend assumptions are a separate runtime-mode constraint. No hosted mutations, commit, push or deploy.


## Follow-up during validation
Once signatures passed, three signed refund tests exposed a second fixture assumption: paidRegistration calls fake-checkout and ignores its response. That endpoint correctly returns 404 while PayMongo is configured, so the fixture remained pending. The signed-refund group now seeds a fake pending payment and confirms it through the actual signed webhook, asserting paid state before the refund callback. This avoids external provider calls and leaves the separate checkout-mode tests intact.
