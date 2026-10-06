# Option B release operations

Status: implementation prepared; hosted cutover and rehearsal not yet performed.

## Operating model

After activation, use isolated short-lived branches from `origin/main`, with pull requests into
`main`. Main is source integration, not an instruction to make changes public immediately.
CI validates the actual integrated revision. A trusted successful main-push run starts the
release workflow; pull-request CI and fork events cannot authorize deployment.

The workflow holds one global release lock across staging, owner review and production.
GitHub retains only the latest pending run when several changes arrive. The active run is
never cancelled by a newer commit. A later release compares against the last successful
production record, so skipped intermediate commits remain in scope. It also compares every hosted
attempt since each environment’s last successful completion. This repairs rejected or partial
changes even when the next candidate reverts them. Missing staging history selects both apps.

1. Plan cumulative changes and verify the production approval environment.
2. Check that both Vercel projects have Git auto-deployment disconnected.
3. Apply required staging backend changes, then build/deploy only affected applications.
4. Verify exact deployment URLs, both aliases, build identity and hosted backend inventory.
5. Owner reviews hosted staging and approves the protected production job once.
6. Recheck live staging after the approval wait before any production mutation.
7. Apply compatible production backend changes. Build new production-configured app candidates
   with `--prod --skip-domain`; verify all candidates before switching either app.
8. Promote sequentially, verify aliases, and persist the completed release record.

An admin-only UI edit selects only `web` when both environments are reconciled. Both app identities are recorded, including the
unchanged runner. Shared packages, dependencies and unknown build inputs select both apps.
Backend changes conservatively select both apps. UI-only releases perform read-only backend
inventory checks, but do not apply migrations or redeploy functions unless a prior hosted attempt
requires reconciliation. Previously applied migrations still require a forward fix; removing them
from a candidate fails closed.

## One-time cutover

Complete these steps in order. Do not activate the flag before its prerequisites exist.

1. Deliver the implementation through the existing feature-to-staging, staging-to-main process.
   Validate the exact implementation revision and record current hosted state. Reconcile branches
   before changing their roles. Do not delete `staging` or remove the required CI check.
2. Create `release-staging` and `release-production` GitHub environments. Limit each to an exact
   `main` **branch** policy, not a tag or wildcard. Production must require reviewer `JSON-FX`
   and disable administrator bypass. Self-review may remain allowed so the owner can approve
   their own releases; approval is still a separate explicit action.
3. Install the environment-scoped credentials listed below. Never place production credentials
   in repository-wide secrets or the staging environment.
4. Record the exact current production source as repository variable `RELEASE_BOOTSTRAP_SHA`.
   Inspect both live app deployment IDs, source revisions, migrations, function bundles and
   provider configuration first. Reconcile partial deployments before choosing this baseline.
   This value is an operator attestation, not an automatically proven historical source identity.
5. Disconnect the Git repository from **both** existing Vercel projects. Keep their project IDs,
   root directories, custom staging environment, variables and domains. This deliberately disables
   automatic PR previews too; a separate preview workflow can be added later. No competing Git
   deployment may race the controller. Verify both live environments remain available.
6. Preserve branch protection and `web-admin-validate`. Main becomes the integration branch only
   when setup is verified. Set `OPTION_B_ENABLED=true` and dispatch the release using a successful
   **main-push** CI run ID for the implementation revision. A manual CI run is not release proof.
7. Rehearse the first staging rollout and inspect all evidence. The bootstrap release rebuilds
   both apps to establish `/api/release` identity. Do not approve production until hosted acceptance
   passes. Capture real timing separately from estimates.
8. Owner approval permits the first production rollout. Verify its completed deployment record.
   New work then starts from `main`; no staging-to-main promotion PR or sync-back is needed.

If configuration is incomplete, leave `OPTION_B_ENABLED` unset/false. Checked-in files do not
activate the new workflow. A rollback of the **cutover** requires disabling the flag, waiting for
active jobs to stop safely, reconciling branches/environment versions, and deliberately restoring
Git routing. Never re-enable competing deployment paths during an active release.

## Secrets and settings

Repository variables:

| Name | Value |
| --- | --- |
| `OPTION_B_ENABLED` | `true` only after cutover prerequisites pass |
| `RELEASE_BOOTSTRAP_SHA` | Full 40-character verified initial production commit |

Both GitHub environments need these secrets, with values scoped to their own services:

| Name | Purpose |
| --- | --- |
| `VERCEL_TOKEN` | Deploy/read the two existing Vercel projects; use a limited team/service identity |
| `VERCEL_AUTOMATION_BYPASS_SECRET_SITE` | Check protected runner deployment URLs |
| `VERCEL_AUTOMATION_BYPASS_SECRET_WEB` | Check protected admin deployment URLs |
| `SUPABASE_ACCESS_TOKEN` | Project-scoped management read/deploy access for the intended environment |
| `SUPABASE_DB_PASSWORD` | That environment's database password; used only for pending migrations |

Production additionally needs **read-only staging access** to recheck the accepted candidate:

