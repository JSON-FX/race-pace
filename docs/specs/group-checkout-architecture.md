# Architecture — group registration checkout

Date: 2026-09-17. Status: architecture baseline; mixed-category scope is superseded by the approved [2026-09-22 extension](2026-09-22-mixed-category-group-checkout.md).
Scope: public runner web and admin only.
Intent and acceptance checklist: [assisted registration revisions](../plans/2026-09-16-assisted-registration-passport-revisions.md).

The original same-category boundary remains the compatibility contract for existing orders. New
orders may assign a different category to each participant when every category belongs to the same
event and organization.

## Problem and goals

A signed-in helper selects their own Passport and/or managed non-member Passports from the registration page. One payment secures one registration and a distinct named QR ticket for each selected participant. Each participant retains their own identity, kit choices, waiver evidence, collection state and attendance. The original version placed everyone in one event category; the approved extension now allows a category per participant. A helper need not enter themselves.

## Approaches considered

| Approach | Benefit | Cost / limitation |
| --- | --- | --- |
| Repeat the current single-registration checkout | Smallest change; reuses current money flow | Requires multiple payments and fails the requested experience |
| Use a lead registration's payment for everyone | Less initial schema work | Makes the lead participant special; cancellation and refund ownership become ambiguous; risks duplicating gross in reports |
| Shared order, separate participant registrations | One payer transaction with independent participant operations | Requires explicit payment allocation, atomic capacity handling and refund coordination |

Use the shared-order approach. Keep the existing Next.js, Supabase and PayMongo stack; no new commerce platform or library is justified. Preserve legacy single-registration processing while adding an explicit order path. Do not reinterpret old provider references or rewrite historical audits.

## Data model and ownership

- **Booking order:** one organization, event, category, verified booking account, currency, immutable pricing snapshot and expiry. Tracks payment/fulfillment state separately so a captured payment awaiting resolution is never represented as unpaid.
- **Order participant line:** one Passport and one registration; contains frozen identity, selected kit/add-ons, applicable shipping snapshot and organizer-waiver evidence. Reject duplicate Passports and existing live event entries.
- **Order payment attempts:** provider session/intent/payment identities belong to the order. Preserve every attempt. At most one capture fulfills an order. Any extra capture is an explicit refund/reconciliation incident, not another set of tickets.
- **Participant financial allocation:** distributes captured gross, commission, actual/predicted processor fee and refunds across registrations. Keep a clear distinction between an allocation and a provider transaction. Existing per-registration payment reporting may consume these allocations only after its consumers are audited; never copy the full provider charge into every registration.
- **Refund request:** identifies the provider payment and affected lines, with per-line refund values and durable request state. Serializes competing requests against the shared captured balance.

The booker can see the whole order and its tickets. A claimed participant can see their own registration; claiming one Passport does not expose companions' details or the helper's full transaction. Passport management alone does not grant access to another person's existing booking. Organizer reads remain scoped by org_id and existing staff capabilities. Secrets and provider mutations remain server-only.

## Registration and capacity boundary

Selection is a draft until the server validates every Passport, manager relationship, category, kit choice and waiver. Acquire the category capacity lock and relevant participant locks in stable order. Reserve all requested slots and create all lines in one database transaction, or create none. Count paid entries and unexpired holds consistently with legacy checkout; a new group-only lock cannot protect against old checkout unless both paths use the same capacity boundary.

Freeze order terms when creating the payment attempt. Changes to participant count, price or options require replacing the unpaid order/attempt, never editing a live payable total. Coordinate expiry, cancellation and confirmation using the same locked order state. No provider network call belongs inside a database transaction.

After hold expiry, attempt all-or-nothing reallocation when a late capture arrives. If the entire group cannot be accommodated, retain the captured amount in a reconciliation-required state, issue no partial set of tickets, notify the booker and staff, and open a durable full-order refund workflow. Do not silently discard a successful capture or promise a refund before provider confirmation.

## Pricing and allocation

All money remains integer centavos. Compute each participant's base from the selected category and their add-ons. Compute platform commission per participant using frozen organization terms, preserving fixed/percent and zero-commission settings. Sum the lines before applying a provider fixed transaction fee, which applies once to the combined payment.

For pass-on fees, gross up the combined base plus platform fees under the selected method's rate. Absorb mode keeps the runner charge at the combined entry/options base. Preserve the current fee-policy behavior; group checkout introduces no new commission policy.

Allocate checkout surcharges proportionally to each line's pre-processor payable value. Allocate the actual processor fee proportionally to captured line gross. Use largest-remainder allocation with stable line-ID tie-breaking so line totals equal order totals exactly. Define the all-zero case explicitly: free orders have zero payment fees and need no provider checkout. Store predicted and actual processor figures separately; an actual-fee variance changes organizer net, not the already-captured runner price.

