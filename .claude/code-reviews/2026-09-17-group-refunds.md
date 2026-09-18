# Group refund review

Scope: two refund migrations, groupRefund service, admin-group-refund endpoint, refund webhook routing, and the refund additions to the payment/webhook tests. Earlier Passport and group payment changes retain their separate reviews.

Production files added: 4. Production files modified: 1 (refund routing only). Existing test files extended: 2. No files deleted.

Reviewed role and tenant boundaries, request identity, shared-capture serialization, integer allocations, actual-versus-predicted fees, replay after success, credential rotation, unknown network outcomes, terminal callbacks, slot release, and explicit database grants.

Resolved during review: frozen refund amounts originally relied on application discipline. The follow-up `20260916190526_group_refund_ledger_guards.sql` now rejects updates to request identity/terms and all line updates. It also validates tenant/capture scope on insertion. The first migration was already applied locally, so it was not edited.

No remaining blocking technical findings within this disabled backend slice. Public activation remains blocked by reporting/payout integration, refund reconciliation operations, provider sandbox verification and grouped UI work. Provider responses must include request metadata and actual fee allocations; missing evidence parks or rejects the refund rather than guessing. Unknown POST outcomes never automatically resubmit.
