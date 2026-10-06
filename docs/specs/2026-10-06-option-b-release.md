# Option B: one integration branch, staged releases

Status: approved for implementation on 2026-10-06; hosted cutover pending validation.

## Contract

`main` becomes the integration branch after the cutover. Short-lived branches enter through
reviewed pull requests. A successful integrated-source CI run creates a release candidate.
Staging and production are deployment environments, not promotion branches.

Keep two Vercel projects and two Supabase projects. Staging uses `pepbmqomiailnnvvwupz`;
production uses `whaqarofxdlzxrelbcrq`. Environment-specific Next builds remain separate.
Production credentials and mutations require a protected GitHub environment approval.

## Required behavior

1. Parallelize app and backend validation, retain the required `web-admin-validate` aggregate,
   and keep database test files serialized. Fail the aggregate on missing, failed or cancelled jobs.
2. Compute deployment changes against the last successful production record, not the previous
   commit on main. Also reconcile rejected and partial hosted attempts. Include renamed/deleted
   files. Unknown/shared inputs select all affected apps.
3. Pin source SHA, tree, lockfiles, workflow inputs, migrations, function source digests,
   configuration identities, deployment IDs and prior app IDs in machine-readable evidence.
4. One release workflow owns staging through approval and production verification. Do not
   cancel an active deployment. New main commits cannot replace a candidate awaiting approval.
5. Deploy only changed backend components and affected apps. Verify hosted migration history;
   reject edited/deleted applied migrations and removed functions. Use additive compatible
   migrations; breaking/provider changes require deliberate operator acceptance.
6. Run hosted staging smoke checks against exact deployment URLs. Authenticated and business-flow
   acceptance is recorded in the protected production approval until adequate scenario coverage exists.
7. Require owner approval before production backend changes or builds. Build production candidates
   without assigning production domains. Verify before promoting each app in a controlled sequence.
8. Record success only after alias/deployment readback and safe production checks. Provide explicit
   app rollback using previously recorded IDs. Do not pretend rollback reverses database writes.
9. Refuse releases before configured credentials, baseline evidence, Vercel routing cutover, and
   required GitHub approval protection exist. Keep the legacy release policy active until cutover.

## Deliberate boundaries

Initial implementation validates the integrated main revision again. It does not infer that a PR
head proves a different merge result. There is no duplicate staging-to-production CI gate.
Cross-run result reuse may follow after source/configuration identity is proven reliably.

Routine hosted automation proves routing, response health and environment identity. It does not
claim that sign-in, payments, email, tenant isolation, or every changed screen passed because an
HTTP request returned 200. Protected hosted acceptance covers relevant business flows. Production
checks never create synthetic records or charge/refund money. Secrets, provider configuration,
Auth templates and schedules remain explicit environment operations with recorded acceptance.

## Cutover

Ship this implementation through the existing staging-first policy. Before making main the
integration branch: reconcile source, configure protected environments and credentials, record
the current production baseline, disable Vercel Git auto-deploys for main/staging, validate the
orchestrator on staging, and explicitly activate `OPTION_B_ENABLED`. Document current state;
do not delete staging or weaken required checks during implementation.

## References

- https://vercel.com/docs/cli/deploying-from-cli#deploying-a-staged-production-build
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments
- https://supabase.com/docs/guides/deployment/managing-environments
- https://dora.dev/capabilities/trunk-based-development/

Targets of 8–15 minutes automated work are estimates, excluding reviews/approval. Measure real
releases after cutover; no performance percentage is accepted without comparable run evidence.
