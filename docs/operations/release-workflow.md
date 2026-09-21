# Staging-first release workflow

Status: required release policy.

This workflow keeps one reviewed change moving through local, staging, and production. It covers
the repository, Vercel, Supabase, Resend, PayMongo, Auth, CAPTCHA, webhooks, and scheduled workers.

## Architecture decision

Three models were considered.

| Model | Benefit | Cost | Decision |
| --- | --- | --- | --- |
| Separate staging and production feature branches | Familiar and flexible | Repeated merges and cherry-picks create drift | Rejected |
| `staging` promoted into `main` | Fits the existing Vercel custom environments and GitHub branches | Requires reconciliation and a post-release sync-back | **Selected** |
| Trunk plus immutable artifact promotion | Strongest same-artifact guarantee | Requires new deployment orchestration for both apps and Supabase | Revisit after launch |

The selected model has one invariant. Production may lag staging, but production must never lead it.
Production receives changes only through a pull request whose head is `staging` and whose base is
`main`. Merge `main` back into `staging` after each production release. This restores `main` as an
ancestor of `staging` before another feature starts.

## Environment contract

| Boundary | Staging | Production |
| --- | --- | --- |
| Git | `staging` | `main` |
| Runner | `https://staging.racepace.com.ph` | `https://www.racepace.com.ph` |
| Admin | `https://staging-admin.racepace.com.ph` | `https://admin.racepace.com.ph` |
| Vercel | custom `staging` environment | `production` environment |
| Supabase | `pepbmqomiailnnvvwupz` | `whaqarofxdlzxrelbcrq` |
| Database data | synthetic QA data allowed | real data only |
| PayMongo | test key and test webhook | live key and live webhook |
| Resend | `race-pace-staging` key and staging sender | `race-pace-production` key and production sender |
| Supabase Auth | staging Site URL and six staging redirects | production Site URL and production redirects |
| CAPTCHA | staging widgets and hostname allowlist | production widgets and hostname allowlist |

Never set `SUPABASE_INTERNAL_URL` on Vercel. Both Next applications must use the same Supabase
project for a given environment. Public Supabase URLs are build-time inputs, so any change requires
a fresh deployment.

## Normal release path

### 1. Start from staging

Fetch the remote branches. Confirm `origin/main` is an ancestor of `origin/staging` before starting.
Create the feature branch from current `origin/staging` and target its pull request to `staging`.

If that ancestry check fails, stop. Reconcile the branches before adding another release branch.

### 2. Validate locally

Run the repository's required checks against the exact commit proposed for staging:

```bash
pnpm install --frozen-lockfile
pnpm exec supabase start
pnpm exec supabase db reset
pnpm exec supabase status -o env > .env.local
node scripts/ci-assert-local.mjs
pnpm --filter site typecheck
pnpm --filter web typecheck
pnpm --filter site test
pnpm --filter web test
pnpm test
set -a
. ./.env.local
set +a
export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
export NEXT_PUBLIC_SITE_URL=http://localhost:3000
pnpm --filter site build
pnpm --filter web build
```

The GitHub `web-admin-validate` check also starts fake-provider Edge Functions before the tests.
Follow `.github/workflows/ci.yml` when reproducing the complete check. A green local or GitHub run
does not prove that the hosted staging backend or external providers work.

### 3. Release the exact commit to staging

Merge the reviewed pull request into `staging`. Record the merge commit before changing hosted
services.

For application-only changes, wait until both Vercel custom-environment deployments report Ready at
that commit. Confirm the staging aliases point to those deployments.

For backend changes, deploy every required part to staging from that same commit:

1. Apply reviewed additive migrations to the staging Supabase project.
2. Verify remote migration history against the `staging` branch.
3. Deploy only the changed Edge Functions and confirm their JWT settings.
4. Update staging-only secrets, Auth URLs, templates, SMTP, webhooks, CAPTCHA, or schedules.
5. Redeploy both Vercel applications when a build-time variable changed.

Use expand-and-contract migrations. Add compatible schema first. Remove old schema only in a later
release after both environments no longer use it.

### 4. Run hosted staging acceptance

Hosted acceptance must exercise the deployed staging revision, not a local container or generic pull
request preview.

At minimum, verify:

- runner and admin staging aliases load the intended deployment;
- runner and admin bundles reference the staging Supabase project;
- sign-in, recovery, and tenant isolation use staging Auth;
- organization creation, event creation, and email delivery complete end to end;
- applicable webhooks, scheduled workers, Storage, CAPTCHA, and Edge Functions use staging services;
- Resend records the expected staging sender and delivery result;
- any payment-path change uses PayMongo test mode only.

