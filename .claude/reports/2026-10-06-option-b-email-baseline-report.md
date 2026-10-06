# Implementation report — recover the deployed email worker

Plan: `docs/plans/2026-10-06-option-b-email-baseline.md`
Branch: `codex/option-b-email-baseline`
Status: implemented and locally validated; publication and hosted release pending.

Recovered the missing `send-lifecycle-email` entrypoint and `lifecycleEmail.ts` renderer from
the identical staging v9 and production v8 source bundles. Both files match the deployed bytes.
Restored the existing hosted `verify_jwt = false` configuration. The worker still requires its
dedicated bearer secret before privileged access. No hosted function, schedule or provider changed.

## Validation

- Sixteen new worker/renderer tests passed, covering authorization, unsafe configuration, stale
  reminders, confirmed recipients, provider failure, idempotency, lost leases and escaped HTML.
- Deno 2.9.6 frozen dependency graph passed for all function entrypoints.
- Complete local backend run: 1,005 passed, six failed in the existing proof API suite because
  the temporary Docker configuration used a Linux gateway to reach the host on macOS.
- Corrected only the temporary environment to use `host.docker.internal`; all seven proof API
  tests then passed. Final combined coverage: 1,011 tests in 116 files. No product fix was needed.
- All 180 migrations replayed in the isolated `option-b-email-ci` project. Local safety checks passed.
- `git diff --check` passed. Same-session app types/builds/tests remain applicable: no app source,
  workspace dependency, CI workflow or package changed here.

## Review and boundaries

Current shared helpers remain unchanged. Their interfaces support this worker; the renderer uses
the unchanged default branding, and email transport retains the idempotency header.
No new migration or hosted secret is introduced. The recovered source keeps the deployed behavior,
including the existing limitation that a registration lookup error is treated as a skipped job.
Improving that behavior requires a separate reviewed change and is outside baseline recovery.

## Activation progress

PR #223 is merged into staging at `67911fdc776108cb667caf70b90e92c39953c096`; exact staging CI passed.
The Vercel tokens and all three scoped Supabase tokens are saved in their intended GitHub environments.
Secret-name presence is verified; credential permissions have not yet been exercised by a release run.
Both database passwords passed TLS-verified read-only `SELECT 1` checks and were saved by the owner
as environment-scoped `SUPABASE_DB_PASSWORD` secrets. Supabase's official CA was supplied explicitly;
certificate and hostname verification remained enabled. All required secret names are now present.
`OPTION_B_ENABLED` and `RELEASE_BOOTSTRAP_SHA` remain unset. Production release and hosted acceptance
are not approved or complete. No Vercel Git link was disconnected.
