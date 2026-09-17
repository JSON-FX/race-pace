# Review — group payment dispatch and capture

Scope: capture migration, group provider adapter/service/endpoint, webhook routing and their tests. Independent read-only review of the migration/service/endpoint found no concrete blocker within the disabled internal slice.

## Resolved findings

1. Metadata names differed between the adapter and persistence validation. Standardized booking_order_id/payment_attempt_id and retested.
2. Malformed concrete paid IDs could be skipped by extraction. They now fail verification with invalid_capture_identity; no silent unpaid outcome.
3. A paid webhook could be acknowledged while the re-fetched session still lacked its capture. Pending verification now returns 503 for webhook retry.
4. Uppercase UUID input could change provider idempotency/metadata text. Dispatch now uses the canonical attempt ID returned by the database.

## Reviewed boundaries

- Verified booker and service-only RPC authorization; private ledgers have RLS enabled and no authenticated/anonymous grants.
- Single dispatch claim and frozen request before provider I/O. Unknown outcomes block fresh attempts and no unpersisted URL is returned.
- Amount, currency, environment, metadata and bound session checks before fulfillment.
- Concrete capture IDs are unique, and only one capture can fulfill an order. Additional captures are retained as reconciliation incidents.
- Shared category lock and complete group checks precede writes. Ticket/slot/allocation/order/outbox writes occur inside one rollback boundary.
- Captured fees allocate by stable largest remainder. Missing fee/net remains unknown, never zero or silently predicted.
- No duplicate legacy payment ledger rows or assumed lead participant.
- Signed-webhook routing reuses authoritative stored-session verification. Invalid signatures, unbound sessions, provider errors and temporarily missing captures are not acknowledged as success.

No remaining technical issues detected for the stated internal slice. This is not production or full-group-flow approval. Free fulfillment, uncertain-outcome recovery, explicit expiry, refunds, delivery, reports/payouts and browser acceptance remain release gates documented in the implementation report.