The current Playwright suite targets local Docker. It is not hosted staging evidence. Vercel protects
the staging aliases. Both projects have automation-bypass entries, but no GitHub workflow consumes
them. Store scoped values in GitHub only when the hosted test workflow is ready.

### 5. Record the staging release

Update `docs/operations/launch-progress.md`. Record all applicable evidence:

| Evidence | Required value |
| --- | --- |
| Source | staging Git commit and pull request |
| Applications | runner and admin Vercel deployment IDs and Ready state |
| Database | remote migration count and latest versions |
| Functions | changed slugs, versions, hashes, and JWT setting |
| Configuration | environment names and redacted fingerprints, never secret values |
| Providers | PayMongo mode, Resend sender, webhook or schedule status |
| Acceptance | tested flows, results, cleanup, blockers, and tester |

Do not open the production pull request while any required staging evidence is missing.

### 6. Promote staging into production

Open one pull request from `staging` to `main`. GitHub CI rejects any other head branch for a
production pull request. Do not rebuild the change on a new production branch.

Review the complete `staging...main` release diff. Merge only after local checks, hosted staging
acceptance, and the release record all refer to the same staging commit.

### 7. Release and verify production

Apply the reviewed production backend changes before dependent application code begins serving. Use
the same migration and function sources that passed staging. Confirm production secrets and provider
modes by identity or fingerprint without printing values.

Wait for both Vercel production deployments at the `main` merge commit. Then run production-safe
checks for aliases, Auth redirects, reads, logs, schedules, webhooks, and email delivery.

Production data is real. Never insert sample, demo, seed, or QA rows. Do not run an automated real
payment. The owner performs any live payment, refund, or finance acceptance.

### 8. Close and synchronize the release

Record the production deployment IDs, backend versions, verification evidence, and remaining manual
checks in `docs/operations/launch-progress.md`.

Then merge `main` back into `staging`. This sync-back should add the production merge commit without
changing application or backend content. Confirm `main` is an ancestor of `staging` before starting
the next feature.

## One-time reconciliation completed

PR #90 merged production `main` into `staging` on 2026-09-22 without rewriting either protected
branch. The nine conflicts retained staging-only release evidence and the later production code.
`main` is now an ancestor of `staging`, with zero production-only commits.

Staging migration `20260920200000` is applied and independently read back. Eleven Edge Functions
were deployed from the reconciled source, including the previously missing `group-reservations` and
`send-push`. Both staging applications are Ready and their bundles reference the staging Supabase
project. Exact-merge CI passed.

This synchronization is not production approval. The authenticated organization, event, and email
journey remains a manual hosted acceptance gate until a protected automated workflow exists.

## Rollback and failure rules

- Stop promotion when the exact staging commit, deployment, or backend version cannot be proven.
- Roll back application aliases to the last known-good Vercel deployment when application behavior
  regresses.
- Fix an applied database migration with a new forward migration. Never edit hosted history.
- Redeploy the last known-good Edge Function bundle when a function regresses.
- Keep provider changes environment-specific. Never solve a staging failure with production keys.
- Record failed attempts and cleanup evidence. A successful command without readback is not proof.

## Audit snapshot — 2026-09-22

| Surface | Result |
| --- | --- |
| Git branches | Synchronized: `main` is an ancestor of `staging`; zero `main`-only commits |
| Vercel production | Both apps Ready at `08512ba` from `main` |
| Vercel staging | Both apps Ready at `ee8c118`; runner `dpl_9fwjdrTRZPa68gxTd1VN6eWNoRVm`, admin `dpl_5jZbYaQJ1FX72WW4QZa3bCnq1fxa` |
| Vercel routing | `main` tracks production; custom `staging` tracks the staging branch |
| GitHub protection | Both branches require `web-admin-validate`; run `35651165007` passed on exact staging merge |
| Supabase migrations | Staging has all 145 repository migrations; `20260920200000` and its service-role-only function grant were read back |
| Edge Functions | Eleven reconciled functions are Active in staging; seven production bundle hashes still differ from the staged source and need review before a future production deploy |
| Supabase secrets | Environment-specific fingerprints differ; staging alone has `EMAIL_ENVIRONMENT` |
| Supabase Auth | Site URLs and redirect allowlists match their environments |
| Auth SMTP | Resend SMTP enabled in both projects with distinct sender names |
| Resend | Domain verified; separate staging and production sending keys exist |
| Hosted staging E2E | Public runner/admin smoke passed and both bundles use staging Supabase; authenticated business-flow approval remains manual and incomplete |

This snapshot is evidence for the date shown. Re-run every check before a release.
