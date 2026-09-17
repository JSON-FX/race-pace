# Implementation Report — atomic group reservations

**Plan**: docs/plans/2026-09-17-group-reservation-api.md
**Branch**: feature/admin-ui-changes
**Status**: COMPLETE for the internal reservation slice; overall group checkout remains PARTIAL.

## Summary

Added a disabled-by-default group reservation API for one verified booker and one to ten Passports in the same category. Guests-only groups are supported. Every registration freezes saved identity, individual kit choices, event answers and organizer waiver evidence. One database transaction rechecks mutable access/configuration, prices entries/add-ons, reserves all slots and creates all lines, or rolls back everything.

## Tasks completed

- Added mirrored strict schemas in packages/shared/src/groupRegistration.ts and supabase/functions/_shared/groupRegistration.ts, exported through the existing validators.
- Added groupReservationValidation.ts to validate saved completeness and individual event/kit choices without trusting injected identity.
- Added migration 20260916171024_group_reservation_api.sql: immutable request/entry terms, stable replay result and service-only atomic booking_order_reserve RPC. Applied locally only.
- Added group-reservations/index.ts: verified actor, bounded payload, per-Passport validation, safe errors and feature flag. No provider request, payment row or QR token is created.
- Blocked the legacy checkout's reserved group key namespace after review identified a potential expired-line revival path.
- Updated architecture, roadmap and implementation plan.

## Tests added

Three schema/validation tests and sixteen integration tests. The integration harness runs the real edge handler with local Supabase Auth, Data API and PostgreSQL; Deno.serve/env are provided by Vitest. Live HTTP additionally exercises legacy checkout/payment-session guards. Cases cover self-plus-guest, guests-only, personal kit/answers/waiver snapshots, totals, retries, key conflicts, expiry, access revocation, stale snapshots, invalid/cross-event add-ons, unavailable capacity, concurrent legacy/group admissions, competing groups, simultaneous retries, client RPC denial and disabled rollout.

## Validation results

- Focused final integration suite: 16 passed.
- Earlier focused reservation/foundation/function-grants run: 28 passed before the final legacy-key regression was added.
- Final broad backend/shared suite: 514 tests passed across 64 files (69.80 seconds).
- Site and admin typechecks: passed.
- Deno check for both new group endpoint and changed legacy checkout: passed.
- git diff --check: passed.
- Running local group endpoint: HTTP 503 group_checkout_not_available, confirming default-disabled configuration.
- Local migration list includes 20260916171024; no hosted database/deployment changes.

The separate supabase/tests/backend.test.ts fake-provider suite is excluded under the existing local PayMongo test setup. Browser group acceptance and production builds are not claimed; the public group UI is not implemented in this slice.

## Deviations from the plan

- Added a review-driven legacy namespace guard to keep individual checkout from bypassing the order boundary.
- RPC uses SECURITY DEFINER because service_role has no auth.users SELECT privilege. Its service-only grants remain the trust boundary; saved data and actor verification are rechecked inside the transaction.
- Set an initial ten-participant and twenty-add-on-per-participant server limit; provider payload testing is still required before public activation.

## Issues encountered

Initial fixture setup needed explicit UUID/text casts and the service claim used by the event-waiver trigger. These were corrected. An initial full run returned one HTTP 502 from local payment-session (512 passed, one failed). Its focused rerun passed; the final full run passed all 514 tests. No validation was weakened to hide that failure.

## Remaining work

Combined pricing and provider attempts; atomic payment confirmation and allocations; coordinated expiration/cancellation/refunds; reports and payouts; grouped participant selection and ticket delivery; then in-app browser acceptance. GROUP_RESERVATIONS_ENABLED must remain unset in hosted environments until those paths are complete. No commits or pushes made.
