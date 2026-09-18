# Runner email authentication follow-up

Date: 2026-09-16. Local web/admin email verification with Mailpit.

## Password recovery is not implemented in the application

Both sign-in interfaces omit a forgot-password action. Source search found no `resetPasswordForEmail` or password-update UI in either Next app. A real local Auth recovery request successfully sent Mailpit message `1WelUtHvpchwXQuMuqjCPG`. Its link was accepted in the in-app Browser but landed on the public homepage with no reset form. No password was changed. This is a working mail transport with an incomplete product flow.

Needed: request screen with non-enumerating feedback, recovery-only completion route/session handling, new-password form, expired/reused-link handling, and tests for successful update plus subsequent login. Keep recovery separate from staff invitation token handling.

## Runner confirmation does not complete sign-in in the tested email-link flow

A new runner was created through the public Supabase signup API, using the same email/password arguments as `apps/site/lib/auth.ts`. Mailpit message `6pQ4ODYTORG2fEdeeURPb2` confirmed the address, but its implicit-flow link landed on the homepage with a token fragment. Direct `/races` navigation required sign-in. Signing in with the account's existing password succeeded and displayed My Races.

Boundary: account creation used the API, not the browser signup form. The browser form uses the SSR client's PKCE flow; that exact signup-to-callback flow still needs a dedicated replay. Source inspection shows no `emailRedirectTo` in `signUpWithPassword`, and the signup page redirects immediately without checking whether a session was returned. Do not report browser signup completion as passing based on the successful email capture.

Needed: explicit confirmation destination, check-your-email state when confirmation is required, successful callback/session establishment, safe destination handling, and expired/reused link feedback.

All identities are local sample data. Mailtrap and hosted settings were unchanged.

## Implementation follow-up

Implemented in `docs/plans/2026-09-16-email-auth-completion.md`. The actual browser signup flow now shows check-email and its real Mailpit confirmation establishes the runner session at My Races. Both new recovery flows reach password entry through real Mailpit PKCE emails. Invalid/reused-link browser checks and real Auth API expiry/update/login checks pass. Full browser password submission awaits user handoff; see the readiness checklist for the exact evidence boundary.

### Final browser handoff completed
User completed both password changes. Admin new-password sign-in opened the scoped Race kits page. Runner new-password sign-in succeeded and opened protected My Races. Earlier pending browser handoff notes are now resolved. This authentication slice is complete locally; hosted redirect configuration remains a release task.
