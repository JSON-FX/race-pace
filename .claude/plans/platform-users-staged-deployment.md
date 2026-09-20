# Feature: Platform users directory and staged UI deployment

The following plan is complete for the approved Table + Inspector direction. Validate the referenced patterns before each change and keep every production-facing operation read-only until the staging gate passes.

## Feature Description

Add a super-admin-only Platform Users page to the admin console. It lists Supabase Auth accounts, sign-up provider, site registration date, current and historical event registrations, managed Race Passports, and the latest payment context. A right-side inspector shows account and participant detail using stored photos when available and initials otherwise. Super admins can suspend or restore ordinary accounts through Supabase Auth without deleting application data.

This deployment also includes the approved public-site and admin-shell feedback: dedicated inquiry page, inquiry success replacement, nationwide footer copy, Quezon address, sidebar logo, clearer organization switcher, and compact commission guidance.

## User Story

As a Race Pace platform super admin, I want one safe account directory so that I can understand user activity and suspend access without changing registrations, payments, tickets, or Race Passports.

## Problem Statement

Auth accounts, profiles, registrations, payments, and Race Passports currently live across separate Supabase surfaces. The admin console has no platform-wide account view. Supabase Auth administration requires a trusted server boundary and must never expose the service-role key to the browser.

## Solution Statement

Create a super-admin-gated Edge Function that lists Auth users and assembles read-only activity snapshots with service-role queries. Add a native Auth ban action with refresh-session revocation and guardrails for the caller and super-admin accounts. Render the approved table and Sheet inspector in the admin app. Deploy application and Supabase changes to staging, verify with staging-only accounts, then promote the reviewed versions to production without adding data.

## Out of Scope / Non-Goals

- No editing or deleting user profiles, registrations, payments, tickets, or Race Passports.
- No synthetic users or registrations in production.
- No email notification when an account is suspended or restored.
- No claim that native suspension invalidates an already-issued access token immediately. The configured maximum window is one hour.
- No deployment of unrelated dirty files from the original checkout.

## Feature Metadata

**Feature Type**: New capability and UI refinement
**Estimated Complexity**: High
**Primary Systems Affected**: Admin Next.js app, public Next.js app, Supabase Auth, Edge Functions, migration history
**Dependencies**: Existing Supabase Auth users, profiles, registrations, payments, runner passports, and role model

## Related Work

**Implements**: Approved Table + Inspector prototype reviewed locally
**Epic**: none

---

## CONTEXT REFERENCES

### Relevant Codebase Files

- `apps/web/app/(admin)/organizations/page.tsx` - super-admin page gate, platform scope band, table composition.
- `apps/web/lib/queries/roles.ts` - authoritative `isSuperAdmin` resolution.
- `apps/web/lib/nav-items.ts` - shared Platform navigation model.
- `apps/web/components/ui/sheet.tsx` - right-side inspector primitive.
- `apps/web/app/(admin)/organizations/org-actions.tsx` - client Edge Function invocation and error handling.
- `supabase/functions/org-provision/index.ts` - service-role Auth admin and super-admin authorization boundary.
- `supabase/functions/_shared/cors.ts` - browser-facing Edge CORS policy.
- `supabase/functions/_shared/supabase.ts` - service-role client construction.
- `supabase/migrations/20260916050940_participant_passport_foundation.sql` - Race Passport and manager relationships.
- `supabase/migrations/20260916170055_group_order_foundation.sql` - assisted booking ownership.
- `supabase/migrations/20260718183018_registrations_payments.sql` - registration and single-payment foundation.
- `docs/previews/platform-users-five-options.html` - approved information architecture and visual direction.

### New Files to Create

- `supabase/functions/_shared/platformUsers.ts` - pure aggregation and display helpers.
- `supabase/functions/_shared/platformUsers.test.ts` - provider, suspension, and aggregation tests.
- `supabase/functions/platform-users/index.ts` - privileged list/suspend/restore endpoint.
- `supabase/functions/platform-users/index.test.ts` - endpoint authorization and mutation tests where practical.
- `supabase/migrations/<generated>_platform_user_session_revocation.sql` - service-role-only session revocation RPC.
- `apps/web/lib/queries/platform-users.ts` - typed server query wrapper.
- `apps/web/app/(admin)/users/page.tsx` - super-admin page and initial data load.
- `apps/web/app/(admin)/users/page.test.tsx` - route authorization tests.
- `apps/web/app/(admin)/users/users-directory.tsx` - searchable table and Sheet inspector.
- `apps/web/app/(admin)/users/users-directory.test.tsx` - directory interaction and suspension tests.
- `apps/site/app/inquiry/page.tsx` and test - dedicated inquiry route.

