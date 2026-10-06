# Implementation Report — Option B release architecture

**Plan**: `docs/plans/2026-10-06-option-b-release.md`  
**Branch**: `codex/option-b-release`  
**Status**: COMPLETE — local implementation and review; hosted activation pending

## Summary

Implemented parallel CI and a disabled-by-default controller that releases one tested main revision
through staging and owner-approved production. Releases select affected apps, build separately for
each environment, check backend/deployment identity, and record completed and partial attempts.
All changes are isolated from the user's existing dirty checkout. No hosted mutation, commit, push,
pull request or deployment was performed.

## Tasks completed

- Parallel app/shared/backend checks and conservative scope: `.github/workflows/ci.yml`,
  `scripts/ci-scope.mjs`; preserved the required `web-admin-validate` aggregate.
- Trusted release orchestration and durable evidence: `.github/workflows/release.yml`,
  `scripts/release/control.mjs`; workflow remains gated by unset `OPTION_B_ENABLED`.
- Explicit backend migration/function deployment and readback: `scripts/release/backend.mjs`.
- Environment-specific Vercel builds, identity checks, promotion and app rollback:
  `scripts/release/vercel.mjs`.
- Public static build markers in both apps: `apps/{site,web}/app/api/release/route.ts`.
- Pinned Edge dependency graph: `supabase/functions/deno.json` and `deno.lock`.
- Architecture, implementation plan, activation/recovery runbook, repository instructions and
  documentation ledger updated.

## Validation results

- Runner app: 550 tests in 77 files passed; typecheck and production build passed.
- Admin app: 1,046 tests in 130 files passed; typecheck and production build passed.
- Shared UI: 13 tests and typecheck passed; Fieldnotes audit found no remaining imports or duplicates.
- Full backend CI: 974 tests in 114 files passed against an isolated temporary Supabase stack.
  Replayed 180 migrations and checked fake Edge/native proof services. Removed only this task's
  temporary services and volumes afterward. This run preceded the final helper regression additions.
- Focused release/scope checks: 98 tests in 4 files passed after review fixes. The final backend
  test typing guards were followed by another successful 34-test backend run.
- Both workflows passed actionlint 1.7.7 after review fixes.
- Deno 2.9.6 frozen dependency graph check passed.
- Admin production server returned HTTP 200 for `/api/release` with its built SHA and staging
  project even when runtime variables claimed another SHA and the production project.
- `git diff --check` passed.
- Extra shared-package typecheck remains blocked by the unchanged `discounts.ts:88` diagnostic:
  `BigInt(whole)` receives `string | undefined` under `noUncheckedIndexedAccess`. New helper/test
  diagnostics were fixed. This command is not an existing required CI gate.
- Final review: both blocking findings resolved (rejected/partial staging reconciliation and
  Vercel ID-only custom-environment responses). No remaining blocking implementation finding.

Required local CI gates: **PASS**. Extra shared-package typecheck: **FAIL — pre-existing error**.
Hosted activation/rehearsal: **NOT RUN**.

## Deviations from the plan

- One protected owner approval includes manual hosted business acceptance. A separate manual
  acceptance job would duplicate this gate. Automatic checks prove identity and basic health;
  authenticated business-flow acceptance remains explicit owner work on hosted staging.
- Revalidate the integrated main revision. Cross-run reuse of pull-request results is deferred
  until source/configuration equivalence can be proven; no checks were removed to claim speed.
- Disconnecting Vercel Git integration is the cutover requirement. This disables automatic PR
  previews too; a separate preview workflow is future work.
- Include rejected/partial attempts in reconciliation scope. Production-baseline-only diffs can
  otherwise leave rejected staging changes deployed after a later revert.
- App rollback is explicit and preserves evidence. It does not reverse database writes or rewrite
  the release ledger; recovery requires baseline reconciliation before normal releases resume.

## Issues encountered and remaining work

Read-only inspection found no release environment secrets/variables and no protected
`release-production` environment. Configure these, attest the bootstrap revision, reconcile branch
and service state, and perform the cutover described in `docs/operations/option-b-release.md`.
The existing staging-first policy remains active until that cutover.

No hosted rehearsal, real release timing measurement or production acceptance occurred. The
8–15 minute automated target remains an estimate. First rollout must verify custom Vercel staging,
Supabase server bundling, credentials, domain promotion and end-to-end acceptance.

The existing local Supabase project identity conflicted with stopped containers from another task.
Validation used a separate temporary project and left those containers untouched.

Final review report: `.claude/code-reviews/2026-10-06-option-b-release.md`.
