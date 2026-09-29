# Group participant refund routing

Hosted staging acceptance found that Review refund returned Registration not found for a paid managed Passport in a group order. The registration exists. Its payment lives in booking_payment_allocations, while admin-refund only searches the legacy payments table.

RegistrationDetail already receives booking_order_id but discarded it when opening RefundModal. The action therefore always invoked admin-refund. The existing admin-group-refund endpoint enforces verified authentication, tenant permissions, the group refund feature flag, server amounts, and durable idempotency.

The fix carries the order identity through the modal and routes group entries to that endpoint. Every request explicitly selects exactly one registration. A stable registration UUID identifies retries and reopened dialogs for this actor. Existing requests are checked rather than presented as new refunds. Failed or review-required requests require platform support; uncertain requests never rotate their key automatically. Unsupported notes are hidden for group refunds. Copy states that a successful group participant refund revokes only that participant's ticket and frees their slot.

Validation: focused action/component regression tests, complete repository checks, and hosted staging test-mode selected-participant refund with sibling preservation are required before production promotion.
