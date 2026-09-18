# Group ticket-email delivery

Status: implemented locally; runtime disabled. Plan: `docs/plans/2026-09-17-group-ticket-delivery.md`.

The durable outbox now leases jobs to a protected server-only worker. Each message goes to the confirmed booker and includes a separate named QR/link for every currently paid participant. Original captured booking total appears once. Refunded tickets are excluded; fully refunded bookings finish without sending.

Concurrent workers cannot claim the same live lease. Failed delivery retries with bounded exponential backoff. Stale lease completion cannot overwrite a newer attempt. Neither delivery nor retries change payment status, registrations or QR tokens. SMTP acceptance followed by a crash can result in duplicate email; the implementation does not claim exactly-once delivery.

Validation: focused tests53 passed across3 files; Deno check passed; whitespace check passed. Full backend/shared suite: **593 tests passed across 69 files**, no skips, 76.86 seconds (`pnpm exec vitest run --exclude supabase/tests/backend.test.ts`). The separate fake-provider harness remains excluded. Explicit privilege checks confirmed anonymous/authenticated callers cannot claim or complete jobs; service_role can claim. Tests use real local Auth/Postgres with mocked email and payment transport. No Mailpit or external email was sent this turn.

Migration `20260916203359_group_ticket_delivery.sql` applied locally only. Endpoint requires TICKET_EMAIL_SECRET and GROUP_TICKET_DELIVERY_ENABLED=true; the actual runtime switch remains off. Config and deployment instructions document scheduling, but no scheduler was activated. No commit, push or hosted deployment.

Next: verify delivery through Mailpit, implement uncertain-payment/session recovery and explicit expiry, free-order fulfillment, then grouped checkout/ticket UI. Real sandbox and browser acceptance remain required before public group activation.
