# Trail Ledger match and unpaid booking cancellation

## Goal

Bring the live group order screen in line with the approved Trail Ledger proposal. Add a safe way
for the booker to cancel an unpaid group booking and return to the Trail Roster to choose a smaller
participant set, including only themselves.

## Decisions

- Preserve data-driven totals, category labels, fee handling and the two-stage payment flow. The
  proposal's sample values are not production requirements.
- Match the approved layout through the existing ShadCN components: a wider checkout surface,
  softer borders, more generous spacing, neutral assurance cards and a clearer payment summary.
- Label the new secondary action `Change participants`. Confirm it in a ShadCN alert dialog that
  explains the current unpaid booking will be cancelled before returning to the roster.
- Allow cancellation only while the order is pending and no PayMongo dispatch exists. A prepared
  quote is safe to expire. Creating, ready, unknown, paid and reconciliation states are not safe to
  cancel.
- Perform order, registration and prepared-attempt state changes in one service-role-only database
  function. Authenticate and authorize the booker in a dedicated Edge Function.
- Return to `/register/{categoryId}/group`. The Trail Roster already loads all event categories, so
  the first registration category is a stable entry point for both same- and mixed-category orders.

## Tasks

1. Add the atomic `booking_order_cancel` database function with explicit grants and state guards.
2. Add the authenticated `group-order-cancel` Edge Function and a typed site client helper.
3. Add the ShadCN Alert Dialog primitive used by the confirmation flow.
4. Restyle the group order screen to match Trail Ledger and add the guarded change-participants
   interaction.
5. Pass category count and the roster return URL from the server page.
6. Add focused database, Edge Function and component tests for success, authorization, idempotency,
   prepared quotes and blocked provider sessions.
7. Run focused tests, type checking and the relevant local validation suite. Record results in an
   implementation report.

## Out of scope

- Cancelling paid bookings or refunding tickets.
- Cancelling a booking after PayMongo session creation.
- Changing payment, fee or ticket-generation behavior.
- Staging or production deployment in this implementation pass.
