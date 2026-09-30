# Annotated UI polish release — 2026-09-30

## Approved scope

Owner selected open checklist A for category inclusions. Existing inclusion content and category shells remain intact. The 12 admin annotations cover matching canvas/sidebar colors with White default, collapsed logo alignment, status badges without decorative dots, checkbox/helper spacing, Add button padding, and the sticky event editor navigation.

## Source and local validation

Feature commit: `c40a018bb31b31c45a572a1fc2d4e6a0918c5e09`; [PR #197](https://github.com/JSON-FX/race-pace/pull/197).

Local: 522 runner, 1,017 admin, 827 database/shared, and 13 shared UI tests passed, total 2,379. Both app and shared UI typechecks, Fieldnotes audit, fresh isolated 177-migration replay, retired-job checks and isolated application builds passed. Final presentation passed 39 focused event tests and another runner typecheck/build. Storybook source matches the approved app component; typechecks and all four catalog builds passed. Mobile story uses a real viewport; local catalog review covered 375/390-pixel wrapping and eight items.

GitHub PR run `36648867868` passed. The initial push run failed in Next.js Google font loading; the identical revision passed the PR build. Push retry `36648861020` passed, including both builds. Hosted release evidence is recorded below after completion. No validation gate was bypassed.

## Hosted backend baseline

No backend, Auth, Storage, payment, email, provider, or workflow source change is included. Both databases have 177 migrations through `20260929191739`. Production has 31 Active functions; staging has 32 including its fake checkout. Full production function versions, JWT flags and bundle hashes are recorded in `annotated-ui-polish-functions-20260930.json`. Existing `org-members` and `group-payment-prepare` bundle differences predate this release; this UI task deploys no functions.

Environment-specific PayMongo and Resend secret fingerprints were independently checked. They differ between staging and production. Provider values remain unchanged; this presentation-only acceptance performs no charge or refund.

Production baseline: one open event; 140 category/event slots, 16 taken; 25 registrations (16 paid, 6 expired, 3 cancelled); 21 payments; zero reservations. The eight inclusions retain their original order and text. Production verification is read-only.

## Initial hosted staging acceptance (superseded)

Staging merge: `d250f5cc7bd2066b97d593450cbd632ea92cc4f0`. Exact merge CI `36650662258` passed. Runner deployment `dpl_4GVrmA65LA6KMArEduTxNB6vSynZ` and admin deployment `dpl_BiBgz8agJ53bLYX1yEgPKEnKUK2Z` are Ready and own their staging aliases. Initial acceptance passed colors/logo/badges/form spacing, but found an anchor containment bug that blocked promotion. A pre-existing React hydration warning (#418) was independently reproduced in the untouched production event editor at deployment `dpl_2HjotuiLsKbgTrDv4qWLoe795gvn`; this release does not change date/time rendering. The correction makes the inner scrolling region a positioning container, prevents scrolling of the outer shell, and uses inclusion-container width for responsive columns. Renewed local validation passed 2,379 tests, all app/shared UI typechecks and the component audit. An initial local backend rerun lacked its function environment file path; the corrected test setup passed all 827 backend tests without a source change. Both corrected isolated app builds passed. Storybook typechecks and all four catalogs passed again with a dedicated 224-pixel category context. Corrected hosted acceptance passed as recorded below.

## Production and synchronization

Production PR #199 passed required CI `36653825676` and merged at `8ef3b4fedf2aa2757574bc84affbc30b7c96ab68`. Runner `dpl_GzzC1xhUSFZpjpuCW48q95Ra2MXG` and admin `dpl_GKfcsuEWGSNoFiTYXA6k6TVEvG3G` are Ready and own their production aliases. Browser readbacks confirm those exact deployment IDs. The live event displays all eight ordered inclusions without a disclosure and retains its ₱1,700 entry action. The phone checklist fits its 224-pixel container in one column.

Production readbacks passed all four annotated status tables, matching White canvas/sidebar colors, centered collapsed logo (zero offset), and event-editor anchors with header y=0 and outer scroll=0. Read-only SQL confirms the baseline event/category IDs, 140-slot capacity, 16 taken, 16 paid / 6 expired / 3 cancelled entries, 21 payments, zero reservations, original price and all eight inclusions. All 31 production function definitions/versions/hashes remain identical. No synthetic production record, payment, refund, form save, or check-in action occurred.

A 15-pixel document overflow at 390 pixels was reproduced on the untouched previous runner deployment `dpl_4CLutQRpVgBVJEZefb2VLpgK9wUB` and the corrected production deployment. It accompanies the existing transformed hero image; the new inclusion list itself has matching 224-pixel scroll and content widths. This scoped release preserves the surrounding runner sections. The pre-existing editor hydration warning and hero overflow are follow-up observations, not regressions introduced here.

Production-safe acceptance and main-to-staging synchronization are complete. Public proof is saved at `docs/previews/category-inclusions/evidence/production-checklist.jpg`.

All three live editor Add controls measure 44 pixels high with 8-by-12-pixel padding; the two annotated checkbox labels have 16-pixel padding and 21-pixel line height. Production runner (24 served JavaScript assets) and admin editor (28 assets) each reference only production Supabase. Post-deployment PayMongo and Resend fingerprints remain unchanged. PR #200 is the main-to-staging synchronization.

Exact production merge CI `36654699756` passed. The owned local function server exited and no `racepace-ui-polish` containers remain running. Browser viewport overrides were restored.

The first synchronization PR CI attempt `36655141570` failed while starting its isolated Edge Runtime with `Bus error (core dumped)` and health-check HTTP 503. Migrations had replayed, but tests had not started. The same main commit already passed full CI `36654699756`. This is a hosted CI container startup failure; the failed job was retried without changing source, workflow, or production services. The final retry result is recorded below.

Synchronization attempt 2 passed migration replay, types and all test suites, then hit the intermittent Next.js Google font loader `Cannot read properties of null (reading '1')` in the runner build. The identical production merge already passed both CI builds and both hosted Vercel builds. Attempt 3 retries the failed job without changing fonts, application source or the workflow. No protection or required check was bypassed.

## Corrected staging acceptance

PR #198 passed push CI `36651654368` and PR CI `36651666562`, then merged into staging at `ea71c4970629d263c0b96c893bf53566a4fe8650`. Both aliases serve that commit: runner `dpl_33XjzGttLnoH7DUAsnP4unBW1Zqb`, admin `dpl_4k8KJH7oZiZm32LnTp64S32fCDSA`, both Ready. Exact merge CI `36652685993` passed.

Corrected browser acceptance passed desktop native scrolling and keyboard/anchor navigation. The header remains at y=0, the desktop rail at y=90, and the outer shell has zero scroll with matching 720-pixel content and viewport heights. At 390 and 768 pixels, anchors keep the header at y=0 and section headings visible below the sticky strip; no horizontal document overflow occurs. Mobile Save and Cancel remain reachable above bottom navigation. Checklist columns respond to their actual container: 224 pixels at phone width and 342 pixels at tablet width each use one column; wide desktop categories use two. Both category lists are visible immediately and expose no disclosure button. The eight-item narrow Storybook fixture retains readable wrapping.

The served staging JavaScript assets were fetched through authenticated Vercel CLI: 30 admin and 25 runner assets succeeded. Each bundle set contains the staging Supabase reference `pepbmqomiailnnvvwupz`; neither contains production reference `whaqarofxdlzxrelbcrq`. No browser approval, payment, event save, or database mutation was performed. Provider and function readbacks remain unchanged from the baseline. The owned isolated local Supabase stack was stopped after validation.

## Synchronization closure

PR #200 passed synchronization CI `36655141570` on attempt 3 and merged at `d2fcc5ea1f571fe6b35da8d5e53a2a0b6c705fe7`. Main is again an ancestor of staging. Application, shared package, backend and workflow content is identical between both branches. The final audit patch changes documentation and a public screenshot only; it introduces no application or hosted configuration change.
