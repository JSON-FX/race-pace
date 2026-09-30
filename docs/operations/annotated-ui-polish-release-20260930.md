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

## Hosted staging acceptance

Staging merge: `d250f5cc7bd2066b97d593450cbd632ea92cc4f0`. Exact merge CI `36650662258` passed. Runner deployment `dpl_4GVrmA65LA6KMArEduTxNB6vSynZ` and admin deployment `dpl_BiBgz8agJ53bLYX1yEgPKEnKUK2Z` are Ready and own their staging aliases. Initial acceptance passed colors/logo/badges/form spacing, but found an anchor containment bug that blocked promotion. A pre-existing React hydration warning (#418) was independently reproduced in the untouched production event editor at deployment `dpl_2HjotuiLsKbgTrDv4qWLoe795gvn`; this release does not change date/time rendering. The correction makes the inner scrolling region a positioning container, prevents scrolling of the outer shell, and uses inclusion-container width for responsive columns. Renewed local validation passed 2,379 tests, all app/shared UI typechecks and the component audit. An initial local backend rerun lacked its function environment file path; the corrected test setup passed all 827 backend tests without a source change. Both corrected isolated app builds passed. Storybook typechecks and all four catalogs passed again with a dedicated 224-pixel category context. Corrected hosted acceptance remains pending.

## Production and synchronization

Pending promotion, production-safe readback and main-to-staging synchronization.
