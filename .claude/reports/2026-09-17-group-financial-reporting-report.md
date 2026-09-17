# Group financial reporting implementation

Plan: `docs/plans/2026-09-17-group-financial-reporting.md`.
Branch: `feature/admin-ui-changes`. Status: implemented and validated locally, group entry points remain disabled.

## Result

- Payment reports and CSV show a fulfilled shared capture once, with internal payment ID, order ID and participant count. Registration and settlement reports use each participant's allocation. No synthetic lead registration or duplicated legacy payment rows.
- Successful group refunds reduce actual organizer net while retaining earned commission/processor fees. Original capture and allocation amounts stay unchanged. Registration status remains refunded; financial status reflects retained charges.
- Unknown actual fee/net remains null, displayed as unknown or awaiting reconciliation. Incomplete forecasts are suppressed. Group exports preserve unknown amounts instead of inventing zeroes.
- Commission details and averages use participant rows. Shared captures are excluded from that detail stream to avoid counting both capture and allocations.
- Group payouts use separate settlement/clawback stamps. Pre-settlement refunds reduce the first payout; later refunds become a single clawback. A widened snapshot/revision guard rejects outdated statements. Pending refunds, unresolved captures and unknown actual fees block group settlement.
- A transaction advisory lock serializes group money mutations and payout snapshots before their existing row locks. Legacy arithmetic remains in service-only helpers; original public authorization and signatures are retained.
- Private ledger reads expose only safe financial fields through an explicitly authorized function and security-invoker views. Bookers and foreign organizers cannot read group administration allocations.

## Verification

- Backend/shared: **587 passed across 68 files**, no skips, 124.56 seconds. `pnpm exec vitest run --exclude supabase/tests/backend.test.ts`; the excluded fake-provider harness requires a separate environment.
- Admin web: **853 passed across 106 files**, 20.84 seconds. The test runner reports a jsdom navigation warning; no tests fail.
- Admin TypeScript check: passed.
- `git diff --check`: passed.
- Local security advisors: no ERROR findings; existing mutable-search-path WARN findings on `decrement_slot` and `increment_slot` remain. No new financial function warning.
- In-app browser: Payments and Commission load with existing local sample data. A real Commission failure (`URI too long`) was fixed by chunking event IDs and paging category reads; verified loaded with 937 sample organizations.
- Group monetary checks use real local Auth/Postgres and mocked provider transport. Browser tests did not execute a group purchase/refund, and CSV download-to-disk was not verified. Route tests verify CSV content.

During validation, a legacy/group fixture initially omitted the event's waiver ID; the test fixture was corrected. An admin page test omitted the required capability; corrected. Final suites above passed after fixes. No production build, hosted migration, deployment, commit or push.

## Scope notes and remaining gates

This slice reports fulfilled captures. Anomalous captures are counted as unresolved and block settlement; anomaly detail/reconciliation operations remain pending. Group settlement refund timestamps currently export blank because the projection does not yet expose the recorded completion timestamp. Monetary amounts and refund totals are included.

Remaining before public activation: payment/refund reconciliation operations; free-order fulfillment; uncertain-session recovery and provider expiry; grouped ticket-email delivery; multi-Passport checkout and grouped ticket/admin screens; real PayMongo sandbox and full in-app browser acceptance; deployment checks. Existing local security-advisor warnings also need review before readiness signoff.

The Commission query batching repair was added because browser verification reproduced the failure in the affected report. Legacy organizational/event summary reads retain their existing maximum response limits; larger production datasets require separately paginated or aggregated summaries. The current browser sample has fewer than 1,000 organizations.

References checked: [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Observability](https://supabase.com/docs/guides/observability). Changelog reviewed; no database upgrade performed.
