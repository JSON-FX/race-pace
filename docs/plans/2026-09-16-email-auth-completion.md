# Email confirmation and password recovery

Status: COMPLETE locally. Implementation, automated checks, and both browser password reset/sign-in journeys passed. Scope settled by the recorded auth gaps and user approval.

## Goal and inherited decisions
Runners can confirm signup and resume their destination. Runners and admin staff can request a recovery email and set a new password. Use existing Supabase SSR cookies and UI components, local Mailpit, and the in-app Browser. No migrations or hosted changes.

## Design
Signup sends an explicit /auth/callback redirect, preserves a safe next destination, and displays check-email when no session is returned. A dedicated /auth/recovery page in each app explicitly redeems recovery credentials, validates the user, and only then displays the password form. Disable automatic URL detection on this isolated client to avoid double redemption. Handle PKCE codes and default-template recovery fragments. Existing sessions alone never enable the recovery form. These UI checks do not replace Supabase's authenticated updateUser authority. Clear credentials from browser history immediately. After changing password, sign out and offer sign-in.

## Tasks and validation
1. Site signup helper, confirmation feedback and callback errors; add helper/UI tests. Validate site focused Vitest.
2. Both apps forgot-password request and recovery form, admin public route whitelist; tests for absent, wrong-type, failed and successful recovery credentials, password mismatch and update errors. Validate each app focused Vitest and typecheck.
3. Local Auth redirect allowlist for dedicated recovery pages, retain default email templates. Restart local Auth stack preserving data if required. Verify SMTP still Mailpit.
4. Run both app suites and typechecks, review diff, test local email delivery and acceptance in Browser. Record test boundaries and any manual credential-entry requirement.

## Files and references
- apps/site/lib/auth.ts; app/sign-up/page.tsx; app/auth/callback/route.ts; app/sign-in/SignInForm.tsx
- apps/web/app/(auth)/login/page.tsx; lib/routes.ts; lib/supabase/client.ts
- New app-specific lib/password-recovery.ts, forgot-password/page.tsx, auth/recovery/page.tsx and focused tests.
- supabase/config.toml; docs/issues/2026-09-16-runner-email-auth-gaps.md
- https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail
- https://supabase.com/docs/guides/auth/passwords

## Acceptance
- Confirmation-required signup stays on check-email; immediate session resumes safe next.
- Successful real email confirmation establishes session; invalid link offers retry/sign-in.
- Forgot-password feedback does not reveal account existence.
- Recovery never uses a pre-existing session when link is invalid or absent.
- Successful update permits new-password sign-in; expired/reused links fail safely.
- Admin invitation/capability routes remain intact.
- Test credentials and tokens never enter versioned artifacts.

## Boundaries
No production readiness claim until the remaining marketplace checklist is complete. Hosted redirect allowlist changes remain a deployment requirement. No commit or push included.
