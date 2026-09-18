# Super-admin organization selection

## Goal

Make the admin console's selected organization match the organization used by its events, registrations, payments and settings queries.

## Verified cause

After creating the zero-commission production sandbox organizer, the switcher displayed it. Events still listed the older Run With Point organization, including after reload. `getMyRoles()` preferred the first org-scoped admin role over `getOrgContext().activeOrgId` for a super admin. The same account held admin roles in both organizations, so the switcher and page queries disagreed.

## Change and validation

For a super admin, use the validated active organization from `getOrgContext()` first. Keep the existing role-row fallback if no active org is available. Leave non-super-admin role selection unchanged. Update the role regression test to cover a super admin who holds an admin row in another org. Run admin tests and typecheck, then switch organizations in staging and protected production to verify that the events list follows the selection.
