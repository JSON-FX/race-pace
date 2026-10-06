# Code review — Option B release architecture

**Status:** local implementation reviewed; hosted activation and rehearsal remain pending.
No commit, push, hosted mutation, or production deployment is claimed by this review.

## Review result

Code review passed after resolving the two integration findings below. No open technical
findings remain in the reviewed implementation. This result covers the local code and its
validation; it does not establish that GitHub environments or hosted credentials are configured.

## Stats

Snapshot immediately before writing this report, including all untracked implementation files:

- Files modified: 9
- Files added: 21
- Files deleted: 0
- New lines: 3,091, including untracked files
- Deleted lines: 43

This report itself is excluded from those counts. `git diff --stat` alone omits the new workflow,
helpers, tests, endpoint files, dependency lockfile, and new documentation.

## Resolved findings

### 1. Reverted changes could remain deployed on staging

severity: high  
status: resolved  
file: scripts/release/control.mjs  
line: 199  
issue: A production-only diff omitted repairs to rejected or partially deployed candidates.

An isolated three-commit Git reproduction confirmed the issue. Production A contained the original
runner. Candidate B changed the runner and a function, then reached staging. Candidate C reverted
those changes and changed only the admin. The A-to-C diff selected only the admin, although staging
still needed its runner and function restored. A failed repair attempt could conceal the older
attempt if the controller considered only the latest ledger entry.

The controller now collects every distinct attempted source through the last successful complete
record in each environment. It unions those differences with the production baseline. Missing
trusted staging history forces both apps. The plan preserves reconciliation references, and the
guard rejects changed history while excluding only records from its own run and attempt.

The workflow passes each environment's references to the backend helper. That helper reconciles
reverted function and shared-module changes without treating a revert as permission to delete
hosted migrations or retire functions. Regression tests use actual temporary Git histories for
rejected changes, failed repair retries, shared function changes, and unsafe removals.

### 2. Valid Vercel staging responses could fail identity verification

severity: high  
status: resolved  
file: scripts/release/vercel.mjs  
line: 85  
issue: Deployment verification required a custom-environment slug that Vercel may omit.

Vercel's published SDK models a deployment custom environment as either a full object or an object
containing only its ID. A local fixture using the documented ID-only response reproduced the
incorrect rejection. The implementation now resolves the staging ID through each owning project's
custom-environment endpoint. It verifies and records that ID for changed and unchanged apps.

Tests cover ID-only responses, mismatched IDs, missing or ambiguous staging environments,
conflicting slugs, recreated environments, and production/custom-environment confusion.

Primary schema reference:
[Vercel deployment response model](https://github.com/vercel/sdk/blob/main/src/models/getdeploymentgitsourcedeploymentsresponse200applicationjsonresponsebody219type.ts).

## Integration checks

- Trusted release entry accepts only a successful completed main-push CI run in the owning
  repository and expected workflow. The checked-out source matches that run. Controller drift
  between the candidate and the workflow definition prevents release.
- Production secrets and mutations remain behind the owner-approved GitHub environment. The
  guard checks reviewer restrictions and administrator bypass configuration again before writes.
- The release lock spans staging, acceptance, and production. Evidence is bound to the workflow
  run, attempt, source, tree, and dependency lock. Completed records require both app identities
  and complete backend inventory.
- Production app candidates use separate production configuration and do not assign domains
  before verification. Partial promotion persists evidence. Rollback checks alias ownership and
  refuses to overwrite an unrelated newer deployment.
- Unchanged apps retain their actual deployment IDs. Hosted UI-only releases still collect
  read-only backend inventory. Staging inventory is checked again after the approval wait.
- Migration replay and financial tests remain serialized within their isolated backend runner.
  Native proof verification remains an integration dependency, not a mocked replacement.
- Documentation keeps the existing staging-first policy active until explicit cutover. It
  distinguishes HTTP identity checks from manual business acceptance and avoids claiming measured
  deployment improvements or automatic database rollback.

## Validation evidence

- Final focused release/scope run: **98 tests in 4 files passed**: 29 scope, 14 controller,
  34 backend adapter, and 21 Vercel adapter tests.
- Both workflows passed actionlint 1.7.7. `git diff --check` passed.
- Earlier full isolated backend run: **974 tests in 114 files passed**, including native proof
  verification and a fresh replay of 180 migrations. This preceded the final helper regressions;
  the affected helper tests were rerun afterward.
- Runner and admin types, tests, and builds passed in the parent validation. Shared UI validation
  and the frozen Deno dependency graph also passed.
- A local production-mode HTTP check returned the static build SHA and staging project even when
  runtime variables supplied different values. This supports the build-identity endpoint contract.
- An additional shared-package typecheck still reports the pre-existing
  `packages/shared/src/discounts.ts:88` diagnostic: `BigInt(whole)` receives `string | undefined`.
  This is outside the changed files and the existing required CI gate. No introduced diagnostics
  remained after fixing the helper test declarations.

## Remaining operational limits

Hosted credentials, protected environments, the bootstrap attestation, disconnected Vercel Git
routing, and the first staging rehearsal remain prerequisites. The first real rollout must verify
provider behavior, server bundling, custom staging domains, and affected business flows. Local
adapter tests and schema checks do not substitute for that rehearsal. Deployment timing remains
an unmeasured target until comparable hosted runs are recorded.
