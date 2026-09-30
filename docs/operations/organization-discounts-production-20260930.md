# Organization discounts: production release, 30 September 2026

Status: released to production; main-to-staging synchronization tracked in PR #206.

## Reviewed source and staging acceptance

Production PR [#205](https://github.com/JSON-FX/race-pace/pull/205) promotes staging
`1253b36d4c48cfeea4b7d89284bd2f0122cc43c5`. Its complete Git tree matches reviewed PR #204
head `f3915b85`. Application/backend source matches the feature merge `55a6c5f`.

Local validation passed 2,410 tests, typechecks, both builds, 178-migration replay and Fieldnotes
audit. Exact staging CI `36686643937` passed. Both staging aliases are Ready at `1253b36`:
runner `dpl_BQtAAMeZW2pP1jcGdq2LM6ZMYzZ2`; admin `dpl_SgeQ6U5wzX73oWrw2YHrSf9euKLi`.
The staging admin browser scripts identify that deployment and Discounts loads correctly.

[Hosted acceptance](organization-discounts-staging-20260930.md) covers free single/group entries,
mixed paid/free groups, PayMongo test capture, special fee absorption, provider-confirmed checkout
expiry/retry, discounted participant refund, approved-screening entry, reports, responsive summary,
and delivered Resend tickets. No production fixture or automated live financial transaction was used.

PR #204 CI attempt 1 and PR #205 CI attempt 1 hit the existing intermittent Google `next/font`
loader error after passing tests. PR #204 and PR #205 retries passed without source changes. Production promotion CI `36686681704` attempt 2 passed.

## Production backend

Project `whaqarofxdlzxrelbcrq` has 178 migrations through `20260930053856`. The applied migration
SHA-256 is `b70f33c82c127daf8908b4c58a076fc783e7921304df4f801417ba9ccd87fc60`, identical to staging.
Schema and data backups completed before rollout with private file permissions. Existing deployed
function sources were downloaded and matched pre-release production `8ef3b4f`; rollback copies remain local.

Immediately before migration, production had 29 registrations and 22 payments. Full pre-existing row
fingerprints were identical after migration; only the new discount fields were excluded from comparison.
No negative group-allocation net, negative payment net, or capture without a payment ID existed.

The CLI exited successfully but reported a post-success pg-delta catalog-cache certificate-file warning.
Independent SQL confirms migration history, new tables and grants. Initial function deploy attempts using
an alternate working-directory flag failed with an internal deployment error; function versions remained
unchanged. Running from the isolated production project directory succeeded with identical source.

All 13 functions are Active. Every downloaded file matches the reviewed source; aggregate hashes also
match the staging bundles. Authentication settings are unchanged from the verified staging contract.

| Function | Production version | JWT verification | Source SHA-256 |
| --- | --- | --- | --- |
| `discount-checkout` | 1 | false | `540b8c24dfe7818b147d8f371c7d0afd68f4b68e1995a69be04057a6068a0603` |
| `registrations-checkout` | 41 | true | `9472a0586301a7e83fe0b59c12ee1565cbc00db1db181f00a5e6c1a974aac291` |
| `payment-session` | 38 | true | `e371014d9cdc164c6e4c1d307d54a5476f4386a5842473cdb39ce0e067c639c9` |
| `payment-verify` | 39 | true | `e28e0b2e91d1c1c8ac07c2c2308d56e32018e0f2a51e8837eec8b6270d0cfcd7` |
| `payments-webhook` | 38 | false | `8bb4cedf92e988b40e118ed7973e06c53304de72940d598b028e47ff4909ec77` |
| `group-payment` | 17 | true | `5a5212c5e73fcccb213d02042421b2d16aadd6899c5173dc3fe7269b96745e1f` |
| `group-payment-prepare` | 16 | true | `a551a1739378b853b73c70eaefd717b113911a5b02893ca33d49ad1256ab8486` |
| `expire-paymongo-checkouts` | 17 | false | `9c606298717018366340219416404f73df3baaa2a3f157a8868959393088e4aa` |
| `expire-coming-soon-reservations` | 5 | false | `c21b357d8a630dcefd1dd11053c1438e8d6a5f12033d2b190bd11fe2eb9fa322` |
| `reprice-event-checkouts` | 9 | true | `2d10e416a2bda94fa2191e7626e9973097c74ea5832cc868b1524a98dd8def43` |
| `prescreening-maintenance` | 3 | false | `c4d9e42c658eb01aac8008ac1529d0a654c75cc693f522a3d538c70f20b2a486` |
| `reservation-checkout` | 5 | true | `53f0114e235369a60368388b00b8acfe6032a53e8dda8f1a6fb55e4d3718c093` |
| `reservation-verify` | 5 | true | `277f8c17092007de3178aa2dd3cf14483dc4f7d9aaf5d48ef6d3294c9d844000` |

All Edge secret fingerprints are unchanged. Production/staging payment, webhook, Resend and URL
fingerprints remain distinct. Production group reservation, preparation and payment flags remain true.
An unauthenticated POST to `discount-checkout` returned 401. All three new discount tables have row-level
security enabled; no new discount function is executable by anon. Runner mutation functions remain
service-only; admin mutations retain authenticated organization authorization. No discount code or
redemption was created by deployment.

Security advisors have no ERROR-level findings. The new informational restart-table notice reflects its
intentional service-only access. Four authenticated security-definer helpers are expected and enforce
organization authority. Existing pg_net, auth-helper and leaked-password notices predate this release.
See the [Supabase authenticated-function advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Provider and production-safe preflight

Existing paid payment evidence contains only livemode=true. All ten schedules were active and their latest
runs succeeded. Preflight Edge logs from 07:00–07:40 UTC contain no HTTP 5xx. Existing transactional
email jobs were sent; Resend confirmed Delivered for production email `01a0f12e-561a-7c97-a517-ad29b0089cc9`
with sender `Race Pace <no-reply@notify.racepace.com.ph>`.

The existing `PUBLIC_SITE_URL` fingerprint identifies `https://race-pace-site.vercel.app`; Vercel confirms
that alias serves the same production deployment as `www.racepace.com.ph`. This existing configuration
was preserved. Authenticated production admin access and public runner, sign-in and recovery pages load.
No reset email, new user, synthetic record, real payment or refund was initiated by this release.

## Application rollout and closeout

PR #205 merged as `7a2fc226c0a94d597562a130172b662be64dfe1e`. Vercel initially skipped both
Git-triggered builds as “not affected.” Explicit redeployment of those exact production deployment
sources produced the following verified Ready deployments:

| Application | Production deployment | Verified alias |
| --- | --- | --- |
| Runner | `dpl_CX3HPxtPodXNCdhhPfNmRa9RASfh` | `https://www.racepace.com.ph` |
| Admin | `dpl_6KKGHWDm9G1JrCruFjJWUq9jEi6T` | `https://admin.racepace.com.ph` |

Vercel identifies `main` and exact commit `7a2fc22` for both. Public bundle readback found production
Supabase `whaqarofxdlzxrelbcrq` in both apps and no staging project reference. Script deployment IDs
match the listed deployments. The authenticated live Discounts page and creation form render correctly;
the form was closed without submitting. The live runner lists both real events. Admin console inspection
reported no errors during these checks.

Post-backend logs from 08:11–08:18 UTC show only HTTP 200 for observed scheduled functions. All ten
schedules retain succeeded latest runs, including the updated five-minute workers after deployment.
Production-safe checks created no code, redemption, registration, payment, refund or test account.

[Sync-back PR #206](https://github.com/JSON-FX/race-pace/pull/206) carries main back into staging
without application/backend changes. Post-merge production CI is `36688627769`; synchronization CI
is `36688670111`. At this documentation checkpoint, both checks are pending and PR #206 is open. Their live results
and final merge state are attached to that PR. This evidence update is documentation only.
Owner-run live financial acceptance remains separate.

Local evidence: `/tmp/discounts-production-record-preservation.json`, function source manifests under
`/tmp/discounts-production-after-bundles.json`, public bundle verification in
`/tmp/discounts-production-assets.json`, and the production form screenshot
`/Users/jsonse/.codex/visualizations/2026/09/30/01a0f0c6-791a-7a20-a518-99175ce581ee/discounts-production.png`.
