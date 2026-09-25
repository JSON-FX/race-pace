# Platform users implementation plan

## Scope

- Add a super-admin-only `/users` console route.
- Add a searchable table and right-side inspector.
- Show account provider, registration date, events, payments, and managed Race Passports.
- Add protected suspend and restore actions.
- Apply the approved public-site and admin interface feedback bundled with this release.

## Implementation

1. Add a service-role-only session-revocation RPC in a new migration.
2. Add a JWT-verified `platform-users` Edge Function with independent super-admin checks.
3. Join Auth users to profiles, registrations, payment records, and Race Passports.
4. Add the Users navigation item, page, filters, inspector, and confirmation flow.
5. Add actual provider/payment marks and stored avatars where available.
6. Implement the inquiry page, nationwide copy, footer address, sidebar logo, organization switcher label, and commission disclosures.
7. Validate local database reset, grants, function authorization, suspend/restore, type checks, tests, and builds.

## Deployment

1. Merge the reviewed branch into `staging` through a pull request.
2. Apply the migration and deploy the Edge Function to staging Supabase.
3. Verify the staging site and admin deployments with existing staging accounts.
4. Confirm no registration, payment, profile, or Race Passport rows changed.
5. Promote the same commit to production.
6. Apply the same migration and Edge Function to production Supabase.
7. Run read-only production smoke checks. Do not create synthetic production data.

## Status

Implementation, staging verification, and production release are complete. All site, admin, backend, typecheck, build, grant, authorization, and local suspend/restore checks pass. Staging and production CI, both application deployments, the migration, the Edge Function, and read-only smoke checks pass. Production before-and-after counts match exactly, and no synthetic data or live account suspension was used for production verification.

## Passport details follow-up · 2026-09-25

1. Extend the existing super-admin Passport projection with stored identity, contact, kit, legacy, and shipping fields. Resolve shipping location names from the existing PSGC tables.
2. Replace the nested Passport drill-down with independent disclosure cards in Overview and Race Passports. Keep registrations, events, and payment history inside each card.
3. Verify one own Passport, multiple managed Passports, missing values, keyboard disclosure, and narrow widths. Run admin tests and typecheck, and validate the database projection locally.
4. Release only the admin application and the changed `platform-users` Edge Function through staging first. Hosted acceptance remains required before production promotion.

Status: local implementation complete. Admin typecheck and 917 admin tests pass. The expanded database projection succeeds locally. Desktop and 320px phone browser checks found no horizontal overflow or page errors after a mobile tab and footer adjustment. The backend suite passes 691 tests; three suites need local function secrets, and one unrelated Storage test fails with database error `42P10`. No hosted service or data has changed in this follow-up.
