# Group runner checkout UI

Status: implementation in progress. Inherits `docs/specs/group-checkout-architecture.md` and the group reservation, payment, refund, reporting, and delivery plans. Product decisions are settled upstream: one category, one payer, one to ten distinct Passports, each participant personally accepts the organizer waiver, and one named ticket per paid registration.

## Goal

Let a signed-in booker select their own and managed Passports, configure each participant, reserve all slots in one request, and complete one provider checkout. Keep the public entry point off until the backend flags and release gates are verified.

## Context and contracts

- `apps/site/app/register/[categoryId]/page.tsx` currently selects only one Passport and renders `RegisterWizard`.
- `packages/shared/src/groupRegistration.ts` defines the strict reservation payload. The Deno copy is intentionally mirrored.
- `group-reservations` returns `order_id`, `status`, `expires_at`, `entry_total_cents`, and per-participant registration IDs.
- `group-payment-prepare` accepts order ID, method, and stable idempotency key. It returns an attempt with `id`, `gross_cents`, `base_cents`, `platform_fee_cents`, and lines.
- `group-payment` accepts attempt ID and `session`/`verify`, returning a saved checkout URL or verified status. The provider return URL is server-configured with `order_id`.
- RLS permits a booker to read only their orders, attempts, and registrations; client mutations use authenticated Edge Functions.

## Steps

1. **ADD** a server-only `GROUP_CHECKOUT_ENABLED` gate to the registration page. List accessible Passports through existing RLS and display a group-entry link only when the flag is true and the event has a published waiver. **VALIDATE:** focused page tests and site typecheck.
2. **CREATE** a client group form with distinct Passport selection, saved completeness checks, per-person kit/add-ons/event answers, explicit waiver acceptance, and stable reservation key. Submit the strict shared schema, never a client amount or actor ID. **VALIDATE:** focused component tests for duplicates, incomplete Passports, insufficient visible capacity, waiver, and guest-only orders.
3. **CREATE** authenticated order payment/status page. Read the booker's RLS-scoped order and lines. Prepare and dispatch exactly one attempt using a persistent key, surface unknown outcomes without blind retry, verify after return, and link each paid registration's existing ticket. **VALIDATE:** focused state tests and site typecheck.
4. **REVIEW** flags, error paths, all site tests and build. Do not enable hosted flags or claim a PayMongo charge. **VALIDATE:** `pnpm --filter site test`, `pnpm --filter site typecheck`, `pnpm --filter site build`, `git diff --check`.

## Release checks

- Backend payment/refund/reporting and expiry paths pass independently.
- One sandbox charge creates exactly N paid registrations and N named signed tickets; replay creates none extra.
- Group email, one-ticket refund, whole-order refund, and admin reports reconcile to the one capture.
- No flag is enabled in production before staging browser acceptance.

## Open questions and assumptions

No product question remains. Assume card, GCash and Maya share the backend method contract. The UI must not permit zero-price group checkout until the backend free-order path exists.
