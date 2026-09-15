# PayMongo refund patch review — 2026-09-16

Scope: three function files, one existing integration test file, one new regression file. Earlier readiness documents remain in the working tree. No commit, push or deployment performed.

The patch maps both observed provider shapes to refund resources, keeps parked refund amounts, and treats processing as nonterminal. Captured real test notifications reconcile after the change; repeated success remains idempotent. Credentials remain ignored. No new blocking defect was identified in the bounded routing/status changes.

## Open findings in the surrounding flow

- High: `_shared/refund.ts:79` contacts the provider before recording a durable request claim. Concurrent requests can issue more than one refund. Require atomic request ownership and provider request idempotency/reconciliation.
- High: `payments-webhook/index.ts:46` skips an unmatched refund. An early callback or database lookup error can be acknowledged before the pending refund is saved. Persist/retry recognized events and distinguish lookup failure from no match.
- Medium: `payments-webhook/index.ts:68` overwrites failure metadata without guarding an already completed refund. Guard terminal transitions.

These are pre-existing release blockers, not resolved by this patch.

## Validation

- Regression red phase: 8 failed, 3 passed before implementation.
- Focused final run: 55 tests passed, plus 6 signed webhook integration tests passed (23 unrelated tests skipped by name filter).
- Provider checkout/failure/retry and original checkout webhook passed in test mode. Refund patch verified by local replay of captured provider notifications and a provider-retrieved succeeded refund, not fresh original refund delivery after patch.
- Full backend gate: 419 passed, 5 failed, 14 skipped; 8 failed suites including three fixture-setup failures. Shared fixture interference, slot-count drift, a missing organization in cleanup, a payout call returning null, and an old three-argument payout expectation need separate diagnosis. The old payout test explicitly expected paid from an API that now returns review_required.
- Whitespace check passed. No dedicated Deno static check was available; execution/import and Vitest checks are not presented as a full edge-function typecheck.

Overall release gate remains FAIL. No source changes outside this bounded patch were made to hide broader failures.
