# Recover the deployed lifecycle email worker

## Context and root cause
Option B inventory validation rejects the hosted `send-lifecycle-email` function because its
entrypoint and renderer were never committed. Both environments still schedule
`drain-transactional-email`. Staging version 9 and production version 8 return identical
six-file source bundles. Removing the function would break existing email delivery.

## Scope and tasks
1. Recover only `supabase/functions/send-lifecycle-email/index.ts` and
   `supabase/functions/_shared/lifecycleEmail.ts` from deployed source. Preserve their bytes.
   Validate both recovered files against both environment snapshots.
2. Add the existing hosted `verify_jwt = false` setting for this worker. Its handler enforces
   `TRANSACTIONAL_EMAIL_WORKER_SECRET` before creating a service client or claiming jobs.
   Validate rejection of unauthorized requests and behavior with missing configuration.
3. Add focused tests for the recovered renderer and worker: escaped user content, staging
   warning, delivery idempotency, stale jobs, failed sends and lost lease completion.
   Validate focused tests and the frozen Deno dependency graph.
4. Run the complete local backend suite in an isolated local Supabase stack. Reuse same-session
   passing frontend checks because no frontend source or dependency changes. Review all recovered
   source and integration with current shared helpers. Record provenance and outstanding cutover gates.

## Boundaries
No migrations, provider settings, schedules, secret values or deployed functions change in this
recovery. Do not import unrelated dirty files from the shared checkout. Existing shared helpers
stay intact: email transport differs only in formatting; emailBrand accepts an optional argument
whose default preserves this worker's output. The Supabase client uses the newly pinned dependency.

Option B remains disabled. Configuration differences still require the reviewed manual baseline
procedure; do not weaken the controller's rejection of configuration changes. Hosted staging
acceptance and explicit production approval remain required.
