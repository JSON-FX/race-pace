# Explicit zero-commission organizer provisioning

## Goal

Let a platform super admin create a pilot organizer with an explicit 0% or ₱0 Race Pace commission. Keep the normal 3% form default so an omitted term never silently becomes zero.

## Verified cause

The production form disables submission when the percentage or fixed amount is zero. `org-provision` independently returns `zero_commission` for those values. The production `organizations` table permits nonnegative fixed commission and zero percentage, and the payment ledger already supports zero-commission organizations.

## Tasks

1. Require an explicitly supplied, finite nonnegative rate or flat amount in `org-provision`; accept zero and keep invalid or missing terms rejected. Validate with a focused backend test.
2. Allow an explicitly entered zero in the new-organization form, update its helper text, and keep the 3% initial value. Validate with the existing admin component test suite.
3. Run both app type checks, site/admin tests and backend CI, then review and deploy the narrow fix to staging and production. Reopen the synthetic production organizer form and verify creation at zero commission before a sandbox purchase.

## Scope

No migration or pricing formula change is needed. Production remains behind Coming Soon, and sandbox payment testing still requires user action at the PayMongo checkout.
