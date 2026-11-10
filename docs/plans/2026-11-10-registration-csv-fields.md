# Registration CSV participant fields

Status: implemented and verified locally; release pending. Spec: `docs/specs/2026-11-10-registration-csv-fields.md`.

## Context and settled decisions

- Enhancement requested by the owner: eight participant fields in Admin registration CSV.
- The owner selected race day as the Age reference date.
- `OPTION_B_ENABLED=true` and successful release run `41488665975` confirm the
  active main-based workflow. Use isolated branch `codex/registration-csv-fields`
  from `origin/main` (`f49f978`). The shared checkout remains untouched.
- `apps/web/app/(admin)/registrations/export/route.ts` owns the streamed CSV.
- Its colocated `route.test.ts` tests filters, batching, escaping, and access.
- `apps/web/lib/queries/registrations.ts` already selects `custom_data`.
- `supabase/functions/registrations-checkout/index.ts` and
  `_shared/groupReservationValidation.ts` save individual participant snapshots.
- `apps/web/lib/csv.ts` supplies CSV quoting and formula protection.
- `events.event_date` is a SQL date. No migration or new dependency is needed.
- Baseline: admin suite passes 131 files / 1089 tests.

## Tasks, in order

1. Update the export and colocated tests. Add six missing columns and retain
   Category and Team Name. Group the eight requested fields after Email.
   Read snapshot strings defensively. Validate ISO birthdays and calculate
   completed years on race day without local-time Date getters. Read event_date
   once using the captured session client, event ID, and organization ID.
   Query failure must return 503 before streaming. Preserve all prior columns,
   authorization, filters, escaping, and streaming semantics.
   Validate: `pnpm --filter web exec vitest run 'app/(admin)/registrations/export/route.test.ts' lib/csv.test.ts`.
2. Validate the affected admin app and shared contracts:
   `pnpm --filter web test`, `pnpm --filter web typecheck`,
   `pnpm exec vitest run packages/shared`, and an isolated admin
   build using CI placeholder Supabase settings. Do not build in the shared
   checkout or touch another task's Docker/Supabase stack.
3. Review the full changed files using `skills:piv-review-changes`. Write review
   and implementation reports. Update this plan and the roadmap status.

## Acceptance and edge cases

- Exact eight headers and matching values from each participant snapshot.
- Multiword names remain intact; no guessed names for legacy entries.
- Missing/null/non-string values stay blank; no `[object Object]` or `undefined`.
- Age before/on/after birthday, leap day, same-day birth, invalid/future dates,
  missing race date, and a different export date.
- Group participants retain distinct snapshots and existing payment allocations.
- New strings retain comma/quote/newline escaping and formula protection.
- Event date is fetched once and scoped to event and org; failure gives 503.
- Existing filter, pagination, no-event, and request-client tests still pass.

## Scope and assumptions

Keep existing export information because the owner asked to include fields.
No UI composition, database, or provider changes. No commit, push, PR, or deployment
was requested for the CSV work. Browser testing is unnecessary for this route-only
change because request/response tests consume the actual streamed CSV in process.

## Completion evidence

- All three tasks completed. No application changes outside the export route and tests.
- Focused route/CSV checks: 2 files, 59 tests passed.
- Full admin checks: 131 files, 1,107 tests passed (baseline 1,089).
- Shared contract/release unit checks: 12 files, 190 tests passed.
- Admin typecheck and production build passed using CI placeholder settings.
- `git diff --check` passed. Self-review found no technical issues.
- [Implementation report](../../.claude/reports/registration-csv-fields-report.md).
- [Review](../../.claude/code-reviews/2026-11-10-registration-csv-fields.md).
- No browser or hosted acceptance performed; no release requested. Full integrated
  CI remains a pre-merge gate; report paths conservatively select all CI scopes.

## Release request — 2026-11-10

The owner requested commit and delivery to staging and production. Use a feature
pull request into main, required CI, and the active staged release controller.
Hosted staging acceptance and protected production approval remain required.