Reports must enforce:
- Sum(line captured gross) = order captured gross.
- Sum(line commission) = order commission.
- Sum(line processor fee) = order processor fee.
- Sum(line net to organizer) = order gross minus platform commission minus processor fee, subject to the existing historical-fee handling.
- Cumulative confirmed and reserved refund amounts cannot exceed the captured balance.

## Payment confirmation and tickets

A verified callback or payment verification resolves the order and validates provider identity, currency and captured amount against the frozen attempt. A mismatch becomes a reconciliation incident. Do not call the existing single-registration confirmation repeatedly: it would allow partial group success and count the processor fee repeatedly.

One atomic confirmation locks the order, confirms all registrations, records payment allocations, consumes holds and stores a distinct signed ticket per line. Replayed callbacks are no-ops. An outbox delivers the grouped ticket list after commit and retries independently; email failure cannot roll back paid registrations. Existing ticket endpoints and QR-based kit/check-in operations remain registration-scoped.

## Refunds and financial reports

An organizer can select one participant or the whole order for refund. Use the existing refund policy to determine eligibility and retained fees, with a preview of the exact amount returned. Preserve actual provider fees rather than assuming they are refunded. The platform's treatment of its own commission continues to follow the current policy; do not infer a new rule from group ordering.

Serialize refund submissions per provider payment, including pending/unknown requests. Provider success updates only the selected line allocations, registrations, tickets and slot counts. A failure leaves those tickets unchanged. Full-order refund iterates the remaining refundable allocations under one coordinator; it must not independently invoke the legacy per-registration provider refund path against the shared charge.

Registration exports report participant amounts and an order reference. Payment exports report the provider transaction once, with an explicit allocation export when needed. Payouts aggregate participant net allocations once. Refunds after settlement use the existing clawback principle. Kit release and check-in remain independent; optional check-in configuration must not be bypassed by group confirmation.

## Existing integration points and missing pieces

Current checkout, payment-session, payment-verify and confirmPayment address a single registration. The current payments table is unique per registration. Refund coordination likewise starts from a registration. Add an explicit order-aware contract across these boundaries before enabling the new UI. Audit legacy expiration, cancellation, notifications, ticket delivery, exports and payout consumers for allocations versus provider transactions.

Existing Passport ownership, immutable waiver versions, registration identity snapshots and per-registration QR operations can be reused. Missing pieces are the order/attempt model, atomic multi-slot reservation shared with legacy checkout, deterministic allocations, group refund coordination, delivery outbox and grouped UI.

## Experiments and release gates

1. Capacity experiment: concurrent legacy and group requests for the last slots, plus expiry-versus-confirmation races. Pass only if no oversell or partial group survives.
2. PayMongo sandbox experiment: one charge for three participants, repeated verification/webhook delivery, then separate partial refunds against that capture. Verify supported provider behavior, fee payloads and idempotency using current provider documentation before implementing its adapter. The known test fee variance remains unresolved.
3. Compatibility experiment: existing single-entry payment/refund, registration CSV and payout fixtures must produce unchanged historical totals after adding order allocations.
4. Browser acceptance: self plus two managed participants, then guests-only; one payment, three named QR tickets, independent kit release/check-in and one-participant refund.

Hosted activation requires all four gates plus normal typechecks, backend authorization tests, app tests, isolated builds and documented migration order. No production claim follows from this architecture document.

## Implementation sequence

1. Order schema, access rules, immutable terms and atomic reservation shared with legacy checkout.
2. Combined pricing, provider attempts, atomic confirmation and allocations; deterministic automated tests first.
3. Order-aware refunds, expiration/reconciliation and reporting/payout integration.
4. Passport selection, per-person kit and waiver review, combined checkout and grouped ticket delivery.
5. In-app browser end-to-end validation and release review.

Each is a bounded PIV implementation slice with its own detailed plan and validation. Keep the group checkout entry point disabled until the payment, refund and reporting paths are complete.

## Deferred decisions

Mixed organizers and mixed events remain out of scope. Courier integration and representative waiver acceptance are not introduced here. The reservation API initially limits one order to ten participants and twenty add-ons per participant. Provider payload testing must confirm these limits before public activation. Provider partial-refund behavior and the existing rate-card variance must be verified rather than assumed.


## Provider lifecycle research — 2026-09-17

PayMongo's [idempotency documentation](https://docs.paymongo.com/reference/idempotent-requests) specifies a 24-hour replay window. Its [lifecycle documentation](https://docs.paymongo.com/docs/payment-channels-key-concepts) says Checkout Sessions do not automatically expire. The local 24-hour reservation hold must therefore not be treated as provider-session expiry. Persist the exact request and key, explicitly expire abandoned sessions, and keep uncertain outcomes blocked until reconciled. The existing legacy comment that assumes automatic session expiry is not evidence for the new group flow.

[Payment preparation](../plans/2026-09-17-group-payment-preparation.md) is implemented locally; it creates no provider session or captured ledger entry.
