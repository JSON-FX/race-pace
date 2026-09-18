# Implementation Report — Group runner checkout UI

**Plan:** `.claude/plans/group-runner-checkout-ui.md`  **Branch:** `feature/admin-ui-changes`  **Status:** PARTIAL

## Summary

Added a server-gated runner group flow. A booker can select one to ten complete self or managed Passports, configure each person, record separate organizer-waiver acceptance, reserve one order, review one payment attempt and reach each named ticket after confirmation. The group entry and order page remain inaccessible unless `GROUP_CHECKOUT_ENABLED=true`; no hosted flags were enabled.

## Tasks completed

- Group selection, request validation and payment helpers: `apps/site/lib/groupCheckout.ts`, `apps/site/app/register/[categoryId]/GroupRegister.tsx`.
- Server-gated registration entry: `apps/site/app/register/[categoryId]/group/page.tsx`, existing registration selector.
- Order review, provider callback and named ticket list: `apps/site/app/group/order/[orderId]`, `apps/site/app/group/callback/page.tsx`.
- Existing pending group entries resume the parent order from My Races, event CTAs, managed bookings, ticket and direct `/pay` URLs. Individual discard is hidden for group lines.
- Ticket QR copy reflects optional organizer check-in while keeping the QR visible.

## Tests added and validation

- Group selection tests cover unique participants, capacity, per-person acceptance, incomplete Passports, and one reservation request for two people.
- Group order UI tests cover two named paid-ticket links and uncertain provider creation blocking a second checkout.
- Navigation and ticket tests cover parent-order recovery and check-in-not-required copy.
- `pnpm --filter site test`: 404 tests passed across 47 files.
- `pnpm --filter site typecheck`: passed.
- `git diff --check`: passed.
- No host build was run because the repository's Docker guidance forbids writing host `.next` through the live bind mount. Run the build in isolated CI after integration.

## Deviations and blockers

- Kept all hosted group flags off. The backend refund, payout, expiry and live provider-capture gates need coordinated validation before activation.
- `GROUP_PAYMENT_RETURN_URL` must point to the matching `/group/callback` URL for each environment.
- Optional check-in migration `20260918100000_optional_event_checkin.sql` must land before deploying the site select of `events.check_in_required`.
- The backend must deny direct deletion of ordered pending registrations. That guard is assigned to the payment-safety agent.
- No sandbox group payment, group refund, SMTP delivery or browser end-to-end result is claimed.
