# Implementation report — email authentication completion

Plan: `docs/plans/2026-09-16-email-auth-completion.md`.
Branch: `feature/admin-ui-changes`.
Status: COMPLETE locally; both browser credential handoffs and sign-ins verified.

## Changes
Runner signup has an explicit callback, safe destination and check-email state. Both apps have forgot-password and recovery pages. Recovery explicitly redeems supported credentials, rejects missing/invalid links, binds password update to the verified identity and reports success separately from sign-out failures. Admin staff invitation handling is unchanged.

## Verification
Real browser signup submission by user, Mailpit confirmation acceptance and authenticated My Races passed. Confirmation replay was rejected. Both recovery requests and email links reached the new-password form. Missing runner link and reused admin link were rejected. Separate local Auth protocol checks passed for actual expiry, password update, old/new password sign-in and replay rejection.

Browser password entry/submission and subsequent browser login are pending user action under the browser tool credential policy. This is not a full end-to-end browser reset pass.

## Deviations and release notes
No migration needed. Local stack restarted without resetting database data; Mailpit messages are ephemeral across restarts. No hosted changes. Add both production recovery URLs to hosted Supabase Auth allowlist before deploying. Existing default email templates are retained. No commit, push or deployment.

## Final automated results
- Site: 374 tests across 40 files passed.
- Admin: 800 tests across 101 files passed.
- Both app typechecks passed; both isolated Next production builds passed with final source.
- `git diff --check` passed. Root lint is a documented no-op; no lint pass claimed.
- No backend money/schema implementation changed in this slice, so the unrelated full backend suite was not repeated.

## Browser handoff follow-up
The user completed the admin kit staff password reset. The page displayed “Your password has been updated,” and its sign-in link reached the anonymous login form. Runner password entry remains pending in its separate tab. No test passwords recorded in versioned artifacts.
Admin new-password browser sign-in passed and routed to `/race-kits` with the assigned QA event. The admin recovery journey is now complete. Runner browser reset/login remains pending.

## Final runner verification
User submitted the runner password reset. Browser displayed success and reached the anonymous sign-in form. New-password sign-in succeeded, followed by authenticated My Races. Both runner and admin reset journeys now pass end to end. This supersedes the pending handoff notes above. No new code changes or deployment.
