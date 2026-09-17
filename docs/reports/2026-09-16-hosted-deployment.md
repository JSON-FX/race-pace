# Hosted deployment — 2026-09-16

## Released revision
Source: ed8273f, exported from Git into a clean temporary directory. No local environment files were uploaded. Both apps were built with Vercel Production variables and --skip-domain, then promoted after build and backend checks. Git branches were not pushed or merged in this deployment.

| App | Production URL | Deployment |
| --- | --- | --- |
| Runner | https://race-pace-site.vercel.app | dpl_57xNx7fQ3iAX3fZWC7T2EEmF7HGb |
| Admin | https://race-pace-admin.vercel.app | dpl_GcEQ8Vkk41VdrH3bLUyhNMk4Dsgb |

Vercel project production targets both report READY with releaseCommit=ed8273f. Both remote builds passed.

## Backend
- Applied all nine pending migrations to whaqarofxdlzxrelbcrq. Hosted migration count verified as 98. No reset or reseed.
- CLI emitted a migration-catalog cache warning after applying SQL. Independent hosted queries confirmed the new schema and migration count.
- Deployed all 13 functions, including kit-release. The first server-bundle attempt failed on bare imports; explicit --import-map supabase/functions/deno.json resolved it.
- Function inventory verified ACTIVE with the configured JWT settings.
- Row-level security verified enabled on kit_releases, refund_requests and refund_provider_events. kit_release_tx is executable by service_role and not anon.
- Unauthenticated kit-release and unsigned payments-webhook requests return401. fake-checkout returns404 because provider configuration disables it. These checks do not prove provider credentials are valid or live/test mode.
- payment-session preflight allows the canonical runner origin.
- Existing hosted schedules are active: event-reminders-daily, drain-push-1min and expire-stale-registrations. Job execution/delivery was not verified.

## Browser and HTTP checks
- Runner storefront renders hosted sample events. Sign-in UI renders.
- Live runner and admin forgot-password pages render Reset your password and Send reset link in the in-app Browser.
- HTTP checks pass for runner home, events, sign-in, sign-up, forgot-password and recovery; admin login, forgot-password and recovery.
- Unauthenticated admin /race-kits redirects to /login?next=%2Frace-kits.
- Vercel runtime error queries report no errors in the selected 15-minute window. This is an immediate smoke check, not extended monitoring.
- Preview protection interrupted some runner navigation. A generic HTTP200 during that attempt was a Vercel login page, not application proof. Canonical production pages were subsequently verified directly.

## Outstanding pilot blockers
- Hosted ticket-email provider credentials are absent. User has been asked to choose provider and sender. No email secrets were overwritten.
- Supabase dashboard requires sign-in. Hosted Auth SMTP and callback/recovery redirect configuration remain unverified pending that sign-in.
- Authenticated hosted registration/payment/refund/kit/payout journey was not rerun. No real payment, refund or transfer was attempted.
- Security advisors report 29 warnings and no errors: 2 mutable function search paths, pg_net in public, 5 anonymous and 20 authenticated SECURITY DEFINER exposures, and disabled leaked-password protection. Some function exposures support deliberate authorization-checked RPCs; warnings require individual triage and are not blanket proof of vulnerability.
- Vercel sensitive environment values remain unreadable through metadata APIs. Rendered hosted event data proves working storefront access, not every environment value.

Code is deployed. This is not approval to onboard paying pilot participants until email, Auth configuration and hosted end-to-end checks are complete.
