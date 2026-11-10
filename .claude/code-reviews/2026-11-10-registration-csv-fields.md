# Registration CSV participant fields review

Code review passed. No technical issues detected.

## Scope

Reviewed the complete export route and tests, specification, plan, roadmap update,
and implementation report against the PIV review checklist. Compared the diff
with base `f49f978` and traced snapshot producers, the registration query, CSV
helpers, organization resolution, and event date type.

Application diff: 2 modified files; 139 added lines and 12 removed lines.
Documentation: 1 modified file and 4 new artifacts (spec, plan, report, review).
No files deleted.

## Findings checked

- All eight participant headers align with their values; existing financial
  columns and grouped participant allocations remain present.
- Age uses completed calendar years at race date, independent of runtime timezone.
  Leap-day behavior, date validation, missing values, and zero age are covered.
- Participant data comes from per-registration snapshots. Historical missing
  fields do not fall back to another participant or a guessed name split.
- New text values use the shared CSV quoting and formula protection.
- The event date lookup reuses the caller's client and filters event and org IDs.
  It runs once before streaming; failures return 503 instead of a misleading CSV.
- No service-role client, migration, additional per-row query, or new dependency.
- Existing filters, stable pagination, streaming backpressure, and access guard
  remain unchanged.

## Evidence

Focused checks: 59 tests passed. Full admin suite: 1,107 tests passed. Admin
TypeScript checking, isolated production build, 190 shared contract/release unit
tests, and whitespace checks passed.
Hosted/browser acceptance was not performed and is not claimed.
