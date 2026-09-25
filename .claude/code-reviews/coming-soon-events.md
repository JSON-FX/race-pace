# Coming Soon events code review

**Scope:** `codex/coming-soon-events` rebased on current `origin/staging`.

**Stats:** 109 changed files in the feature commit, including the prototype, five additive migrations, runner/admin code, and focused tests.

## Review result

Code review passed. No confirmed unresolved technical issue remains. The review checked organization scope, profile and reservation row-level security, service-role money functions and explicit grants, PayMongo session binding, duplicate capture handling, event capacity, per-Passport conversion, deadline handling, fee arithmetic, and public capacity labels. The rebase retained the newer organizer featured-image field while adding Coming Soon capacity to the same query.

Issues found and fixed during review:

- An unavailable payment method created a local hold before refusing checkout. Method availability is now checked first.
- A definitive PayMongo refusal could leave a hold if release failed. The endpoint now reports reconciliation until release succeeds.
- An expired reservation kept its browser idempotency key and blocked a fresh attempt. The runner now clears that key after an expired or unpayable attempt.
- The payout Refresh button was blocked by the transfer reference field's browser validation. The field is now validated only for Record payout.
- A paid reservation with a negative processor fee could fail a ledger constraint instead of entering review. It now records a review outcome.
- Category-only slot counts overstated event availability after reservation holds. Public counts are hidden for events with a total event capacity.
- Organizer profile reads originally required a registration, so a reservation-only booker had no name or avatar in Payments. An additive policy now grants scoped access to bookers in the organizer's own reservations.

## Validation limits

Local Docker browser checks covered the admin-created category-free event, one paid place, one paid checkout for two Passports, actual processor fees, runner receipt, organizer roster, payment filters, and local capacity refusal. The rebased commit passed 479 runner tests, 927 admin tests, 766 backend tests, both typechecks, and both isolated production builds. Hosted staging deployment, schedules, email delivery, and end-to-end conversion remain release checks. Production is untouched.
