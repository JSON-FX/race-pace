# Implementation Report — Fieldnotes runner event search

**Plan**: `docs/plans/2026-09-25-fieldnotes-event-pilot.md`
**Branch**: `codex/fieldnotes-event-pilot`
**Status**: COMPLETE (local pilot)

## Summary

The runner event list now has a labeled search field above its existing filters. The shareable `q` URL parameter matches race names, organizers, and places. Search composes with distance, terrain, and province filters; Clear search preserves them.

## Tasks completed

- Updated the pure filter contract in `apps/site/lib/eventFilters.ts`.
- Added search and an empty state to `apps/site/app/events/`.
- Updated the canonical runner layout and interactive story in Storybook Hub, then synced the application stylesheet.
- Updated the pilot spec, implementation plan, and launch progress record.

## Tests added

`apps/site/lib/__tests__/eventFilters.test.ts` covers parsing, URL round trips, blank terms, name and place matching, case handling, and filter composition. Focused suite: 31 passed.

## Validation results

- Runner typecheck, production build, and 466 runner tests passed. Admin typecheck, production build, and 911 tests passed. The backend/shared suite passed 758 tests after starting local Edge Functions with fake-provider settings.
- Hub typecheck and build passed; local Docker catalog rebuilt.
- Browser review found one Dulang-Dulang result, a working no-match state, and clear search retaining terrain.
- At 375px, the local runner document had no horizontal overflow.
- Hub and app runner CSS both hash to `04b33dabf2a21ec6ecd0d977fcbebf95aaa75b11069a7c58b170dcdd3e2dbfda`.

## Deviations from the plan

The search extension was added to the existing event pilot plan because it expands the same runner workflow before staging integration.

## Issues encountered

None. The application and Hub changes remain local and uncommitted; staging verification and owner acceptance remain open.
