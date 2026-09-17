# Implementation Report — group payment preparation

**Plan**: docs/plans/2026-09-17-group-payment-preparation.md
**Branch**: feature/admin-ui-changes
**Status**: COMPLETE for preparation; combined payment capture remains PARTIAL.

## Summary

Implemented combined group pricing and durable prepared attempts. Commission is per participant, the processor fixed fee applies once to the order, and every participant receives an exact centavo allocation. Both fee modes, zero-commission pilot organizations, uneven add-ons and free participants/orders are covered. Replay returns frozen terms; overlapping or uncertain attempts block replacement.

## Tasks completed

- CREATE supabase/functions/_shared/groupPricing.ts: exact arithmetic and largest-remainder allocation, independently checked against SQL.
- CREATE supabase/migrations/20260916173539_group_payment_preparation.sql: scoped attempt/quote-line tables, immutable terms, service-only atomic preparation routine, effective rate snapshot, replay/concurrency guards. Applied locally only.
- CREATE supabase/functions/group-payment-prepare/index.ts: verified booker, strict input, safe errors, default-disabled rollout flag. No provider calls.
- CREATE supabase/tests/group-pricing.test.ts and group-payment-preparation.test.ts: five arithmetic tests and eleven local database/handler integration tests.

## Validation

- Focused pricing/preparation/function-grants: 24 tests passed.
- Deterministic arithmetic cases: 250 uneven-line scenarios plus 12 SQL/oracle combinations across fixed/percent commission and absorb/pass-on pricing.
- Deno typecheck: group-payment-prepare/index.ts and _shared/groupPricing.ts passed.
- Actual local endpoint: HTTP 503 group_checkout_not_available, proving the default-disabled flag.
- Full backend/shared suite: 530 tests passed across 66 files (69.32 seconds).
- Whitespace checks: passed for tracked edits and all new slice files.
- No frontend files changed; previous site/admin typecheck results are not claimed as fresh checks for this turn.
- The separate fake-provider backend.test.ts suite remains excluded under the local PayMongo setup. No browser payment walkthrough or production build was run for this internal slice.

## Deviations / decisions

The next architecture phase was split into preparation and provider dispatch/capture. This preserves a reviewable, independently tested money boundary before creating external sessions. Prepared attempts deliberately have no checkout URL, provider session or actual capture fields yet.

Paid group quotes require a valid effective rate in both modes. Free orders require no processor rate. Legacy single-registration behavior is unchanged.

## Provider research and future requirements

Official PayMongo documentation confirms 24-hour idempotency retention and no automatic Checkout Session expiry. Current single-registration creation does not send an idempotency key. Do not reuse it by substituting an order ID for registration_id.

- https://docs.paymongo.com/reference/idempotent-requests
- https://docs.paymongo.com/reference/checkout-session-resource
- https://docs.paymongo.com/docs/payment-channels-key-concepts
- https://docs.paymongo.com/reference/expire-a-checkout-session

Next: persist the exact provider request and attempt UUID key, dispatch safely, preserve unknown outcomes, record unique session/capture IDs, verify paid amount/currency/environment, and atomically confirm the entire group with financial allocations and separate QR tickets. Explicit provider expiration, late/extra captures, refunds, reporting and grouped UI remain release requirements. No hosted changes, commits or pushes made.
