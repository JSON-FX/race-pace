# Staff invitation fixes

Status: implemented locally; verification recorded in the readiness checklist. Root cause: docs/issues/2026-09-16-staff-invitation-readiness.md (reproduced locally).

1. Resolve both SMTP and manual invitation destinations from current role capabilities. A new server completion route reads the session after fragment exchange. Legacy `/team` links fall back to the operational home for non-admin staff.
2. Add explicit all-events/specific-event selection for marshal and claiming invitations and member editing. Reject foreign-org events. Preserve omitted scope on ordinary role updates. Make role replacement/removal atomic under an organization lock so validation cannot delete the previous grant or remove the last admin concurrently.
3. Create a missing unconfirmed identity without sending email, assign the role, then send a sign-in email through configured Supabase SMTP. Existing users receive a real sign-in email too. Report delivery separately from membership. On email failure return a manual link and clear unsent feedback. Provide a resend action that does not change permissions.
4. Add targeted regression tests and a local endpoint/browser/Mailtrap test, respecting the sandbox's remaining email quota. Record failures and limits. No hosted changes, commits or pushes.

The password/Google login options remain unchanged; staff can request a fresh sign-in email through their organizer's resend action. A self-service passwordless login feature is outside these three fixes.
