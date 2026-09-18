# Implementation Report — Optional check-in and admin operations

**Plan:** `docs/plans/2026-09-16-assisted-registration-passport-revisions.md`
**Branch:** `feature/admin-ui-changes`
**Status:** Local implementation and tests pass; staging verification pending.

## Summary

Organization admins can set a default check-in mode for new events and override it per event. Existing events remain check-in required. The admin station suppresses scanning for disabled events, while the database rejects a direct scan request. Tickets and kit release remain usable. The registrations table, detail, and export show the saved Team Name, not a legacy bib value.

## Validation

- Full admin app suite: 107 files and 870 tests passed. TypeScript check passed.
- Focused Supabase suite: 5 files and 42 tests passed after the latest local migration replay. It covers optional check-in, organization isolation, check-in, kit release, function grants, and the organization write-grant allowlist.
- CSV export regression: 20 tests passed, including an old registration with no Team Name.
- `git diff --check` passed.

## Release dependency and remaining work

Apply `20260918100000_optional_event_checkin.sql` before deploying the runner site or admin app. Neither app can read events with the new select list before the column exists. No Edge Function code changed; the deployed check-in function passes through the new database error. Confirm this on staging with an admin toggle, a marshal scan denial, and kit release. Hosted staging has not been changed by this work.