### Relevant Documentation

- [Supabase listUsers](https://supabase.com/docs/reference/javascript/auth-admin-listusers) - server-only Auth user pagination.
- [Supabase updateUserById](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid) - native `ban_duration` support.
- [Supabase user sessions](https://supabase.com/docs/guides/auth/sessions) - access-token and refresh-session behavior.
- [Supabase user management](https://supabase.com/docs/guides/auth/managing-user-data) - native bans do not invalidate existing access tokens.

### Patterns to Follow

- Gate the page with `getMyRoles().isSuperAdmin` and `notFound()` before fetching platform data.
- Repeat authorization inside the Edge Function because the service-role client bypasses RLS.
- Keep the service-role key only inside Supabase Edge Functions.
- Use integer centavos and existing payment method labels/assets.
- Use stored `profiles.avatar_url` for claimed accounts and Race Passports; use initials for managed participants without a claimed profile.
- Use the shared Platform navigation model so sidebar, command palette, and mobile More menu cannot drift.

---

## IMPLEMENTATION PLAN

### Phase 1: Isolated foundation

- Work from `origin/staging` in the clean `codex/platform-users-deployment` worktree.
- Generate a new migration with the Supabase CLI.
- Add a service-role-only RPC that deletes refresh sessions for one target user.
- Add pure data mapping helpers and unit tests.

### Phase 2: Privileged Supabase endpoint

- Add a `platform-users` Edge Function.
- Verify the caller with the bearer token and require a `super_admin` role.
- Paginate Auth users and read only the matching profile, Passport, registration, event, category, and payment rows.
- Support `list`, `suspend`, and `restore` actions.
- Reject self-suspension and any super-admin target.
- Ban for 100 years on suspend, revoke refresh sessions, and use `ban_duration: "none"` on restore.

### Phase 3: Admin experience

- Add `/users` under the Platform navigation group.
- Render the approved directory table with search and provider/status filters.
- Open a clean right-side Sheet inspector with account, events, payments, and Race Passport tabs.
- Make every Race Passport row open a nested participant detail view.
- Use actual provider/payment logos and stored participant photos when available.
- Add suspend/restore confirmation with the one-hour access-token limitation.

### Phase 4: Approved UI feedback

- Port only the selected public and admin UI feedback into the clean branch.
- Keep the inquiry submission contract aligned with the staged organizer-inquiry function.
- Preserve all existing functionality and tests.

### Phase 5: Validation and staged rollout

- Run focused tests after each component.
- Run all site, admin, backend/shared tests and both Next typechecks.
- Review the exact branch diff and confirm no unrelated files.
- Commit, push, and open a pull request to `staging`.
- Wait for the exact staging deployments, apply the generated migration and Edge Function to staging, then test the page and suspend/restore flow with existing staging accounts only.
- After successful staging verification, promote the identical reviewed application commit, migration, and Edge Function version to production. Do not create production test data.

## STEP-BY-STEP TASKS

### CREATE the session revocation migration

- **IMPLEMENT**: service-role-only RPC accepting a target user UUID and deleting `auth.sessions` rows.
- **GOTCHA**: revoke PUBLIC execution explicitly and grant only `service_role`.
- **VALIDATE**: `pnpm exec supabase db reset && pnpm exec vitest run supabase/tests/function-grants.test.ts`
- **SATISFIES**: suspension stops refresh tokens without deleting user data.

### CREATE the Platform Users Edge Function

- **IMPLEMENT**: list, suspend, and restore actions with Auth admin pagination and service-role reads.
- **PATTERN**: `supabase/functions/org-provision/index.ts`.
- **GOTCHA**: repeat the super-admin check before every action; never accept target role or status from the client.
- **VALIDATE**: `pnpm exec vitest run supabase/functions/_shared/platformUsers.test.ts`
- **SATISFIES**: secure data boundary and suspension control.

### CREATE the admin Platform Users page

- **IMPLEMENT**: typed query, route, table, inspector, nested Passport detail, filters, and confirmation controls.
- **PATTERN**: Organizations page gate plus Sheet primitive.
- **GOTCHA**: page data is a snapshot; all mutations must re-fetch and update only status fields.
- **VALIDATE**: `pnpm --filter web exec vitest run 'app/(admin)/users/*.test.tsx'`
- **SATISFIES**: every approved information requirement.

### UPDATE shared navigation

- **IMPLEMENT**: add Users to the Platform group and cover visibility tests.
- **PATTERN**: `apps/web/lib/nav-items.ts`.
- **VALIDATE**: `pnpm --filter web exec vitest run components/Sidebar.test.tsx`
- **SATISFIES**: discoverability for super admins only.

### UPDATE public and admin UI feedback

- **IMPLEMENT**: dedicated inquiry page, success state, footer copy/address, hero eyebrow removal, admin logo, organization switcher label, commission tooltip/disclosures.
- **GOTCHA**: port only reviewed UI hunks from the dirty checkout.
- **VALIDATE**: focused site and admin component tests.
- **SATISFIES**: browser feedback included in this task.

### VALIDATE and deploy

- **IMPLEMENT**: full validation, exact-diff review, commit, push, staging PR, staging Supabase apply, staging browser verification, production promotion after success.
- **GOTCHA**: never run a production database command before staging verification.
- **VALIDATE**: all commands in the validation section and hosted readbacks.
- **SATISFIES**: safe deployment request.

## TESTING STRATEGY

### Unit Tests

- Provider detection for Google, email/password, and multi-provider accounts.
- Future and expired `banned_until` values.
- Event status classification and latest-payment selection.
- Super-admin page denial and navigation visibility.
- Directory search, filters, inspector, Passport drill-down, and suspension confirmation.

### Integration Tests

- Local Supabase migration reset and function-grant audit.
- Edge Function authorization with ordinary and super-admin users.
- Staging list and suspend/restore using an existing non-production account.

### Edge Cases

- Auth user without profile row.
- Profile without a photo.
- Managed Passport without a claimed account or photo.
- User with no registration or payment.
- Group booking payment context.
- Protected caller and super-admin target.
- More than one Auth admin page.

## VALIDATION COMMANDS

### Level 1: Syntax and types

- `pnpm --filter site typecheck`
- `pnpm --filter web typecheck`

### Level 2: Unit tests

- `pnpm --filter site test`
- `pnpm --filter web test`
- `pnpm test`

### Level 3: Supabase

- `pnpm exec supabase db reset`
- `pnpm exec supabase migration list --local`
- `pnpm exec vitest run supabase/tests/function-grants.test.ts`

### Level 4: Manual validation

- Super admin sees Platform Users; ordinary org admins receive 404.
- Search and filters preserve correct counts.
- User inspector shows account, all events, latest payment, and Race Passports.
- Managed Race Passport detail shows its own event history and payment context.
- Suspend and restore update staging Auth status without changing business rows.
- Public inquiry and admin feedback match the approved screenshots at desktop and compact widths.

## ACCEPTANCE CRITERIA

- [ ] Only super admins can reach or call Platform Users.
- [ ] Every registered Auth account appears with correct provider and creation date.
- [ ] Account and managed Passport event histories are visible.
- [ ] Latest payment context is shown when present.
- [ ] Stored photos appear when available; initials are the fallback.
- [ ] Suspension and restoration preserve all application data.
- [ ] Self and super-admin suspension are blocked.
- [ ] All automated validation passes.
- [ ] Staging application and Supabase changes are verified before production.
- [ ] Production receives the identical reviewed versions without synthetic data.

## COMPLETION CHECKLIST

- [ ] Implementation tasks complete
- [ ] Full validation passes
- [ ] Exact diff reviewed
- [ ] Staging PR merged and deployments Ready
- [ ] Staging Supabase migration and Edge Function verified
- [ ] Staging browser verification complete
- [ ] Production promotion complete
- [ ] Production readback complete
- [ ] Launch progress updated

## OPEN QUESTIONS / ASSUMPTIONS

- Assumed: this request authorizes deployment of the approved Platform Users feature and the explicitly attached public/admin UI feedback.
- Assumed: staging is the mandatory first target, followed by production only after successful staging verification.
- Assumed: native Supabase suspension is acceptable with an existing access-token window of at most one hour. Refresh sessions are revoked immediately.
- Assumed: suspension controls ordinary accounts only. The caller and all super-admin accounts are protected from this interface.

## NOTES

The original checkout remains dirty with unrelated bot protection, payment, event, email, and documentation work. This branch begins at current `origin/staging` and will receive only approved files and new Platform Users implementation.

## AMENDMENTS
