# Group refunds: local backend implementation

Supports refund previews and submissions for selected tickets or every remaining paid ticket in an order. Authorized organization admins/editors and platform admins use a verified identity. Bookers alone cannot refund. The default-off `GROUP_REFUNDS_ENABLED` switch controls new endpoint submissions; signed callbacks for existing requests remain routable.

The existing policy is preserved: each ticket's actual organizer net is refundable. Processor costs and earned commission remain retained. `flat_fee` additionally retains the configured amount per ticket. Missing/negative actual net blocks a refund. Zero-value refunds revoke the selected tickets locally without provider I/O. Positive amounts below PayMongo's 100-centavo minimum are refused.

One durable request reserves the shared capture before provider I/O. Stable keys freeze the selection, policy and amount. Concurrent/unknown requests block new refunds, even for other tickets in that order. A known refund ID can be reconciled with GET. API-key rotation cannot silently replay a request under another credential. Failed refunds leave tickets valid and permit a new explicit request. Successful results atomically revoke only selected QR tokens and release their slots once. Original capture/fee allocations remain intact; separate refund lines record returns and retained net.

Provider evidence must match payment, amount, currency, environment, request metadata and refund identity. Mismatches require review. The signed webhook handles early callbacks and does not downgrade completed success after a delayed pending response.

## Validation

- Initial focused backend tests: 40 passed across 2 files.
- Deno checks: admin-group-refund and payments-webhook passed, including imported refund service.
- Full backend/shared suite: **581 tests passed across 68 files**, no skips, 78.62 seconds. Command: `pnpm exec vitest run --exclude supabase/tests/backend.test.ts`. The separate fake-provider `backend.test.ts` harness was excluded under this local PayMongo setup.
- `git diff --check`: passed.

Local migrations: `20260916185720_group_refunds.sql` and `20260916190526_group_refund_ledger_guards.sql`. No hosted migrations, deployment, commit or push. Tests use real local Postgres/Auth and mocked PayMongo transport. No real sandbox refund or browser flow was performed. No web/admin UI files changed in this slice.

## Remaining activation gates

Group financial reports, exports and payout/clawback accounting; reconciliation operations for unknown/mismatched refunds; free-order fulfillment; checkout expiry/recovery and ticket email delivery workers; grouped registration/payment/ticket/admin UI; full sandbox and in-app browser acceptance testing.

Provider contract references: [Create a refund](https://docs.paymongo.com/reference/create-a-refund) and [Refund resource](https://docs.paymongo.com/reference/refund-resource). Sample responses are not proof of live provider compatibility; sandbox testing remains required.
