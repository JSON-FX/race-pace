# Organizer proceeds and active registration commission

## Evidence and cause

Investigated against released main `98205505e8d59f80575bb0986ae379a4b66390fc` on 2026-10-07.
The Registrations card renders `getRegistrationAggregates().grossCents`, which is captured amount less refunds and never deducts processor or platform fees. It also follows table filters whereas Gross Registration covers the whole event.

Read-only production checks reconciled the selected event against `admin_payment_aggregates`: the stored organizer proceeds are lower than gross. Captured legacy and group payment rows both contain zero platform fees. The selling organization's current registration commission is zero; a second organization has nonzero terms but no captured registration earnings. Open/coming-soon status is not responsible for the zero Commission Earned value. No payment records or fee settings need modification.

The Commission page says platform fees survive refunds, but its organization aggregate and event rows exclude fully refunded legacy captures. Group refund rows remain partially_refunded, creating inconsistent retained commission reporting.

## Implementation plan

1. Reuse existing `admin_payment_aggregates` with explicit organization/event scope and no table filters. Read recorded `net_cents`; never recalculate historical fees or subtract refunds twice. Null/error/invalid values must not appear as zero.
2. Replace Retained gross with Net to organizer. Both monetary cards cover the whole selected event. Explain that net is after processing, commission and refunds; this is earnings, not unpaid balance.
3. In Commission's existing paginated payment reader, distinguish captured statuses (paid, partially_refunded, refunded) from statuses with organizer proceeds. Derive registration commission and its charged-gross denominator from captured rows, including retained fees on full refunds. Preserve organizer net/refund calculations.
4. Add Active event commission under the existing super-admin guard. Sum recorded registration fees for open, almost_full and coming_soon events. Paginate event metadata so status filtering cannot silently truncate totals. Keep reservation Platform Fees separate. Do not forecast from current rates or alter them.
5. Add regression coverage for event scope, fee/refund-adjusted net, unknown/unavailable amounts, legacy/group captures, full refunds, event status membership, no sales and access guards.

## Validation and release

Run admin tests/typecheck/build, applicable existing backend financial tests, shared UI checks and repository CI. Review changed files and regression tests. Release through active Option B: feature PR to main, hosted staging verification, then fresh owner production approval. No database migration or provider configuration change is needed. No synthetic production data or automated live payments.