- `STAGING_VERCEL_AUTOMATION_BYPASS_SECRET_SITE`
- `STAGING_VERCEL_AUTOMATION_BYPASS_SECRET_WEB`
- `STAGING_SUPABASE_READ_TOKEN` (project health, migration query and function inventory read access)

Vercel tokens are scoped to projects/team capabilities, not treated as cryptographic environment
isolation. Keep workflow changes reviewed on protected main. GitHub environment approval guards
release execution; it is not protection against a malicious maintainer changing trusted code.

The controller checks fixed project IDs and root directories. Public build variables must match:

| Environment | Supabase | `NEXT_PUBLIC_SITE_URL` |
| --- | --- | --- |
| staging | `https://pepbmqomiailnnvvwupz.supabase.co` | `https://staging.racepace.com.ph` |
| production | `https://whaqarofxdlzxrelbcrq.supabase.co` | `https://www.racepace.com.ph` |

Both apps require the matching public anon key. Never define `SUPABASE_INTERNAL_URL` on Vercel.
The helper creates `NEXT_PUBLIC_RELEASE_SHA` during each build. A static public `/api/release`
response contains only app, commit and public Supabase project identity.

## What acceptance proves

Automated checks prove candidate/deployment identity, expected environment, Ready state, login-page
response, backend inventory and alias ownership. They are not full browser/business-flow acceptance.
Before approving production, inspect the exact staging candidate and record the affected flow
results or a durable evidence link in the GitHub approval comment:

- UI change: changed screen, desktop/mobile behavior and the affected interaction.
- Auth/authorization: sign-in/recovery and organization isolation with staging test accounts.
- Money/provider change: test-mode checkout/webhook/ticket/email and relevant failure handling.
- Schema/function change: compatibility with the old application and required permissions.

The approval comment is an owner attestation. The pipeline does not parse it as an automated test.
Do not approve because only the HTTP smoke checks passed. Production checks are read-only; the
owner performs any live financial acceptance. No automation inserts production QA data.

## Evidence, retries and failure

The controller stores source/tree/lockfile identity, cumulative change scope, CI run, backend
versions/digests, build configuration fingerprints, current/prior app IDs and verification times.
Workflow JSON artifacts are retained for 90 days. Completed GitHub deployment payloads provide the
durable production baseline independently of artifact expiry. Only `release:option-b` ledger
entries with a completed successful status become baselines. Partial attempts retain mutation
state and do not advance that baseline.

Use **Re-run all jobs**, or dispatch a new release for the same trusted main-push CI run.
Do not use Re-run failed jobs: attempt-bound artifacts deliberately reject stale producers.
If the controller source changed since the candidate, validate/release a current main candidate.
If an active release is cancelled, inspect partial artifacts and hosted state before retrying.
Already applied migrations may remain; never edit or remove them to force a retry.

Both Vercel apps cannot switch atomically. A partial rollout can temporarily expose different app
versions. Backend additions must support both. Production candidates do not touch public domains
until verification, but compatible backend changes already apply after approval.

### App rollback

With explicit owner authorization and the affected production artifact downloaded locally:

```bash
node scripts/release/vercel.mjs rollback production production-promoted.json rollback-evidence.json
```

Use the most recent available partial promotion evidence if the rollout failed. The helper verifies
the current alias is the failed candidate or already-restored previous deployment. It refuses to
overwrite an unrelated newer release. It records each restoration and checks alias readback.
Run read-only browser checks after restoration. Database writes are not reversed; function recovery
requires a separately reviewed compatible bundle or forward fix.

Rollback does not rewrite the completed ledger automatically. Pause releases and reconcile the
baseline with actual app/backend state before resuming. A changed alias correctly blocks the next
normal release until recovery is recorded. Never blindly change `RELEASE_BOOTSTRAP_SHA` after a
ledger exists. Save rollback evidence and the reviewed recovery decision with the release record.

### Changes that require a manual release procedure

The automated backend helper refuses edited/deleted/renamed existing migrations, removed functions,
mutable imports, unsupported function configuration and changes to hosted configuration, Auth
templates, secrets, seeds or provider files. It never pushes `supabase/config.toml` wholesale and
never deploys `fake-checkout` to hosted projects. A manual change must preserve the same staging
acceptance and production approval boundary; reconcile its baseline explicitly afterward.

Exact direct function dependency versions and a committed Deno lockfile replace the floating
Supabase import. CI verifies the frozen graph. Hosted bundle digests are recorded from readback;
do not equate source digests with proof of an existing remote bundle's source. The first hosted
rehearsal must verify server bundling and repeatability before relying on the timing target.

## Validation and timing

Run focused release tests and actionlint, then the app/shared UI/backend suites and app builds.
Use an isolated local Supabase project; never reset another task's stack or a hosted database.
The reference implementation keeps all integrated-source checks. Cross-run PR-result reuse and
full automated authenticated business acceptance are not implemented. These remain explicit future
optimizations, rather than weakening the release gate.

The 8–15 minute automated target is unmeasured. Both environment builds remain required. Human
review, approval, cold caches, migrations and provider acceptance add time. Record actual CI and
deployment durations after cutover before reporting improvement.
