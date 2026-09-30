# Users payments and Reservations category filter — October 1, 2026

## Scope and release exception

The owner explicitly requested production first, then staging synchronization. Group registration cards now show each participant's actual captured allocation, including processing fees. Account transaction summaries retain the whole captured payment. Individual legacy paid/refunded payments retain their existing values. Reservations adds a category filter populated by the selected event, combined with search/status, without splitting checkouts or changing event totals.

The isolated feature revision is `174f43981d545771257bc93979e02a7618fcc995`, based on production `f2f1b3e662b637d192471bdb44320831dad75fc6`. Direct production admin deployment: `dpl_4fJjMwJEinWuDfx2F1Wz1Gp3aax6`, Ready and promoted to the production alias before staging integration. GitHub protections and the staging-source guard were preserved. Intervening staging changes were documentation only; their conflict was resolved without changing application/backend code.

## Git and application readback

| Environment | Source | Admin deployment | Runner deployment |
| --- | --- | --- | --- |
| Staging | PR #220, `a74bc73ff4526b6fbde38fda2cdf5ababc0bfe47` | `dpl_B9jUDrysZzrA5f1EFuiUdNcNEgaj` | `dpl_5h21qJvXt66rcCYc7PXdLur9z1vT` |
| Production Git alignment | PR #221, `083bbc749c666aece5a319e5f8b4dc755b6623f5` | `dpl_ThVXjjLEX9YVqsMTopcjU79JXDQx` | `dpl_usVhhdhDzJNxgqnAqAp4YyyRvhBy` |

Staging deployments are Ready at the stated source with staging aliases. Production Git deployments are Ready at the stated main commit with the production aliases. Fresh authenticated production reads confirm the same participant and full-transaction amounts. Both apps' compiled bundles independently reference their matching Supabase project: staging `pepbmqomiailnnvvwupz`, production `whaqarofxdlzxrelbcrq`. No application or backend content differs between the feature revision, staged revision and main alignment.

## Backend

Both projects retain 180 migrations, latest `20260930083846`. No new migration or database repair is required. Only `platform-users` was deployed: production version 8, staging version 6, JWT verification enabled. The entrypoint, shared Supabase client, platform-user helper, CORS helper and deno.json match exactly between environments and the reviewed sources. Both bundle hashes are `8261275e8cb2ee4bf816759228b8d6e3fc339603ed06d59cfcca5d352af0686f`.

The initial production function deploy was rejected because the CLI omitted an import map. Retrying with the existing `--import-map supabase/functions/deno.json` succeeded. No provider, Auth, email, webhook, CAPTCHA, schedule or secret changes were made. Restoring the prior function bundle or admin alias is a read-only display rollback; captured payments remain unchanged.

## Validation and acceptance

2,501 tests passed locally and in the required feature/PR/staging checks: runner 548, admin 1,043, backend/shared 897 and shared UI 13. Relevant typechecks, both optimized production builds, 180-migration replay/retirement assertion and Fieldnotes audit passed. The isolated local stack used ports 55121/55122 to preserve other tasks' containers. Six initial proof API failures were an omitted local verifier URL; all seven cases passed after restoring the standard CI environment. The local stack and task-owned servers were stopped after acceptance.

Production authenticated reads show ₱1,743.59 on each of the investigated participant cards, and ₱3,487.18 on the account transaction summary. Registration fees remain ₱1,700 each; the paid amount includes captured processing fees. No duplicate charge or payment mutation was involved.

Kibalabag's category dropdown offers 70k, 42k, 25k, 13k and 7k. Selecting 42k returns 13 checkouts. Combining category/payment/search preserves the investigated managed checkout at ₱422.56; Clear filters restores 38 checkouts. Unfiltered event totals remain 38 total, 32 paid, ₱6,960.73 collected and six pending. Tablet 768px and phone 390px checks have zero horizontal overflow.

Existing staging data confirms unequal participant shares, zero captures and legacy refunds. Selecting either 21k or 70k retains the same mixed-category checkout at ₱812.18. No production fixture, registration, payment, refund or other financial transaction was created for verification.

## Synchronization

This evidence change starts from the aligned main commit and carries it back into staging. The sync pull request records final ancestry, application/backend equality and both staging deployment IDs after merge, avoiding a self-referential documentation commit. No new feature or backend change is included.
