# Bot protection rollout

Status: implemented and deployed to the staging web and backend environments. Provider resources, Edge secrets, the rate-limit migration, the protected inquiry function, and both web clients are live. The mobile build and Supabase Auth activation remain pending. Production remains unchanged.

All provider resources must be owned by `support.racepace@gmail.com`. Do not create Race Pace CAPTCHA resources under a personal account.

## Protected surfaces

| Surface | Protection | Why |
| --- | --- | --- |
| Public organizer inquiry | Google reCAPTCHA Enterprise plus durable IP and email limits | The request sends an external email to the organizer inbox. |
| Runner password sign-in | Cloudflare Turnstile through Supabase Auth | Reduces credential-stuffing traffic. |
| Runner password signup | Cloudflare Turnstile through Supabase Auth | Reduces automated account creation and confirmation email abuse. |
| Runner password reset | Cloudflare Turnstile through Supabase Auth | Reduces reset-email abuse. |
| Admin password sign-in | Cloudflare Turnstile through Supabase Auth | Protects the public staff authentication endpoint. |
| Admin password reset | Cloudflare Turnstile through Supabase Auth | Reduces reset-email abuse. |
| Mobile password sign-in and signup | Hosted Turnstile challenge, returned through `racepace://captcha` | The shared Supabase project requires the same valid token for mobile clients. |

Google OAuth is excluded because its provider flow has separate abuse controls. Authenticated registration, payment, profile, ticket and admin mutations remain protected by sessions, authorization and row-level security instead of CAPTCHA challenges.

## Provider setup

### Google reCAPTCHA Enterprise

1. Use `support.racepace@gmail.com` in Google Cloud.
2. Select the existing `Race Pace` project (`race-pace-504614`).
3. Use the enabled reCAPTCHA Enterprise API and create score-based website keys for staging and production.
4. Restrict each key to the exact environment hostnames.
5. Create a server credential restricted to the reCAPTCHA Enterprise API.
6. Save the browser site key in the site environment. Save the project ID, API credential and matching site key as Edge Function secrets.
7. Set `RECAPTCHA_ALLOWED_HOSTNAMES` to the exact hostnames accepted by that environment. Start with `RECAPTCHA_MIN_SCORE=0.7` and review rejected traffic before tuning.

The support-owned `Race Pace` project now has separate staging and production score-based keys. Its server credentials are restricted to the reCAPTCHA Enterprise API. Billing remains disabled, so the project stays on the Essentials allowance and fails closed after its free assessment quota instead of charging automatically.

### Cloudflare Turnstile and Supabase Auth

1. Use `support.racepace@gmail.com` in Cloudflare.
2. Create separate managed widgets for staging and production.
3. Allow the runner, admin and hosted mobile-challenge hostnames for each environment.
4. Save the public widget key in both Next applications.
5. Save `EXPO_PUBLIC_SITE_URL` in the mobile build so it opens the matching hosted runner site.
6. In each Supabase project, choose Turnstile under Authentication > Attack Protection and save the matching secret.
7. Keep the Supabase CAPTCHA switch disabled until all web and mobile clients containing this implementation are deployed and verified.

Separate managed staging and production widgets now exist under the support-owned Cloudflare account. The staging widget allows the runner and admin staging hosts. The production widget allows the runner, apex, and admin production hosts. Hosted Supabase CAPTCHA remains disabled in both environments.

## Environment variables

| Runtime | Variable |
| --- | --- |
| Runner site | `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` |
| Admin console | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` |
| Mobile build | `EXPO_PUBLIC_SITE_URL` |
| Organizer inquiry Edge Function | `GOOGLE_CLOUD_PROJECT_ID`, `RECAPTCHA_ENTERPRISE_API_KEY`, `RECAPTCHA_ENTERPRISE_SITE_KEY`, `RECAPTCHA_ALLOWED_HOSTNAMES`, `RECAPTCHA_MIN_SCORE`, `INQUIRY_RATE_LIMIT_SALT` |
| Supabase Auth | Turnstile secret stored in hosted CAPTCHA settings |

Public keys are safe in client bundles. Google API credentials, Turnstile secrets and the rate-limit salt are secrets and must not enter Git or browser-visible variables.

## Cost guardrails

Cloudflare Turnstile is on its free plan with unlimited challenges, subject to Cloudflare's documented widget and hostname limits. Google Fraud Defense Essentials includes 10,000 assessments per calendar month for this project. Billing is disabled, so assessment requests fail after the included quota instead of creating charges.

Before enabling Google Cloud billing, add a budget alert and approve the expected inquiry volume. This rollout does not enable billing.

## Current staging state

| Item | Status |
| --- | --- |
| Google and Cloudflare provider resources | Created under `support.racepace@gmail.com` |
| Edge Function secrets | Saved for staging |
| Durable rate-limit migration | Applied to staging |
| Protected organizer inquiry | Active; an invalid token returns HTTP 403 before email delivery |
| Runner and admin public keys | Saved for the `staging` Vercel branch |
| Runner and admin deployment | Ready on both staging custom domains; all password surfaces display Turnstile |
| Mobile build | Pending |
| Supabase Auth Turnstile switch | Disabled until all clients are verified |
| Production | Unchanged |

## Activation order

1. Create separate staging provider resources and save staging secrets.
2. Apply the rate-limit migration and deploy the updated organizer inquiry to staging.
3. Deploy the runner and admin web apps to staging.
4. Build a staging mobile client with the matching site URL.
5. Verify inquiry rejection and delivery, then verify every password flow on all three clients.
6. Enable Turnstile in staging Supabase Auth and repeat every password flow.
7. Repeat the same sequence in production. Enable production Supabase CAPTCHA last.

Enabling hosted CAPTCHA before the updated mobile build is available will break mobile password sign-in and signup.

## Rollback

If password authentication fails after activation, disable Supabase CAPTCHA first. This restores password flows without changing user sessions or data. Keep the new clients deployed while diagnosing provider hostname, widget and secret mismatches.

If organizer inquiries fail, inspect the sanitized Edge Function rejection category. Restore the prior function only after confirming the external inbox will not be exposed without an equivalent server-side check. Removing provider secrets while the protected function is active intentionally fails closed.
