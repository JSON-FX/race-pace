# Group participant and whole-order refunds

Status: implemented and validated locally; public rollout remains disabled. Inherits group-checkout-architecture and existing refund_request_claim policy.

## Settled contract

Authorized organization admin/editor (or platform super-admin) previews and submits selected ticket refunds or all remaining paid tickets on one fulfilled capture. Preserve existing policy: none forbids; full returns each participant's actual organizer net after earned platform commission and processor fees; flat_fee additionally retains that organization's per-ticket amount, capped at net. Unknown/negative actual net requires reconciliation, not an invented refund. Require the administrator's expected amount when submitting.

A durable request and immutable per-line amounts precede provider I/O. Serialize all nonterminal/uncertain requests against the shared capture, including disjoint selections. Stable actor/idempotency-key replay returns the frozen selection/amount. Changed selection with the same key fails. Unknown provider outcome blocks another submission until resolved. Known provider IDs can be checked safely with GET. Successful provider evidence atomically marks only selected registrations refunded, revokes their tokens and releases their slots once. Original capture/allocations remain unchanged for audit; refund allocations feed the later reports/payout integration. Zero-value policy refunds complete locally without a provider call. Positive refunds below PayMongo's 100-centavo minimum are blocked for reconciliation.

## Tasks

1. Add request/line tables with org scope and explicit grants, preview/claim and strict provider-result application RPCs. Validate same-capture amount budget, request-key identity, policy, role and per-entry status. VALIDATE: local migration + DB tests/function-grants.
2. Add service and disabled admin endpoint using existing PayMongo refund adapter and credential-scope hash. Carry existing refund_request_id metadata; route matching signed webhook refunds to the group request. Preserve uncertain outcomes. VALIDATE: mocked-provider endpoint tests + webhook routing and Deno check.
3. Cover individual then remaining-whole-order refunds, preview amount change, duplicate/competing calls, cross-org denial, success/failure/unknown, amount/payment/metadata mismatch, zero refunds and unknown fees. VALIDATE: focused suite then full backend/shared suite excluding separate fake-provider backend.test.ts.
4. Review and document. No live PayMongo charge/refund, browser UI or hosted activation. Reporting/payout clawbacks and staff reconciliation UI remain next slices. VALIDATE: whitespace checks and report.

## Scope boundary

No changed refund policy or promise of returning processor/platform charges. Refunds of anomalous/extra captures require the separate reconciliation workflow; this slice refunds fulfilled participant allocations. Order payment history stays paid; per-participant refunded state and refund ledger describe subsequent returns. Unknown creation is not automatically resubmitted, avoiding unsafe retries after PayMongo's idempotency window. Provider fee/tax data must be reconciled first if actual allocation is unknown.

## Completion evidence

All four tasks completed for this backend slice. Full backend/shared validation passed 581 tests across 68 files, excluding the separately configured fake-provider backend harness. Deno checks and whitespace checks passed. See `.claude/reports/2026-09-17-group-refunds-report.md` and `.claude/code-reviews/2026-09-17-group-refunds.md`. Reporting/payout and UI integration remain separate activation gates.
