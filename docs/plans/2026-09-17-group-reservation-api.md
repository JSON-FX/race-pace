# Group reservation API

Status: implemented locally; final validation recorded in the implementation report. Public activation remains blocked on group payments, refunds and reporting.
Architecture: ../specs/group-checkout-architecture.md

## Contract

One verified booker, one event/category, one to ten unique Passports. The booker may select only managed guests. Each participant explicitly accepts the current organizer waiver. The API accepts kit choices and event answers, never totals or actor IDs. A service-only transaction creates an order and all registrations/add-ons together. No payment session, paid entry or QR is created in this slice.

Use a bounded 24-hour hold matching legacy registrations. Retry the same normalized request with the same booker/key to return the same IDs and expiry. Changed requests using that key fail. Store submitted choices separately from validated saved identity. Profile changes after successful reservation cannot alter frozen registrations or prevent replay. Expired replay returns the original expired reservation, never renews it.

The edge validates saved Passport completeness and event fields. The transaction locks and compares those exact server-read snapshots, then rechecks account, manager, event, organization, waiver and prices. A changed snapshot requires a fresh read. The transaction calculates entry/add-on amounts itself. Form definitions use a short shared table lock to prevent inserted required-field phantoms; concurrent bookings remain compatible.

## Tasks and validation

1. Add mirrored strict request schemas, canonical participant/add-on sorting, and server-side per-person validation. Test duplicates, limits, forged fields, incomplete identity and per-person kit/waiver semantics. VALIDATE: focused group reservation tests.
2. Add service-only reservation RPC, immutable request snapshot, atomic inserts and stable replay result. Explicit grants; same category lock as legacy. Test rollback, actual concurrency, pricing/scope, replay and stale server snapshots. VALIDATE: apply migration locally, focused integration tests + function-grants.
3. Add disabled-by-default `group-reservations` edge endpoint. Derive actor from getUser; authenticate verified email; limit payload; safely map errors; no provider calls. Test handler using the real local DB and auth with a Deno harness. VALIDATE: focused integration/handler suite and edge typecheck when available.
4. Review changes, run the broad backend/shared suite excluding the separate fake-provider backend.test.ts suite, and document results. Existing frontend is unchanged. VALIDATE: git diff --check, backend suite, review artifact/report.

## Deferred

No enabled browser flow yet. Order payment attempts, fee allocation, confirmation, group expiry/cancellation coordination, refunds, grouped tickets and reporting remain subsequent slices. New endpoint requires GROUP_RESERVATIONS_ENABLED=true for local automated QA only; leave unset in hosted environments. No hosted migrations, commits or deployment in this slice.


## Review correction

Legacy checkout now rejects the reserved `group:` idempotency namespace. Otherwise a caller could reuse an expired group line's internal key through legacy upsert and start an individual provider charge. The regression test proves the group line stays expired and no payment row is created.

## Validation outcome

514 backend/shared tests passed across 64 files, excluding the separate fake-provider backend.test.ts suite. Site/admin typechecks and Deno checks passed. Local feature flag remains disabled. See [.claude implementation report](../../.claude/reports/2026-09-17-group-reservation-api-report.md) for detailed coverage and limitations.

Follow-up: [group payment preparation](2026-09-17-group-payment-preparation.md) now implements combined quotes and durable attempts. Provider dispatch and atomic capture confirmation are next.
