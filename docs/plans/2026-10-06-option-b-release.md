# Implement Option B release orchestration

## Goal and inherited decisions

As the release owner, I want one tested candidate to move through staging and approved production
so UI changes avoid redundant deployments and branch round trips. Inherit the approved design in
`docs/specs/2026-10-06-option-b-release.md`. The conversation settles architecture and safeguards;
no additional product choice is open. Configuration and real cutover must be verified separately.

Complexity: high. Main risks are approval bypass, stale baselines, partial promotion, environment
mixing, mutable artifacts, provider side effects and backend compatibility during rollout.

## Context

- `.github/workflows/ci.yml`: serial existing checks, fake Edge provider setup, native proof verifier.
- `vitest.config.ts`: backend file parallelism deliberately disabled.
- `test/env.ts`, `scripts/ci-assert-local.mjs`: local-only database assertions.
- `apps/{site,web}/next.config.ts`: Supabase public URL baked into build.
- `supabase/config.toml`: preserve function JWT settings, never push local Auth config to hosted.
- `docs/operations/release-workflow.md`: legacy cutover path remains until activation.
- GitHub currently has no release secrets/variables and no required environment reviewers.
- Existing required check is `web-admin-validate`; retain its name.
- Node 24, pnpm 9.7.0, Supabase CLI 2.109.1, verified Vercel CLI 59.3.0.

## Tasks

### 1. Parallel CI and conservative scope selection

**Ownership:** CI worker; independent of deployment helper implementation.
Update `.github/workflows/ci.yml`; add a small scope script and Vitest regression tests.
Preserve every existing check. Keep no hosted secrets in PR jobs. PR/main/staging triggers replace
duplicated feature-push plus PR work. Feature-to-main gate switches only when Option B is enabled.
Use per-app Next cache. Run shared UI audit in its own job and backend services only in backend job.

**Validate:** scoped Vitest tests; actionlint; focused app types/builds and existing suites.
**Satisfies:** spec 1, 2, 9.

### 2. Candidate planning and evidence

Add release scripts under `scripts/release/` and tests in `packages/shared/` (existing Vitest glob).
Use Node standard library and existing dependencies. Fail closed on malformed SHA, invalid ancestry,
missing baseline, mismatched CI revision or missing approval protection. Persist successful release
records through GitHub deployment payloads; retain workflow artifacts for diagnostics.
Use exact candidate checkout and compare cumulative changes since last successful production.
Reconcile staged and partially deployed attempts so reverted changes cannot remain hosted.

**Validate:** `pnpm exec vitest run packages/shared/src/release*.test.ts`.
**Satisfies:** spec 2–4, 9.

### 3. Environment deployment helpers

**Backend ownership:** separate worker; depends on the contract below, independent of Vercel helper.
Create explicit helpers to deploy/check backend and Vercel apps. Backend API accepts pinned base/head
and staging/production identity, returns migration/function evidence, and never resets/seeds hosted.
No implicit CLI deploy-all. Shared function changes select every function. Check JWT/readback.
Vercel helper verifies environment settings, builds per environment, checks exact IDs and records
previous IDs. Promote production only after checks; provide explicit app rollback from evidence.

**Validate:** deterministic Vitest adapter tests; CLI help against pinned versions; no hosted writes.
**Satisfies:** spec 3, 5, 7, 8.

### 4. Trusted release workflow and hosted checks

Add `.github/workflows/release.yml`. Trigger only trusted successful main-push CI or a manual rerun
of such a run. Use a global non-cancelling concurrency group across the entire workflow. Separate
staging and protected production jobs. The production approval includes hosted business acceptance. Artifacts are tied to the same workflow
run, SHA and attempt. Protected jobs check settings and candidate evidence before mutation.
Add safe HTTP smoke checks for exact deployment URLs and public alias readback. Do not claim full
business acceptance. The acceptance reviewer records the affected flow evidence in the approval.

**Validate:** workflow parse/actionlint and regression tests of failed checks, held approval, stale
source, cumulative diff, partial rollout and wrong environment. Hosted rehearsal requires configured
secrets and deployed workflow; report that dependency rather than run arbitrary production code.
**Satisfies:** spec 4, 6–9.

### 5. Documentation, validation and review

Update release runbook, repository instructions, deployment guide and docs ledger with activation
conditions, settings inventory, baseline bootstrap, failure recovery and precise limits.
Use PIV validation and review skills. Record results and remaining hosted setup in the report.

**Validate:** `git diff --check`; all release tests; actionlint; repository checks appropriate to CI
restructuring. Review the complete diff for approval bypass and deployment identity mistakes.
**Satisfies:** all acceptance criteria and cutover procedure.

## Completion criteria

- [x] CI preserves existing checks in parallel with a stable aggregate status.
- [x] Admin-only changes select admin deployment only; shared/unknown changes fail conservatively.
- [x] Release refuses wrong SHA/environment/baseline/approval state.
- [x] Production cannot run before staged evidence and approval.
- [x] Deployments and recovery record exact IDs; backend rollback is not implied.
- [x] Required tests, workflow validation and self-review pass; the extra shared-package typecheck
  retains its documented pre-existing `discounts.ts:88` diagnostic.
- [x] Hosted activation state and any unverified rehearsal are clearly documented.

Hosted cutover, credentials setup, staging rehearsal and production activation remain unperformed.
These are activation steps, not evidence supplied by local validation.

## Amendments

- Use one owner approval after automatic staging checks. The approval records business-flow
  acceptance and unlocks production; a separate manual acceptance job would duplicate this gate.
- Include incomplete and rejected deployment attempts in reconciliation scope. Comparing only
  the successful production baseline can miss changes that still exist on staging.

## Staging rehearsal follow-up: CLI telemetry

The pinned Supabase CLI 2.109.1 can return a nonzero exit after successful deployment when
PostHog shutdown times out. Live staging readback proved this for `platform-users` and
`reservation-checkout`. Set `SUPABASE_TELEMETRY_DISABLED=1` in the release workflow using
the CLI's documented source configuration. Keep genuine deployment errors fail-closed.

Validation: rerun a read-only hosted command with telemetry disabled, the release/scope
regression suites, actionlint, and `git diff --check`. Reuse the same-session passing full
application/backend validation because this follow-up changes only workflow environment
and operational evidence. Record staging function versions and remaining acceptance gates.
