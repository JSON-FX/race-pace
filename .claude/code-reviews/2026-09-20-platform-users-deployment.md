# Platform users deployment review

## Outcome

Approved for staging. No blocking findings remain in the reviewed diff.

## Scope reviewed

- Super-admin Platform Users table, inspector, Race Passport drill-down, and navigation.
- Supabase Auth account listing, suspension, restoration, and refresh-session revocation.
- Dedicated inquiry page and the approved public-site and admin interface adjustments.
- New migration, grants, Edge Function configuration, tests, design specification, and rollout plan.

## Risk review

- The browser never receives the service-role key.
- The Edge Function independently verifies the caller and requires `super_admin`.
- The current operator and every super-admin account are protected from suspension.
- Suspension changes Auth state only. It does not update profiles, registrations, payments, events, tickets, or Race Passports.
- The session-revocation function is executable only by `service_role`.
- Production rollout is gated on staging application, authorization, suspension, restoration, and data-preservation checks.

## Validation evidence

- Site: 458 tests, typecheck, and production build passed.
- Admin: 903 tests, typecheck, and production build passed.
- Backend/shared: 741 tests passed after a clean local database reset.
- Platform helper: 6 focused tests passed.
- Function grants and suspension RPC: 9 focused tests passed.
- Local Edge integration listed users, protected a super admin, denied an ordinary admin, and suspended/restored a temporary local user.
- Dedicated inquiry page received desktop visual review. Admin UI is covered by component tests and the approved prototype because local CAPTCHA prevented an authenticated browser session.
- `git diff --check` passed.

## Findings

No unresolved correctness, authorization, data-integrity, or deployment-scope findings.
