# Local web/admin QA setup

Status: executing. Scope: local Supabase and web/admin only.

## Approach

Preserve existing local data and environment files before starting services. Compare hosted and local migration history and schema definitions. Apply only missing local changes if necessary; do not push anything to hosted. Use the existing Docker apps and local Supabase ports. Use Mailtrap Sandbox once the user signs in; keep local email capture available meanwhile.

## Tasks

- [x] Inspect existing containers, config, and local data volume.
- [x] Back up stopped PostgreSQL volume and environment files outside the repository.
- [x] Start local database without network access; pause old cron jobs before reconnecting.
- [x] Compare 86 migration versions across repository, local, and hosted.
- [ ] Compare schema definitions, policies, grants, and storage configuration.
- [x] Set local auth redirects and email confirmation behavior.
- [x] Start full local backend and serve Edge Functions with local-only settings.
- [x] Point site/admin environment files to local API and local keys, then recreate app containers.
- [x] Verify local browser access and API targets.
- [x] Configure Mailtrap after account access is available; verify captured confirmation email.
- [x] Run local backend integration tests and record failures (402 passed after fixing the dated fixture).
- [ ] Execute accounts, organizations, events, runner registration, payments, reports, and operation checks from the E2E checklist.

## Validation and boundaries

Use `supabase status`, read-only catalog fingerprints, `pnpm test`, per-app type checks/tests, and Computer browser workflows. Local fake payments verify application transitions; they do not prove PayMongo integration. Keep hosted seeded data independent from local fixtures; schema synchronization does not require copying hosted identities or session tokens.

Backups: `/Users/jsonse/.codex/backups/race-pace/2026-09-15-local-restore/`.
Existing branch: `feature/admin-ui-changes`. Existing user changes are preserved.
Reference: `docs/plans/2026-09-15-web-admin-readiness.md`.

## Open dependency

Mailtrap login completed; local signup confirmation was captured and confirmed. No database reset is required by default: local migration history already matches hosted exactly. Recheck schema before claiming synchronization.

## Verified results

- Local signup `runner-local-20260915@example.com` created user `f41c96dc-90a5-48de-88b5-68feb1f0b3cd`; Mailtrap message `5702321885` captured confirmation. Clicking its link set email_confirmed_at in local Auth.
- Local homepage renders after clearing 20 backed-up stale hosted sample image links. Local storage has no objects; bucket settings match hosted.
- All 402 backend tests pass. Both site/admin typechecks pass. Historical rate test now owns explicitly dated fixtures rather than relying on seed date.
- Effective permissions DO NOT match hosted: table, column, and function permission fingerprints differ. No hosted grants were changed and no broader hosted grants were copied locally. This remains an investigation item before claiming full parity.
- Both apps use local public API and internal Docker API URL. Edge Functions run with local URLs and fake payments.
- Mailtrap credentials live only in ignored `.env`. Fresh checkouts must set MAILTRAP_SMTP_USER and MAILTRAP_SMTP_PASSWORD before starting this configured local stack.
- Local cron jobs remain paused, including an old push job targeting a different hosted project. Reconfigure deliberately before enabling local job tests.
- Ticket delivery remains a separate Resend path and is not covered by SMTP confirmation success.

Hosted permission example: `decrement_slot(uuid)` is executable by anon/authenticated on hosted but neither locally. The function is SECURITY INVOKER, so this alone does not prove unauthorized writes; table grants and RLS must be considered together. Money-confirmation and refund RPCs reject both roles on hosted. No grants changed.

Browser/server session cookie mismatch fixed in both apps. Confirmed runner can access protected My Races. Final suites: 1,463 tests passed; both app typechecks passed.

Permission stage complete: CLI access restored; three reviewed migrations applied to local and hosted. All 89 migrations match. Client grants now match exactly; service-role differences preserved. Local backend suite 403/403. See docs/issues/2026-09-15-permission-parity.md. Browser admin testing resumed.
