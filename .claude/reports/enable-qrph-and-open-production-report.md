# Enable QR Ph and open production — implementation report

## Summary

Removed the temporary production Coming Soon gate from the runner and admin applications. Production now uses the normal application layout and route protection, while staging keeps its crawler-blocking response headers.

Added QR Ph to PayMongo Hosted Checkout. The method remains server allowlisted, uses PayMongo's `qrph` identifier, and continues through the existing signed webhook and provider-verification paths. Admin payment views now present captured QR Ph payments as `QR Ph`.

## Implementation

- Removed `isPublicLaunchClosed` and the production-only middleware/layout branches.
- Preserved `isStagingEnvironment` and staging `X-Robots-Tag` headers.
- Added `qrph` to single and group checkout request contracts.
- Added QR Ph to runner checkout copy, group selection, admin badges, and filters.
- Added a follow-up migration that marks the current QR Ph forecast rate as offered.
- Expanded the group payment method constraint and security-definer procedure.
- Retained service-role-only execution on the group preparation procedure.

## Security and accounting controls

- The PayMongo secret stays in Supabase Edge Function secrets.
- Clients cannot add arbitrary provider methods or submit an authoritative amount.
- Checkout URLs must still use the exact PayMongo checkout origin.
- Payment confirmation still requires signed callbacks and verified provider captures.
- Captured PayMongo fees remain authoritative for the ledger.
- The rate-card row is only a forecast for absorb-mode reporting.

## Validation

- Shared, payment-provider, group-provider focused tests: 34 passed.
- Site focused payment tests: 43 passed.
- Admin method presentation tests: 18 passed.
- Database rate, group preparation, and function-grant tests: 66 passed.
- Site suite: 47 files, 410 tests passed.
- Admin suite: 110 files, 881 tests passed.
- Backend/shared suite: 86 files, 704 tests passed.
- Site and admin TypeScript checks passed.
- `supabase db lint --local --level warning` found only existing warnings in unrelated payout/team functions.
- Site and admin production builds passed from the exact implementation commit.
- Live QR Ph transaction: intentionally deferred to the owner.

## Deviation resolved during implementation

The initial database test found that `booking_order_prepare_payment` and its table constraint still rejected QR Ph. The migration now updates both server-side controls and reasserts the procedure grants.
