# Mixed-category group checkout

Date: 2026-09-22. Status: implemented and accepted on staging; production promotion pending.
Extends: [group checkout architecture](group-checkout-architecture.md).

## Decision

A booking order remains limited to one organization and one event. Each selected Race Passport
chooses its own category. The booker may include or exclude their own Passport.

The order reserves every participant atomically and uses one provider payment. If any selected
category is unavailable, the reservation creates nothing and returns the affected category to the
roster. Payment confirmation likewise fulfills every registration or moves the captured payment to
reconciliation without issuing a partial ticket set.

Each registration remains the source of truth for its category, frozen identity, waiver, add-ons,
financial allocation and QR ticket. The order header keeps its legacy category only for existing or
new same-category orders. A mixed-category order has no header category.

## User experience

The approved Trail Roster presents every accessible Passport as a stable neutral row. A ShadCN
Checkbox controls inclusion. A selected badge confirms state without recoloring the whole row. A
ShadCN Select assigns the category and stays disabled until the runner is selected.

The roster shows category price and remaining availability. The summary groups selected runners by
category, shows the combined entry amount, and continues to one shared payment review. Per-runner
questions, kit options and waiver acceptance remain required before reservation.

After payment, the order page lists every participant with their category and individual ticket
link. Ticket delivery includes the correct category beside each participant. Each paid registration
receives its own signed `ticket_token`; the existing ticket page and `ticket-qr` function remain the
QR rendering boundary.

## Compatibility and safety

- Existing same-category reservation payloads and order rows remain readable and replayable.
- New requests place `category_id` on each participant. All categories must belong to the order's
  event and organization.
- Category rows are locked in stable identifier order for reservation, capture and refund.
- Capacity is checked and adjusted per category, never by total participant count against one row.
- Payment quotes and allocations continue to use registration totals, so mixed entry prices require
  no new provider-payment model.
- Refunds release only the categories belonging to refunded registrations.
- Reporting and payouts remain registration based and preserve one provider capture per order.
- Hosted feature flags stay disabled until local tests and the staging sandbox payment prove the
  complete flow.

## Acceptance

1. Select self and managed Passports, omit any Passport, and choose different categories.
2. Reserve all selected runners together. A sold-out category produces no partial order.
3. Pay once in PayMongo test mode and confirm one paid registration per Passport.
4. Confirm every selected registration has a distinct ticket token and a working QR response.
5. Confirm order UI and delivery show the correct participant-category pairing.
6. Refund one participant and verify only that category's used-slot count decreases.
7. Preserve legacy single-runner and same-category group behavior.
