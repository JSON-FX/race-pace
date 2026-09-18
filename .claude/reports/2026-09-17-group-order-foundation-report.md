# Implementation report — group order foundation

Plan: docs/plans/2026-09-17-group-order-foundation.md
Branch: feature/admin-ui-changes
Status: COMPLETE for the internal schema/capacity slice; overall group checkout PARTIAL.

## Changes

Added service-written booking_orders with scoped booker/admin reads, immutable order identity and same-organization/event/category guards. Registrations may reference an order but cannot be reassigned to another order. No public order creation API exists yet.

Added a category-locked registration capacity trigger shared by existing checkout and future grouped inserts. It counts paid and unexpired pending registrations rather than slots_taken alone. Already-active registrations retain their reserved capacity when becoming paid. Expired holds do not consume capacity; a late transition back to paid needs available capacity. Existing checkout maps exhausted capacity to sold_out. The legacy payment-session endpoint refuses ordered registrations until an order-aware payment path exists.

The next slice must create and reserve an entire group through one authorized transaction, validate all Passports/waivers/options, define order expiration, and add provider-attempt/payment/refund coordination. This migration alone does not expose group booking, charge a group or issue group tickets. Category locks must be acquired consistently by that future transaction and legacy expiry/payment operations.

## Validation

- Focused schema/grant checks passed initially.
- Concurrent separate database connections requesting one remaining slot produced exactly one registration; the other was denied.
- Two group-linked inserts exceeding capacity rolled back together with no partial registration.
- Tests verify expired capacity reuse, refusal of late capture without capacity, same-category order scope, read isolation and denied authenticated order writes.
- Broad backend/shared run: 485 passed, 10 failed out of 495. All failures were in organization-management fixtures that omitted slots_total (default zero) while inserting registrations. Set explicit fixture capacity; then all 27 focused organization/group/grant tests passed. Broad suite was not repeated after the fixture-only correction. Separate fake-provider backend.test.ts remains excluded by its existing environment requirement.
- git diff --check passed.

No frontend edits/build in this slice. No hosted migration, commit, push or deployment.

## Risks and next checks

The visible registration page still handles one participant per checkout. There is no atomic public group reservation RPC yet. Payment confirmation failure after an expired hold runs out of capacity must be surfaced through the planned reconciliation/refund path before group activation. Existing seeded inconsistencies are not silently rewritten. Complete future order/registration expiry coordination, provider money allocation and refund guards before exposing group orders.
