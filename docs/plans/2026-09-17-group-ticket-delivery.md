# Group ticket delivery

Status: implemented and validated locally; activation remains disabled. Inherits group-checkout architecture. No open product decisions: one booker receives named participant tickets after atomic payment confirmation.

Implement a service-only durable outbox claim/finish protocol. Claims use a lease token, bounded batch, capped exponential backoff, and explicit grants. Concurrent workers cannot claim the same live lease. Completion from an obsolete worker cannot overwrite a newer lease. Transport is at-least-once: SMTP acceptance followed by process loss can produce a duplicate email, never duplicate tickets or payment mutations. Document this honestly rather than claim exactly-once delivery.

Add a default-disabled server-only worker using TICKET_EMAIL_SECRET. Read trusted site/function URLs, confirmed booker email, original captured total, and current paid registrations. Skip refunded tickets. All-refunded orders close the delivery without email. Render names, one QR/link per active ticket, original booking total and active ticket count with escaped content. Do not require optional check-in in email copy. Failures leave the booking paid and retry later.

Validate local migration, claim concurrency/stale lease tests, template escaping/count tests, worker authorization and failures with mocked email, Deno checks, full backend/shared suite excluding separately configured fake-provider backend.test.ts. Update deployment instructions and roadmap. No hosted activation or external email send.

Payment-session recovery/expiry, free fulfillment and grouped checkout UI remain separate slices.

Validation completed: focused53 and full593 backend/shared tests passed, Deno and whitespace checks passed. See `.claude/reports/2026-09-17-group-ticket-delivery-report.md`. Actual Mailpit delivery and scheduler activation remain release checks.
