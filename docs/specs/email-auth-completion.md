# Email authentication completion

Runners receive a check-email state when signup creates no session. The explicit callback URL uses the existing SSR PKCE exchange and validated destination cookie. Email links must open in the requesting browser. Existing Google login remains on the same callback.

Both apps expose a public forgot-password page and dedicated /auth/recovery page. Reset requests use generic account-existence feedback. Recovery explicitly redeems a PKCE code, recovery hash or recovery fragment using an isolated SSR client with automatic URL detection disabled. Missing, failed and wrong-type links never enable the password form merely because a session already exists. One-time credentials are removed from browser history immediately.

Before password update, getUser validates the identity and compares it with the recovered account. Supabase Auth owns password mutation authorization. Recovery state is held only in memory; reloading a consumed link asks for a new one. Success signs out and provides a fresh sign-in link. Sign-out failure is reported separately from an already-successful password update. No roles or organization memberships change.

Admin invitations retain their existing handlers and capability routing. No database migration is required. Deploying requires exact /auth/recovery redirect URLs for both production origins in hosted Supabase Auth. Local config alone does not change hosted settings.
