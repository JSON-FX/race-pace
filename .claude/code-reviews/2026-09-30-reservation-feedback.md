# Category reservation feedback from hosted acceptance

## Findings and corrections

Hosted staging returned HTTP 409 for GCash and Card before creating a reservation. QR Ph proceeded through the same approved mixed-category request and completed in PayMongo's explicitly labeled test simulator. The reservation endpoint rejects inactive merchant methods as `payment_method_unavailable`; the legacy Coming Soon form already translates that code. The new screening operation helper omitted it and displayed an unhelpful retry message. Reuse the established message and explicitly preserve the existing holds and deadline.

The paid category reservation page retained legacy copy asking participants to choose categories later. Category reservations already bind each Passport to its selected category. Pass the existing category-place state into the status panel and describe saved categories. Preserve legacy categoryless reservation wording.

These are presentation corrections only. No payment request, capacity mutation, migration, provider configuration, deadline, or approval rule changes.

## Hosted evidence

Staging batch `99b0c213-c6ed-455c-bc93-88d12e021b2d` held two participants: one approved 70K participant and one 21K managed Passport requiring no review. Upload alone created no capacity claim; submitting created two. Approval set a 72-hour window from `2026-09-29T20:08:46.201382Z` to `2026-10-02T20:08:46.201382Z`.

PayMongo reservation `6f886a40-1332-4523-a622-08dd019ff9dd` completed in test mode (`livemode=false`): 80,000 centavos reservation fees, 1,218 processing, 81,218 charged, 80,000 organizer net. Both places remain held; event capacity claims remain exactly two. The screening batch is completed and its original deadline remains unchanged. No production charge or write occurred.

The submission email job completed once for the booking runner with all participants listed. Resend independently confirmed delivery of submission email `01a0eec6-2e5e-76ce-947d-37a82b54be10` and approval email `01a0eec8-ee58-70f5-8e5d-355f76ea2f42`. Both use Race Pace Staging <staging@notify.racepace.com.ph>, contain the staging banner, list both participants, and link to the authenticated staging request. Conversion and remaining hosted regression acceptance are pending.

## Validation

Runner typecheck, all 70 test files / 497 tests, and an isolated runner build with local Supabase build inputs passed. Existing backend and admin checks remain relevant because those paths are unchanged; the required complete GitHub CI check must pass before merge. No new tests merely asserting copy are added.
