# Implementation report: organization admin Guide

**Plan:** `docs/plans/2026-09-27-org-admin-guide.md`
**Branch:** `codex/org-guide-prototypes`
**Status:** COMPLETE locally; staging release authorized and in progress.

## Summary

The selected Video Library is integrated at `/guide` using explicitly synchronized Storybook Fieldnotes components and the existing admin shell. Org admins search/filter/sort and watch published guides. Super admins upload actual videos, edit metadata, save drafts, and publish a shared library. Private Storage and metadata policies enforce both roles and publication status.

## Tasks completed

- Created `guide_videos` and private `guide-videos` bucket in additive migration `20260927010129`.
- Added Guide navigation, page/loading/error, library, native player, and real browser upload with measured duration/generated thumbnail.
- Added normalized metadata validation, authenticated queries, uploaded-object checks, bounded signing, and retry-safe saving.
- Synchronized Fieldnotes Button/Field/Spinner adapters; recorded exact source and consumer hashes.
- Updated specification, plan, roadmap, launch ledger, and saved browser check. Technical review has no unresolved findings.

## Tests added

`supabase/tests/guide-videos.test.ts` covers super/admin/editor/marshal/runner/anonymous roles, two organizations, drafts, object signing, exact thumbnail/video matches, constraints, grants, and unpublishing. Three web guide files add 52 checks for validation, actions, search, draft isolation, playback failures, editing, and upload reuse. Navigation gains one Guide/mobile/role regression.

## Validation results

| Check | Result |
|---|---|
| Fresh migration replay | 158/158; zero retired push jobs or legacy keys |
| Backend/shared test suite | 98 files; 777 passed |
| Admin tests | 123 files; 988 passed |
| Runner tests | 65 files; 483 passed |
| Web/site/shared typechecks | Pass |
| Runner/admin optimized builds | Pass; `/guide` is authenticated server rendered |
| Browser | Real 44 MiB upload persists; duration 8:43; private playback reaches playing state; normal local sign-in passes |
| Permissions | Two org admins see published content; drafts hidden; editor page denied; uploads absent for org admins |
| Responsive/accessibility | 1440/820/390 document width matches viewport; keyboard trapped/restored; mobile More contains Guide; reduced motion 0s |
| Review and whitespace | Pass |

Screenshots and logs live in ignored `.local/guide-validation/`. `docs/previews/guide/check-application-browser.js` is the repeatable Playwright check. Local Next serves the optimized build at `http://127.0.0.1:4180/guide`; `.local/guide-preview-access.md` contains disposable local account access. The stack uses project `racepace-guide-validation` and ports 547xx. Shared stacks and LAN route ownership were preserved.

## Deviations from the plan/proposal

- The unverified proposal label of 500 MB is corrected to the repository's existing 50 MiB global Storage cap.
- The existing SidebarInset gains `min-w-0` after tablet verification exposed inherited minimum-width overflow.
- Native controls and actual recording frames replace illustrative lesson media. No fake lesson rows ship in the migration.

## Issues encountered

Initial full backend validation lacked the fake-provider environment file. A second run exposed the provider's default public URL pointing at port 54521. The ignored isolated runtime now explicitly uses port 54721; final 777-test run passes. No application money path was changed.

Playwright's screenshot caret override produced a development hydration warning when applied before hydration. Final screenshots use `caret: 'initial'` and the optimized application; the final browser pass reports no application errors.

## Release boundary

The owner authorized staging delivery on 2026-09-27. Commit, pull request, deployment, and hosted acceptance are in progress. Production promotion is not authorized. The migration creates no guide rows or media. Hosted delivery must use the staging-first workflow, confirm the hosted global upload cap, apply the reviewed migration, and verify real super-admin upload plus org-admin playback before production promotion.

Local preview sign-in uses the documented [Cloudflare test site key](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) in ignored local environment settings only. It does not change application authentication code or hosted provider configuration.
