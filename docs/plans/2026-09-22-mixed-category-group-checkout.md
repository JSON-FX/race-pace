# Mixed-category group checkout implementation plan

Status: in progress. Design: [mixed-category group checkout](../specs/2026-09-22-mixed-category-group-checkout.md).

## Scope

Implement the approved Trail Roster for the runner site. Extend the existing gated group order,
payment, refund, reporting and ticket-delivery paths from one category per order to one category per
participant. Validate locally before deploying the exact reviewed revision to staging.

## Tasks

1. Extend the shared and Edge Function request schemas with per-participant categories while keeping
   the legacy same-category input valid. Add focused schema and validation tests.
2. Add an additive migration. Allow mixed order headers, widen order/registration scope guards, and
   replace reservation, preparation, confirmation and refund routines with stable multi-category
   locking and per-category capacity accounting. Add rollback, concurrency, capture and refund tests.
3. Update ticket delivery so every participant carries their own category. Test rendered email and
   distinct ticket links and QR URLs.
4. Install the required official ShadCN Select and Item components. Implement the approved roster,
   category selection, per-runner details, combined summary and payment-order category display.
5. Run focused tests, database reset and the full local validation suite. Review the complete diff
   and fix every confirmed finding.
6. Open and merge the feature pull request into `staging`. Apply the additive migration and deploy
   changed Edge Functions from the exact staging commit. Enable only the staging group flags.
7. Complete a PayMongo test-mode browser booking with runners in different categories. Read back the
   order, registrations, capture, allocations, unique ticket tokens and QR responses. Record exact
   staging evidence in `docs/operations/launch-progress.md`.

## Release boundary

Do not deploy to production. Do not use production data or a live PayMongo charge. If the staging
sandbox cannot prove one payment and every individual QR ticket, leave the feature flags disabled
and report the blocker.
