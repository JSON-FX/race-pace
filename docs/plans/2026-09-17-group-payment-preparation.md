# Group payment preparation

Status: implemented locally; validation recorded in the implementation report. Builds on group-reservation-api and group-checkout-architecture.

## Scope and acceptance

A booker prepares one combined charge for all entries in an existing same-category order. This bounded slice freezes fee terms, prices and per-registration predicted allocations before any provider request. It does not activate provider creation or confirmation: those require the following capture/reconciliation slice. Public group checkout remains disabled.

1. Integer-centavo calculation: per-entry commission, one processor fixed fee for the whole charge, aggregate pass-on gross-up, absorb mode, zero commission and all-free orders.
2. Stable largest-remainder allocations. Line gross/commission/processor/net sums equal order totals. Actual fees can later be allocated without repricing captured gross.
3. Service-only atomic preparation. Verified booker; active org/open event; whole order still pending and unexpired; complete line membership and amounts. Freeze current org/rate-card terms with a UUID attempt key. Replays preserve exact terms and attempt IDs; changed keys/methods cannot create overlapping live attempts.
4. Private attempt ledger with org-scoped admin/booker reads and immutable quote lines. No legacy payments rows or provider charges.
5. Disabled edge endpoint accepting only order_id, method and idempotency_key. No client prices/actor. No returned checkout URL until provider capture handling exists.

## Decisions inherited / open questions

Same category, optional self, individual entries and QR, per-entry commissions and shared processor fee are already settled by the architecture. No user decisions are open for this slice. Initial modes: card, gcash, maya (mapped to paymaya). Paid orders require a valid effective local processor rate in either mode; free orders have no fees and require no provider. A missing rate fails closed for a new group quote; legacy behavior is untouched.

Use a prepared attempt, not repeated single-registration Checkout Sessions. The next provider slice must use the attempt UUID as PayMongo Idempotency-Key, freeze the exact provider request, preserve uncertain outcomes and explicitly expire abandoned sessions. PayMongo's official docs say keys are retained 24 hours and sessions do not auto-expire. No assumption of safe retries after that window.

## Context and references

- supabase/functions/_shared/fee.ts: computeFee per-entry commission/clamp semantics.
- supabase/functions/_shared/processorFee.ts: gross-up and predicted processor fee rounding.
- supabase/functions/_shared/payments.ts and paymongo.ts: existing single-entry metadata/session adapter; not reused with fake lead registration IDs.
- supabase/migrations/20260916171024_group_reservation_api.sql: service-only RPC, frozen entry terms, retry and expiry contract.
- supabase/tests/group-reservation-api.test.ts: local Auth/Data API/Postgres harness and cleanup.
- https://docs.paymongo.com/reference/idempotent-requests : stable provider request key and uncertainty boundary.
- https://docs.paymongo.com/reference/checkout-session-resource : session lifecycle.

## Tasks, in order

1. CREATE _shared/groupPricing.ts with bounded BigInt arithmetic and stable allocations. Add table/property tests including zero-weight and rounding cases. VALIDATE: pnpm exec vitest run supabase/tests/group-pricing.test.ts.
2. CREATE migration via CLI: attempt and quote-line tables, explicit grants/RLS, immutable terms, atomic preparation RPC with SQL arithmetic. Add real database tests for pricing parity, tenant/booker authorization, retry conflicts, missing rates, pending/expiry and concurrency. VALIDATE: local migration apply; focused payment preparation plus function-grants suites.
3. CREATE group-payment-prepare endpoint: verified actor, strict request schema, default-disabled flag, safe business errors. Test real DB through in-process Deno handler; live endpoint default-disabled smoke. VALIDATE: focused tests and Deno check.
4. REVIEW and VALIDATE: backend/shared suite excluding separate fake-provider backend.test.ts; update roadmap/report/review with exact evidence. No frontend changes or provider charge in this slice. VALIDATE: git diff --check and new-file whitespace checks.

## Future integration requirements

Prepared does not mean charged. Provider dispatch must claim an attempt atomically before I/O, persist the exact request, attach session/capture identities uniquely, and handle unknown outcomes without creating a second charge. Confirmation must verify amount/currency/metadata and settle all registrations/allocations together, or record reconciliation. Coordinated refunds, cancellation/expiry, reporting and grouped UI remain required before enabling customers.


## Completion

All four tasks implemented. See [implementation report](../../.claude/reports/2026-09-17-group-payment-preparation-report.md) and [review](../../.claude/code-reviews/2026-09-17-group-payment-preparation.md). Group provider dispatch/capture remains the next slice; both group endpoints remain disabled for customers.

Follow-up: [group provider dispatch and atomic confirmation](2026-09-17-group-payment-capture.md) is implemented locally behind disabled flags.
