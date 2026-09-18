# Staging backend bootstrap

Status: in progress. Scope: new staging project pepbmqomiailnnvvwupz only.

## Objective and inherited decisions
Prepare isolated staging for web/admin deployment. Production whaqarofxdlzxrelbcrq is not a migration target in this unit. Preserve all original migration versions. Never include seed.sql or copy local users. Required reading: docs/deploy-vercel.md and docs/operations/2026-09-17-hosted-setup.md.

## Findings
120 existing migrations include PSGC reference data. Legacy 20260723090700 schedules drain-push-1min against an unrelated project. Fresh staging has no Vault credentials; do not create service_role_key. Supabase management config rejects cron.launch_active_jobs, so do not rely on that control. Use a staged replay: stop before the historical scheduler, then replay that scheduler together with an immediate unschedule under one transaction if a supported connection permits; otherwise stop for a safe replay strategy. No worker or payment endpoint should be exposed until secrets are configured.

## Tasks and validation
1. Create follow-up migration retiring only drain-push-1min, idempotent when absent. Validate using a disposable transaction against local Postgres, rolling back afterwards, or fresh staging replay before any data/secrets.
2. Prepare isolated CLI workdir linked only to staging, retain exact migration names. Validate linked project reference and db push --dry-run. Completed: 120 pending, staging empty.
3. Establish safe transactional replay for the historical external job. Validate zero active external push jobs and no legacy Vault credential. Do not alter old migrations or disable security protections.
4. Replay migrations without seeds. Validate exact migration version set, reference counts, RLS, grants, storage buckets, and cron definitions. No production mutations.
5. Configure SMTP, signed tickets, PayMongo test key/webhook, and origins before deploying reviewed Edge Functions. Exclude fake-checkout. Keep group flags off. Validate hosted smoke checks; do not run destructive local integration suites against hosted projects.
6. Deploy both staging apps against staging configuration after code validation. Validate real email and Google login, registration/payment/QR, and tenant isolation. CI/CD is a separate implementation unit before production release.

## Open items
No user product decision needed for this unit. Credentials and provider-imposed verification may require handoff. Google client and exact redirects are configured; public audience remains in testing. Backend migration replay is not complete.

## Execution amendment
2026-09-17: safe transactional replay completed using CLI db query --linked --file. Historical schedule and retirement were applied together, verified, then exact versions recorded through migration repair. Full staging replay and basic RLS/reference-data checks passed; provider secrets, grants audit, deployment and smoke tests remain.
