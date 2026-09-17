# Deploying Race Pace: web and admin

Two Vercel projects share hosted Supabase project whaqarofxdlzxrelbcrq.
This guide covers release preparation; it is not evidence that a deployment is current.

## Verified project layout (2026-09-16)

| Surface | Vercel project | Root Directory | Public production URL |
| --- | --- | --- | --- |
| Admin | race-pace-web | apps/web | https://race-pace-admin.vercel.app |
| Runner | race-pace-site | apps/site | https://race-pace-site.vercel.app |

Both use Next.js and Node 24.x. The repository declares pnpm 9.7.0.
Keep workspace files outside the root directory available to the build: both apps import packages/shared.

Both production projects were deployed and promoted from commit ed8273f on 2026-09-16.
Admin: dpl_GcEQ8Vkk41VdrH3bLUyhNMk4Dsgb. Runner: dpl_57xNx7fQ3iAX3fZWC7T2EEmF7HGb.
See docs/reports/2026-09-16-hosted-deployment.md for verification and remaining pilot blockers.
Recheck these facts before the next release.

## Vercel environment

Both projects require NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY for Production and Preview.
Use the hosted project's URL and anon/publishable key. Do not copy a local Docker key from .env.local.
The runner also requires NEXT_PUBLIC_SITE_URL=https://race-pace-site.vercel.app.

Never set SUPABASE_INTERNAL_URL on Vercel. It is only a local Docker override.
NEXT_PUBLIC_SUPABASE_URL is used by next.config.ts at build time for image hosts.
Changing a public variable requires a new build, not just an environment edit.

The 2026-09-16 inventory confirmed required variable names and no SUPABASE_INTERNAL_URL.
Values are marked Sensitive and were masked when retrieved. Their correctness remains unverified.
Never print credential values in review artifacts.

## Supabase Auth

Set Site URL to the public runner URL. Explicit production redirect destinations include:

- https://race-pace-site.vercel.app/auth/callback
- https://race-pace-site.vercel.app/auth/recovery
- https://race-pace-admin.vercel.app/auth/callback
- https://race-pace-admin.vercel.app/auth/recovery
- https://race-pace-admin.vercel.app/auth/confirm
- https://race-pace-admin.vercel.app/auth/confirm/finish

Add the corresponding exact URLs for approved preview origins. Avoid allowing every unrelated vercel.app tenant.
Local .lan URLs belong to local testing; supabase/config.toml does not update hosted Auth settings automatically.

Verify Google provider configuration rather than assuming it is enabled.
Its provider callback is https://whaqarofxdlzxrelbcrq.supabase.co/auth/v1/callback.

Hosted Auth needs a working SMTP provider and verified sender for confirmation, recovery and staff invitations.
Local Mailpit proves local delivery only. Ticket email uses a separate Edge Function transport.

## Edge Function configuration

Review the hosted values for:

| Setting | Purpose |
| --- | --- |
| SITE_ORIGINS | Exact runner/admin and approved preview origins for browser calls |
| PUBLIC_SITE_URL | Public runner URL used by ticket links |
| ADMIN_APP_URL | Admin URL used by organization and staff invitations |
| PUBLIC_FUNCTIONS_URL | Hosted project functions URL used by ticket resources |
| TICKET_EMAIL_SECRET | Internal authorization between confirmation and ticket delivery |
| PAYMONGO_SECRET_KEY | Deliberately selected test/live provider mode |
| PAYMONGO_WEBHOOK_SECRET | Signing secret matching the configured provider webhook |
| EMAIL_PROVIDER | Hosted ticket-email transport; local Mailpit is not hosted delivery |
| RESEND_API_KEY / EMAIL_FROM | Required by the default Resend ticket transport |

Keep API and signing secrets out of both Next public environments and version control.
Match webhook events to the implemented paid/refund handlers. Preserve the per-function JWT settings in supabase/config.toml.
A local fake-provider test is not evidence of hosted provider callbacks, email delivery or a bank transfer.

## Database and functions

Do not assume the hosted database is current. Local had 98 applied migrations on 2026-09-16.
After maintenance ended, all nine pending migrations were applied. Hosted now also has 98 versions.
All 13 Edge Functions were redeployed, including kit-release. No hosted reset or reseed was performed.

After service recovery, compare hosted migration history with the repository and local history.
Review every unapplied migration; never edit an already-applied migration to force parity.
Do not reset or reseed the hosted database as a release step.

Deploy the required migrations and changed Edge Functions in a reviewed, compatible order before relying on their new behavior.
Changes to shared Edge modules require redeploying their consuming functions.
For this repository, pass --import-map supabase/functions/deno.json when deploying with --use-api.
The server bundler did not resolve bare imports without that explicit argument.
The prior guide's claim of eight migrations and six functions was obsolete.

## Release sequence

1. Finish the remaining local readiness checklist and review the complete intended diff.
2. Commit/publish the reviewed release revision through the agreed delivery workflow.
3. Verify hosted schema, Auth, SMTP, function secrets, webhook setup and operational schedules.
4. Apply reviewed backend changes and build both Vercel apps for the intended environment.
5. Test the exact preview revision end to end before production promotion.
6. Verify production aliases point to the approved builds and repeat the critical smoke checks.

No CI pipeline currently substitutes for local typechecks, tests and isolated builds.
Do not run a host Next build into the Docker dev stack's live bind-mounted .next directory.

## Smoke checks

- Runner discovery, images, signup confirmation, sign-in and password recovery.
- Organizer creation/invitation, tenant isolation and scoped staff access.
- Registration fields, capacity and duplicate handling.
- Provider test checkout, signed callback, ticket and email delivery.
- Refund/retry behavior, commission terms and report/CSV reconciliation.
- Kit release, check-in and operational exports.
- Completed-event payout recording, recovery direction and one-time accounting.

Use clearly marked sample records. Record any provider or bank steps that were simulated.
A READY Vercel build or an HTTP200 login page alone is not production readiness.

### Group ticket delivery worker (disabled until group rollout)

Deploy `group-ticket-delivery` as a Supabase Edge Function. Its gateway JWT check is disabled intentionally; the handler requires the existing `TICKET_EMAIL_SECRET` bearer secret and `GROUP_TICKET_DELIVERY_ENABLED=true`. Configure `PUBLIC_SITE_URL`, `PUBLIC_FUNCTIONS_URL` and the existing email transport. Never expose the bearer secret to either Next app's public environment.

After rollout approval, invoke it server-to-server with POST from the deployment's scheduler. Each invocation claims at most one pending order; choose cadence/concurrency for expected volume and monitor returned failures. No scheduler is activated by this migration. Local validation used mocked email only; verify with Mailpit and the selected production transport before activation.

Delivery retries use a five-minute lease and exponential backoff capped at one hour. A worker that loses its lease cannot mark a newer attempt complete. SMTP is at-least-once: a crash after acceptance but before completion may cause duplicate email. Tickets and payment confirmation are not recreated. All-refunded bookings close without sending; partially refunded bookings contain only currently paid tickets. A later refund can invalidate a QR already emailed, so staff must always verify current ticket state.
