# Implementation Report: Bot protection

## Summary

Implemented bot protection for the public organizer inquiry and every password-authentication entry point. The organizer path uses Google reCAPTCHA Enterprise plus durable salted-hash limits. Runner, admin, and mobile password authentication now supplies Cloudflare Turnstile tokens to Supabase Auth.

Provider activation is intentionally staged. Separate Google and Cloudflare resources exist under the support account. The staging database guard, Edge secrets, organizer-inquiry function, and both web clients are live. The mobile build and Supabase Auth activation remain pending. Production remains unchanged.

## Implemented

- Added explicit Turnstile widgets to the runner and admin applications.
- Added a hosted Turnstile bridge for the Expo mobile application.
- Added Google reCAPTCHA Enterprise token collection and server-side assessment validation.
- Added atomic organizer-inquiry rate limiting by salted IP and normalized-email hashes.
- Added explicit database grants for the rate-limit function.
- Added provider-failure states and retry-safe script loading.
- Added setup, activation, and rollback documentation.

## Validation

| Area | Result |
| --- | --- |
| Runner site | 58 files and 450 tests passed; TypeScript passed. |
| Admin console | 111 files and 886 tests passed; TypeScript passed. |
| Mobile focused scope | 8 CAPTCHA and authentication tests passed; TypeScript passed. |
| Mobile full suite | Two unrelated existing areas failed: Pay screen timeout and Event Gallery missing `SafeAreaProvider`. |
| Edge focused scope | 28 organizer, reCAPTCHA, rate-limit, and grant tests passed. |
| Backend full suite | 722 tests passed. Nine existing provider-dependent PayMongo cases failed because the local functions reached the real test provider instead of the fake checkout. |
| Migration | Applied to staging. Hosted read-back confirmed the table and service-role-only function grant. |
| Hosted inquiry rejection | Invalid staging token returned HTTP 403 `verification_failed` before delivery. |
| Whitespace | `git diff --check` passed. |

The focused security scope passes. The unrelated full-suite failures were not changed as part of this feature.

## Provider State

| Provider | Current state |
| --- | --- |
| Google Cloud | Separate staging and production score-based keys and API credentials exist under `support.racepace@gmail.com`. Billing remains disabled. |
| Cloudflare | Separate staging and production managed widgets exist under `support.racepace@gmail.com`. |
| Supabase staging | reCAPTCHA secrets, rate-limit salt, migration, and inquiry function deployed. Hosted Auth CAPTCHA remains disabled. |
| Vercel staging | Runner and admin deployments are Ready on their custom domains. All password surfaces and the hosted mobile bridge display Turnstile. |
| Production | Provider resources prepared, but no secrets, code, migration, or CAPTCHA enforcement deployed. |

## Remaining Work

1. Build and verify a staging mobile client with the matching site URL.
2. Enable Turnstile in staging Supabase Auth and repeat every password flow.
3. Monitor the Google free assessment quota and rejected inquiry categories.
4. Promote the verified configuration to production and enable production CAPTCHA last.

PR #75 merged to `staging` at `9d66a4c`. The staging backend and both web clients are deployed. The mobile build, hosted Auth activation, and all production activation remain pending at this report checkpoint.
