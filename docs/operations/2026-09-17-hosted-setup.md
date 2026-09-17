# Hosted setup checkpoint — 2026-09-17

Historical activity log. Use [Launch progress](launch-progress.md) for consolidated current status. Later entries supersede earlier checkpoint statements.

Status: in progress. Neither staging nor the custom production domain is ready for testing.

## Verified inventory

- Domain: `racepace.com.ph`, GoDaddy DNS (`ns43.domaincontrol.com`, `ns44.domaincontrol.com`).
- Vercel team: `jayson-alananos-projects`, Pro; repository `JSON-FX/race-pace`.
- Runner project: `race-pace-site`, root `apps/site`.
- Admin project: `race-pace-web`, root `apps/web`.
- Existing Supabase: `whaqarofxdlzxrelbcrq`, healthy, Tokyo, under Race Pace Org Pro.
- Staging project: `race-pace-staging`, reference `pepbmqomiailnnvvwupz`, healthy, Micro, Singapore (`ap-southeast-1`). User created it after the additional $10/month disclosure. Password is user-managed. No migrations or functions deployed yet.
- Resend team: `support.racepace`; domain `notify.racepace.com.ph` created in Tokyo. Verification pending.

## Changes and pending verification

Vercel runner domains added: `www.racepace.com.ph` targets Production; `racepace.com.ph` redirects to www with 308. Vercel confirms Valid Configuration for both production runner hostnames. Future runner URLs, Auth redirects, payment returns, and email links must consistently use the canonical www hostname.

Exact Vercel records shown by the dashboard:

| Type | Host | Target |
| --- | --- | --- |
| A | @ | 216.150.1.1 |
| CNAME | www | deb036027b1b1614.vercel-dns-017.com. |

Admin domain `admin.racepace.com.ph` is saved and Vercel confirms Valid Configuration. Its CNAME is `8b76d4d83f0d536c.vercel-dns-017.com.`.

Both Vercel projects now have an included custom `staging` environment with branch tracking off. Runner `staging.racepace.com.ph` and admin `staging-admin.racepace.com.ph` have correct DNS according to Vercel, but no staging deployment exists. Staging-only Supabase URL and public key variables are saved in both projects. Runner also has `NEXT_PUBLIC_SITE_URL=https://staging.racepace.com.ph`. Production variables were not imported.

GoDaddy saved the apex A record and all three admin/staging CNAMEs after user verification. Existing www CNAME still points to the apex; Vercel accepts it as valid, so no further DNS edit is needed now.

Three Resend DNS records were saved and read back in GoDaddy after user verification. Resend still reports Pending; sending is not yet verified. Records: TXT `resend._domainkey.notify` (public DKIM value from Resend), CNAME `rsend.notify` to `rsend-apne1.forge.rmta.net`, CNAME `send.notify` to `send.forge.rmta.net`. Preserve existing domain records, especially DMARC and any future mailbox records. Receiving is disabled.

Resend MCP registered globally at `https://mcp.resend.com/mcp`. User approved Full access for setup. OAuth failed because the authorization response omitted the required issuer `https://api.resend.com`. Do not weaken issuer validation. MCP is NOT authenticated; the dashboard/API remain usable. An OAuth grant may exist in Resend even though Codex rejected the callback.

## Remaining execution order

1. Staging creation and DNS saves are confirmed. Verify TLS when applications are deployed.
2. Verify Resend DNS publicly and in its dashboard. Configure separate sending keys for staging and production.
3. Finish the PIV implementation plan for isolated staging deployment and CI/CD before code changes.
4. Staging custom environments, domains, and public variables are configured. Deploy each app explicitly to its staging target after backend setup and checks.
5. Audit migration ordering and grants against a fresh staging database. Apply reviewed migrations without copying local QA users or production records. Import required reference data separately.
6. Configure Auth SMTP, exact redirects, application origins, sender addresses and function secrets per environment. Resend SMTP: `smtp.resend.com:465`, username `resend`, password is the environment's sending API key.
7. Deploy compatible Edge Functions. Configure PayMongo TEST keys and signed webhook for staging. Real-money production activation remains gated by tests.
8. Inspect application email-event handling before creating Resend webhooks; never point a webhook at an unimplemented receiver. Implement signature verification and replay handling if adding delivery/bounce tracking.
9. Add CI checks and staging/production release workflows. GitHub Actions do not yet exist. Avoid simultaneous native Git and Actions deploys that bypass checks. Production builds must use production variables, not staging artifacts containing baked-in public URLs.
10. Set schedules only for implemented and validated workers. Keep unfinished group features disabled.
11. Verify DNS/TLS, both app origins, confirmation/recovery/invitation links, real Resend delivery, and signed sandbox callbacks before resuming the full fifteen-area checklist.

No application deployment, hosted migration, new API key, webhook, or CI workflow was completed in this checkpoint. Existing uncommitted feature work is preserved.

## References

- https://supabase.com/docs/guides/platform/regions
- https://resend.com/docs/send-with-supabase-smtp
- https://github.com/resend/resend-mcp
- `docs/deploy-vercel.md`
- `docs/operations/production-services-checklist.md`

## Google sign-in staging and production prerequisite

Added at the user's request on 2026-09-17. Complete before hosted end-to-end testing.

The current web and admin code uses Supabase `signInWithOAuth({ provider: 'google' })` (`apps/site/lib/auth.ts`, `apps/web/app/(auth)/login/google-button.tsx`). Local Firebase third-party Auth integration is disabled in `supabase/config.toml`. Inspect the existing Google Cloud/Firebase project and OAuth client before changing provider configuration; the user's Firebase project may own the Google credentials even though Supabase handles the application session.

