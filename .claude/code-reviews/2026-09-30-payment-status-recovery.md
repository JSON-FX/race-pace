# Payment status recovery review

Code review passed. No unresolved technical findings in the scoped change.

Reviewed the webhook route, capture parser and settlement guard, reservation verification,
group verification, queue migration, grants, health watchdog and reservation return component.
The existing atomic settlement functions retain session, amount, currency, live/test mode,
capacity, duplicate-capture and payout-hold checks. No status-only repair was introduced.

## Findings corrected during implementation

- A failed durable capture write previously returned the same error as a persisted review.
  The webhook could acknowledge a database failure. It now returns a retryable error.
- A succeeded intent can precede visibility of detailed payments. The bare-event path retries
  that snapshot without permanently putting its capture into review.
- Signed duplicate payment events can omit fee fields. Previously verified fee values are
  retained for that same durable capture; supplied conflicting values still trigger review.
- Superseded payment intents are recorded for review without assigning them to the current
  session. Different checkout identities are rejected.
- Queue leases cannot be completed twice; crashed runs become eligible again. An independent
  database watchdog observes stale workers, even when the HTTP function cannot run.

## Validation

- Fresh local replay: 179 migrations; explicit service-only table/view/RPC grants verified.
- Full backend/shared suite: 871 tests passed. Final focused tests after replay: 37 passed,
  including the new health tests and added capture regressions.
- Runner: 530 tests passed. Admin: 1,018 tests passed. Shared UI: 13 tests passed.
- Runner, admin and shared UI typechecks passed. Fieldnotes component audit passed.
- Runner and admin optimized production builds passed in the isolated task worktree.
- No live provider payment, production record change or hosted deployment was part of these checks.

Hosted provider acceptance, exact-commit deployment identity and production recovery remain
release gates. The recurring worker covers bound pending checkouts; historical failed/expired
checkout verification is a separate incident sweep. Review holds require operator resolution.
