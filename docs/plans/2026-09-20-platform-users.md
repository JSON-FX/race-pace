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

Implementation and local validation are complete. All site, admin, backend, typecheck, build, grant, authorization, and local suspend/restore checks pass. Hosted staging and production are pending.