- [ ] Identify the existing Firebase/Google Cloud project and intended OAuth clients.
- [ ] Configure separate staging and production Google OAuth credentials where practical; keep secrets server-side.
- [ ] Register exact Supabase provider callbacks: staging `https://pepbmqomiailnnvvwupz.supabase.co/auth/v1/callback`, production `https://whaqarofxdlzxrelbcrq.supabase.co/auth/v1/callback`.
- [ ] Verify Google consent screen branding, authorized domains, publishing/test-user status, and requested scopes.
- [ ] Configure the Google provider in each Supabase project and exact runner/admin application redirect URLs.
- [ ] If Firebase Auth is actually in use outside the inspected web/admin paths, verify its authorized domains and environment separation too.
- [ ] Test Google signup, returning login, logout, error handling, account linking, and admin authorization on both environments. Confirm staging accounts cannot authenticate against production.

### Staging bootstrap audit

CLI authentication and isolated staging link succeeded; dry-run lists 120 pending migrations. No hosted migration applied. Preserve original timestamps and never include seed data. PSGC reference data already exists in migrations. Resolve the obsolete `drain-push-1min` job targeting an unrelated project before replay; never populate its legacy Vault credential. Configure `TICKET_SIGNING_SECRET` and PayMongo test credentials before exposing checkout, and exclude `fake-checkout` from hosted deployment. Keep group flags disabled.

### Authentication URL progress

Verified saved in Supabase on 2026-09-17: staging Site URL is `https://staging.racepace.com.ph` with six exact runner/admin callbacks, recovery and invitation routes. Production Site URL is now `https://www.racepace.com.ph`; six corresponding custom-domain redirects were added and verified (12 total, legacy entries retained during transition). Login behavior still requires browser testing.

Firebase console for `support.racepace@gmail.com` requires enabling Google two-step verification before access. User handoff requested. Google project/client configuration remains pending; no OAuth client or secret changed.

### Google provider discovery

User enabled two-step verification; Firebase and Google Cloud access now work. Firebase shows no projects. Google Cloud project `race-pace-504614` (Race Pace) owns existing `racepace-web-client`, created August 5, 2026. Its sole authorized redirect is the production Supabase callback. No JavaScript origins are configured, consistent with the Supabase server redirect flow. Existing production client was not modified.

Prepared, but not submitted, a separate Web application client `racepace-staging-web-client`, restricted to `https://pepbmqomiailnnvvwupz.supabase.co/auth/v1/callback`. Requested browser-required confirmation for credential creation and storage in staging Supabase Google provider settings. No new secret generated yet. Branding, audience, provider enablement and end-to-end login tests remain pending.

### Staging Google client connected

Created `racepace-staging-web-client` after user approval under Google Cloud project `race-pace-504614`. Client ID: `280809801221-i8ei80uqc2svm5uaad2v3qo1pp17ggn4.apps.googleusercontent.com`. Sole callback is the staging Supabase callback. Secret transferred directly to staging Supabase Google provider, never written to repository or printed. Saved provider verified as Google Enabled. Nonce checks retained; users without email remain disallowed. Google creation dialog reports OAuth access restricted to consent-screen test users; audience review and end-to-end login remain pending. Production client unchanged.

### Staging schema applied and verified

Applied all 121 repository migrations to staging only. First replayed 23 migrations, then executed the original legacy push-schedule SQL and its retirement migration in one transaction. Verified the job absent before recording those two exact versions with CLI migration repair. Replayed remaining migrations with --include-all; final dry-run reports remote database up to date. No original migration edited. No seeds or user data copied. Production database unchanged.

Read-back: 121 migrations, zero auth users, zero organizations, 42,046 barangays, zero public tables lacking RLS, zero obsolete push jobs. Existing database jobs event-reminders-daily and expire-stale-registrations are active. Grants and end-to-end behavior still need validation. CLI returned success but emitted a nonfatal pg-delta catalog-cache certificate-path warning; direct database read-back confirmed application.

Google test-user addition for support.racepace@gmail.com was submitted, but reloaded audience still shows zero test users. Treat as unresolved. Public publishing is disabled until Google branding configuration is completed.

## Production data cutover policy — user confirmed

Existing test data may remain temporarily during final testing. Before real launch, identify and remove confirmed test business records, test accounts and test uploads while preserving reference data, configuration and legitimate administrator access. Prepare a scoped cleanup for review; do not use a blanket reset. After final testing, production is real-data-only: never run sample/demo/QA seeds there. Use staging or local for synthetic data and treat all subsequent production records as real.

Read-only production inventory on 2026-09-17: 5 Auth users, 1 organization, 2 events, 1 registration, 1 payment, 0 payout statements, 48 storage objects. These counts do not classify individual records as disposable. No data was deleted. Production is not empty; cleanup is a pre-launch prerequisite. User requested this policy be saved in persistent memory, and an ad-hoc memory note was created.

### Resend verification complete
Resend dashboard now reports notify.racepace.com.ph Verified. Prepared staging sending-only key limited to that domain; awaiting credential creation approval for staging and production, including storage in corresponding Supabase projects. No new key created yet.

### Email transports configured
Created approved race-pace-staging and race-pace-production Resend keys with Sending access limited to notify.racepace.com.ph. Each saved in its corresponding Supabase Auth SMTP and backend RESEND_API_KEY. EMAIL_PROVIDER=resend and EMAIL_FROM saved for both. SMTP host smtp.resend.com, port 465, username resend; staging sender staging@notify.racepace.com.ph (Race Pace Staging), production no-reply@notify.racepace.com.ph (Race Pace). Reload confirmed custom SMTP enabled in both projects, host/port/sender names persisted. Backend secret names verified after save. Delivery, sender acceptance, Auth templates and link behavior remain untested.
