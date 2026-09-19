# Controlled pilot acceptance

Updated: 2026-09-19

Pilot organizer: To be created during live onboarding

Pilot event: To be created by the accepted organizer

Release scope: runner website and organizer admin console

Payment gateway: PayMongo

## Platform-owner acceptance

The platform owner accepted the proven MVP flow as the launch baseline on 2026-09-19. The accepted path covers organizer setup, event publishing, runner registration, PayMongo checkout, QR ticket delivery, admin accounting and refunds.

## Acceptance evidence

| Capability | Result |
|---|---|
| Organizer and event setup | Passed in staging and protected production |
| Runner account and Race Passport | Passed |
| Organizer waiver and registration | Passed |
| PayMongo GCash sandbox checkout | Passed |
| Provider fee and organizer net reconciliation | Passed |
| QR ticket and ticket email | Passed |
| Full refund, ticket invalidation and slot release | Passed |
| Admin Registrations, Payments and Settlement | Passed |
| Production QA cleanup | Passed; zero organizations, events, registrations and payments remain |
| Production database and Storage protection | Passed; physical database backup plus verified 48-object Storage snapshot |

## Pilot limitations

- The initial pilot uses one runner per checkout.
- Assisted and group checkout remain unavailable until their separate acceptance tests pass.
- GCash is the accepted payment method for the first pilot flow.
- A distinct second provider capture is quarantined, alerts platform staff and blocks payout. Issue #51 tracks the operator refund workflow.
- Physical camera scanning and the organizer's device exercise remain part of the organizer handoff.

## Organizer sign-off

The technical acceptance package is complete. The first real organizer must confirm these operational points before public opening:

- Event details, categories, prices, capacity and waiver are correct.
- Organizer staff can access the admin console.
- The organizer accepts the one-runner-per-checkout and GCash pilot limits.
- Staff understand kit release, optional check-in and the escalation route for payment anomalies.
- The organizer approves opening registration.

Status: **Ready for real-organizer onboarding and sign-off.** Public registration remains behind Coming Soon until that confirmation and the live PayMongo cutover are complete.
