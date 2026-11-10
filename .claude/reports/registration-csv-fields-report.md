# Implementation Report — Registration CSV participant fields

**Plan**: `docs/plans/2026-11-10-registration-csv-fields.md`  
**Branch**: `codex/registration-csv-fields`  
**Base**: `f49f9782246720f7f95cf997f1c1431e9c82dfc4` (`origin/main`)  
**Status**: COMPLETE locally; owner requested commit and release on 2026-11-10.

## Summary

The registration CSV includes First Name, Last Name, Gender, Age, Birthday,
Category, Shirt Size, and Team Name together after Email. Existing identity,
payment, discount, and reference columns remain. Individual snapshots supply
participant fields without guessing historical names or reading the booker's
current passport. Birthday uses ISO date format. The owner selected completed
years on race day; missing or invalid dates leave Age blank.

## Tasks completed

- Updated the export route with six new columns, defensive snapshot/date handling,
  and one caller-scoped event date lookup before streaming.
- Extended the existing route tests and retained batch, filter, request-lifetime,
  email, CSV protection, and payment allocation assertions.
- Added the specification, completed plan, roadmap entry, and review report.

## Validation results

- Baseline: admin 131 files / 1,089 tests passed.
- Focused route/CSV tests: 2 files / 59 tests passed.
- Final admin suite: 131 files / 1,107 tests passed, including distinct grouped
  participants, age boundaries, leap years, malformed data, query failure,
  organization scoping, and new field escaping.
- Shared contract/release unit checks: 12 files / 190 tests passed.
- Admin typecheck: passed.
- Isolated admin production build: passed with CI placeholder Supabase settings.
- `git diff --check`: passed.
- Self-review: no technical issues detected.
- Existing jsdom navigation warnings appeared in the passing baseline and final
  suites. Build emitted non-blocking workspace-root/cache warnings.

## Deviations and release policy

No implementation deviations. Initial shared-checkout rules described the retired
staging integration model. Read-only checks verified `OPTION_B_ENABLED=true` and
successful release workflow run `41488665975` for current main. The current owning
AGENTS.md and Option B runbook therefore require new work from main. No branch
reconciliation was required or performed. No remote branches or hosted services
were changed; unrelated shared-checkout work was preserved.

## Limits

No browser or hosted acceptance was performed. The actual GET handler and streamed
response were tested in process; no screen or browser interaction changed. Admin and shared unit checks ran locally. Backend,
runner, and mobile suites did not run. Full integrated CI remains a pre-merge gate;
the report paths conservatively select all CI scopes. Historical entries without separate name snapshots
export blank name cells rather than guessing from the full name.
