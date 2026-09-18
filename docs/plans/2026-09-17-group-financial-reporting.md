# Group financial reporting and payouts

Status: implemented and validated locally. Inherits docs/specs/group-checkout-architecture.md; no unresolved product decisions. Preserve legacy financial semantics and historical totals. Group checkout remains off.

## Contract and architecture

Payments list/CSV: one fulfilled provider capture, null registration_id, real payment_id (capture UUID for groups, payments UUID for legacy), booking_order_id and participant_count. Never substitute a lead participant. Group refunds retain earned commission and processor fees, so a successfully refunded allocation has financial status partially_refunded while its registration is refunded. Actual unknown processor/net remain null and visibly unreconciled.

Participant reports: safe admin_group_allocations_v with registration_id, org_id, event_id, event_name, user_id, full_name, category_label, created_at, paid_at, booking_order_id, payment_id, participant_count=1, amount,platform_fee,processor_fee_cents,processor_fee_source,net_to_org (current after refunds),refunded_amount,method,status,payout_statement_id,payout_clawback_id. Authorization resides in a fixed-search-path SECURITY DEFINER function over private ledgers, filtered by auth_can_admin_org. Only safe fields exposed, no provider raw or credential scope. Existing views remain security_invoker. Add authorized function to explicit grant audit allowlist.

Payouts: preserve legacy functions/arithmetic under service-only renamed helpers. Wrappers add group allocation totals/stamps and include captures/refunds/allocations in snapshot comparison. Two stamps distinguish pre-settlement refunds (netted once) from later refunds (clawed back once). Unknown actual fees, active refunds or reconciliation captures block settling group money. Serialize group capture/refund mutation and payout entry points through one transaction advisory lock acquired before existing locks to avoid inconsistent snapshots or deadlocks. Original captures and monetary allocations remain immutable; only payout stamps added.

## Tasks and validation

1. Database migration: authorized allocation reader, capture-grain payments union, registration financial view + aggregates, org/event totals, group payout stamps and guarded wrappers. Read latest live SQL via pg_get_functiondef to preserve signatures. VALIDATE: local migration, function grants and group database tests.
2. Payments/registration list and CSV adapters: real payment/order identifiers, nullable actual money, correct navigation and stable paging. Assigned frontend scope may run independently once contract is frozen. VALIDATE: relevant web tests and typecheck.
3. Settlement and commission consumers: merge participant allocations with legacy rows, maintain entry-based averages, show unknown money explicitly, include unsettled group net. Handle new payout reconciliation refusal. VALIDATE: focused web tests and typecheck.
4. Cover mixed legacy/group totals, cross-org denial, one-capture export versus multiple registrations, individual refund before/after settlement, stale statement refusal, no repeated payout/clawback, unknown money blocks. VALIDATE: full backend/shared tests excluding separately configured fake-provider backend.test.ts; web tests; Deno checks for any changed edge files; git diff --check.
5. Review/report and roadmap update. No commit/push/deploy. Browser acceptance remains deferred until grouped UI exists; use in-app browser for any available changed admin screen.

## Remaining gates

Provider reconciliation operations and anomaly detail UI, free fulfillment, recovery/expiry/email workers, grouped checkout UI, real sandbox refund/payment and full browser journey. Reconciliation captures are blocked from payout and counted as unresolved; financial rows in this slice include fulfilled captures only.

## Completion evidence and amendments

2026-09-17: tasks completed within the stated fulfilled-capture scope. Backend587/web853 tests passed, web typecheck and whitespace passed. In-app browser Payments/Commission smoke passed. Browser-discovered oversized Commission category URL fixed with chunked/paged reads. Provider anomaly detail UI and group refund completion-date export remain noted limitations. See `.claude/reports/2026-09-17-group-financial-reporting-report.md` and `.claude/code-reviews/2026-09-17-group-financial-reporting.md`.
