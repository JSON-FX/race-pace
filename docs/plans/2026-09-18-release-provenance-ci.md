# Release provenance and CI for web/admin

Status: in progress. Scope: staging and production delivery controls for the runner site and admin console. Production data is out of scope.

## Goal

Make every staging build traceable to a reviewed Git commit, and prevent untested changes from reaching `main`. Use the two existing Vercel projects and their GitHub connection. Keep the current staging Supabase project isolated. Do not apply migrations or send synthetic data to production as part of this work.

## Current evidence

- `main` has no GitHub branch protection or ruleset. A local CI workflow has been drafted but has not run on GitHub.
- The current staging site and admin builds are Ready, but their Vercel metadata says `actor: codex` instead of a Git commit SHA. The pushed branch head is `99e451f`; later changes are still in the working tree.
- Vercel projects `race-pace-site` and `race-pace-web` are already linked to `JSON-FX/race-pace`. Use that connection instead of introducing a deploy token.
- Backend integration tests require a local Supabase stack and an Edge runner with no PayMongo key. A historical migration schedules a now-retired external push job; fresh CI replay must prove it is absent after migrations and must not configure a Vault key for it.
- Four staging GCash captures charged a 2.5% processor fee while the prior rate card predicted 1.5%. Staging now has a follow-up rate migration at 2.5%, but a fifth pass-on capture showed a one-cent difference between the quoted processing line and PayMongo's actual fee.
- The current provider uses `/v1/checkout_sessions` and computes its own pass-on surcharge. PayMongo documents `pass_on_fees` on `/v2/checkout_sessions`, where PayMongo selects the fee after the runner chooses a method. A live pricing feed before checkout is not documented.

## Delivery sequence

1. Inventory and review the working tree by feature boundary. Verify that the intended app and migration files match the tested staging behavior. Record any differences and do not call the current snapshot a release revision.
   - Validate: `git diff --check`, app typechecks, app tests, backend tests, and migration parity against staging.
2. Add one GitHub Actions CI workflow for pull requests and pushes to the staging and production branches. Check site/admin typechecks and tests. Run backend integration tests against local Supabase with no PayMongo key, and assert the retired push job is absent. Build both Next apps in isolated CI runners with local non-secret public configuration.
   - Validate: parse workflow YAML; run equivalent local commands; observe the exact workflow commit pass in GitHub.
3. Commit the reviewed source on the feature branch. Do not promote an uncommitted snapshot. Reconcile the current staging aliases to a Git-backed deployment of that exact commit. Preserve the staging Supabase project and test records.
   - Validate: Vercel deployment metadata contains the branch and SHA; staging domains serve that deployment; smoke checks pass.
4. Create a permanent staging branch from the reviewed commit and configure staging domains and variables to track it. Then configure GitHub `main` protection to require the CI job and pull-request review. If Vercel Deployment Checks are available, gate production domain promotion on the same check. Never merge to `main` as part of this setup.
   - Validate: branch/domain mappings and GitHub rules read back. A failing CI branch cannot merge or promote.
5. Test two-organization isolation, zero commission, pass-on fees and report reconciliation on staging. Prefer a reversible database-only probe where provider transactions or access grants are unnecessary; use real sandbox checkout only for the final hosted behavior. Record exact ledger and RLS evidence.
   - Validate: no second organization can read or mutate the first's private data; money invariants reconcile; production remains untouched.
6. Before enabling pass-on in production, move PayMongo checkout creation to its `/v2/checkout_sessions` provider-managed fee mode. The app should show entry and Race Pace fee before redirect, then clearly say the exact processing fee and total appear on PayMongo after method selection. Record the provider's charged gross and actual fee from the authenticated webhook or verification response; do not infer settlement from a rate card. Preserve idempotent callbacks, refunds, one-payment group checkout, and the existing absorb mode. Monitor unexpected method fees and investigate drift instead of silently changing historic ledger rows.
   - Validate: test GCash, Maya and card sandbox captures, changed-method retries, refunds and exports. Confirm each displayed PayMongo total equals the charged amount and each ledger row satisfies `gross - actual processor fee - platform fee = organizer net`. Keep pass-on disabled if any method cannot use the provider-managed fee feature.

## Sources

- [Vercel Git deployments](https://vercel.com/docs/git): branch-based preview deployments and staging domains.
- [Vercel Deployment Checks](https://vercel.com/docs/deployment-checks): gate production domain assignment on CI.
- [Supabase environments](https://supabase.com/docs/guides/deployment/managing-environments): local CI and separated remote environments.
- [GitHub required checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks): required job names and latest-commit behavior.
- [PayMongo Hosted Checkout](https://docs.paymongo.com/docs/payment-channels-hosted-checkout): `/v2` supports provider-managed `pass_on_fees`; the exact charge appears after method selection.

## Boundary

The initial CI workflow is a code gate. Hosted migrations, function deployments and production alias changes require a separate reviewed release step. An automatic Vercel build alone is not deployment approval.
