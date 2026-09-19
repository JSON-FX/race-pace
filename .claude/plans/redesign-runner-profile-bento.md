# Redesign runner profile with Summit Bento

## Goal

Replace the raw `/profile` and `/bookings` presentation with the approved Summit Bento direction. Preserve photo management, Passport management, saving, assisted-booking actions and authorization behavior.

## Confirmed design decisions

- Use the site's existing semantic color, typography, radius and spacing tokens.
- Reuse the existing Button, Card, Badge, Input, Label and Separator components.
- Use a responsive bento layout that stacks cleanly on small screens.
- Keep the cover free of decorative contour or orbital lines.
- Place cover-photo actions on the left.
- Require a complete structured shipping address for Passport completeness and registration.
- Format runner and emergency phone inputs as `+63 XXX XXX XXXX` while typing.
- Replace the emergency relationship text field with a broad native dropdown.
- Keep `Other` and preserve a legacy value if it is not in the new list.

## Implementation tasks

### 1. Shared Passport contract

Files:

- `packages/shared/src/passport.ts`
- `supabase/functions/_shared/passport.ts`
- `packages/shared/src/passport.test.ts`
- registration fixtures that represent complete Passports

Make all three shipping fields required. Keep the browser and Edge validator files byte-identical. Add a shared emergency-relationship list without restricting historical database values at the schema boundary.

### 2. Reusable account navigation and phone formatting

Files:

- `apps/site/components/AccountSectionNav.tsx`
- `apps/site/lib/phone.ts`
- `apps/site/lib/__tests__/phone.test.ts`

Add a token-based two-tab account switcher for Race Passport and Bookings I manage. Add a pure Philippine mobile-number formatter with focused tests for local, country-code and partial input.

### 3. Summit Bento profile

Files:

- `apps/site/app/profile/page.tsx`
- `apps/site/app/profile/ProfileForm.tsx`
- `apps/site/app/profile/PassportPhotos.tsx`
- `apps/site/app/profile/PassportEditor.tsx`
- `apps/site/app/profile/ShippingAddress.tsx`
- profile component tests

Build the photo hero, career figures, saved-runner rail and grouped form from existing components. Use accessible native details and select elements where the component library has no equivalent. Retain every mutation and error path.

### 4. Bento managed bookings

Files:

- `apps/site/app/bookings/page.tsx`

Use the same account navigation and card language. Preserve the query and current ticket/payment destinations. Show event, category and status in a scannable responsive layout.

### 5. Registration integration and documentation

Files:

- `apps/site/app/register/[categoryId]/page.tsx`
- `docs/plans/2026-09-16-assisted-registration-passport-revisions.md`
- `docs/operations/launch-progress.md`

Include shipping columns in the single-participant registration check. Update the previous optional-shipping decision and the launch ledger to record the newly confirmed requirement and implementation status.

## Validation

1. Run focused shared-contract, phone, profile, address and registration tests.
2. Run the full site test suite and site typecheck.
3. Run shared/backend Passport tests that cover the mirrored Edge contract.
4. Check formatting with `git diff --check`.
5. Review the full scoped diff for behavior regressions and unrelated changes.
6. Verify the responsive profile and bookings views at phone, tablet and desktop widths when a local authenticated surface is available.

## Constraints

- Work on the current feature branch without committing.
- Preserve all unrelated dirty-worktree changes.
- Do not change database migrations or row-level security.
- Do not add a new component dependency.
