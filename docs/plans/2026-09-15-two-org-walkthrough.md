# Two-organization browser walkthrough

Scope: local web and admin; fake payments only. Work in progress.

Fixtures:
- North organization: QA Trail North 20260915, slug qa-trail-north-20260915, id 31f09849-8f9f-4de4-828d-02124dd90312. Admin qa-north-20260915@example.com. Created through admin UI; 3% commission, full refund.
- South organization: QA Road South 20260915, slug qa-road-south-20260915. Admin qa-south-20260915@example.com. Initial create was refused because local Supabase email limit was 2/hour. Local limit increased to 20/hour for Mailtrap testing; retry pending.
- Runner: runner-local-20260915@example.com, confirmed through Mailtrap in preceding stage.

Checks pending: both admin invitations consumed; each organizer sees only their data; event creation/publish; runner registration; sandbox checkout; payment and commission reconciliation; admin registration/export; duplicate and wrong-organization access.

Observed: organization success copy still says SMTP needs configuring even when the invitation was sent through Mailtrap. This is misleading setup guidance.

## Browser results, 2026-09-15

- South creation retry passed. Organization id: 3a4b8fce-86f0-4f13-9759-5cec8cfc99d5. Both organizer sessions verified using locally generated Auth magic links. Mailtrap invite receipt itself remains a separate check.
- North created and published `QA North Trail 10K 20260915` through the event form. Event id: 6cf4de5f-decf-4877-8bd0-7dd9abf7859f. Category 0eba8b42-9703-4c8c-974e-aa47c71cef41, 10 km, PHP 1,000, ten slots, October 25.
- South showed zero events. Opening North's exact edit URL while signed in as South returned 404. Reciprocal South event creation and private registration/payment isolation remain pending.
- Runner registered through Details → Kit → Confirm → Pay. Registration: c7b6b89a-88ad-4805-9705-cac7a527dff3. Entered full name QA Local Runner, bib name QA NORTH, birth date 1995-01-15, emergency contact QA Contact 09170000000, shirt M.
- Initial Pay failed with “Invalid checkout link”. Fixed missing return URL in FakePaymentProvider; see docs/issues/issue-local-sandbox-return.md. Retried through application Pay button and completed the sandbox checkout.
- Ticket page loaded with QR and category. Database reads confirmed paid registration and exactly one occupied slot.
- Ledger and admin Payments agree: gross 100000 centavos, platform fee 3000, processor fee 1500 (predicted), organizer net 95500. Provider fake. This does not validate PayMongo test/live processing.
- North registration list shows one paid entry and PHP 1,000 revenue. Manual check-in succeeded: attendance 1/1, recently checked in row present. Camera/physical QR scanning and replay checks remain pending.
- Registration Export CSV browser navigation was blocked by Brave (ERR_BLOCKED_BY_CLIENT); no download was produced. Do not mark export verified.

## Discrepancies to resolve

1. Full name entered in the registration form is dropped. It is absent from checkout custom_data and profile write in RegisterWizard.submit. Ticket runner is “—”; admin registration/payment runner is “—”; check-in says Unknown runner. Bib name is stored in custom_data but admin bib is blank while ticket falls back to the registration ID.
2. Ticket claims “We've also emailed this ticket to you” despite send-ticket-email logging resend_not_configured. Auth Mailtrap SMTP does not configure this separate ticket mailer.
3. Public trail event labels the 10 km distance as VERTICAL GAIN when elevation is omitted.
4. Admin manual entry is disabled. Its tooltip exposes internal RPC/Server Action implementation details.
5. Existing misleading organization SMTP success copy remains.

Validation for sandbox fix: focused provider and backend suites, 30 tests passed. Browser application-generated checkout URL now includes the nested callback correctly. No hosted functions deployed.
