# Implementation Report — Trail Atlas organizers

**Plan**: `docs/plans/2026-09-25-trail-atlas-organizers.md`
**Branch/worktree**: isolated worktree from `origin/staging`
**Status**: COMPLETE for local visual review; no staging or production release

## Summary

The runner site has a Trail Atlas organizer directory and public organizer profiles. Directory search and region filters derive from live organization data. Profiles show admin-maintained description and Home Base values when present, plus event counts, race types, dates, and capacity derived from public event records. Desktop and mobile navigation and the footer link to the directory.

## Tasks completed

- Added a typed public read model with explicit active organization and published-event filters in `apps/site/lib/organizers.ts`.
- Added reusable directory row, split hero, image fallback, and event row components under `apps/site/components/organizers/`.
- Added `/organizers` and `/organizers/[slug]`, with scoped Trail Atlas styling.
- Added Organizers links to `SiteNav`, `RunnerTabBar`, and `SiteFooter`.
- Added the design contract and updated the roadmap and launch ledger.

## Tests added and validation

- New data and directory tests cover nullable fields, dynamic regions, search, event capacity, discipline labels, and Philippine date boundaries.
- Existing navigation and footer tests now assert organizer links.
- `pnpm --filter site typecheck`: passed.
- `pnpm --filter site test`: 473/473 passed across 63 files.
- `pnpm --filter site build`: passed; both organizer routes are dynamic.
- Local production build: `/organizers` and `/organizers/runwithpoint` returned HTTP 200. The browser showed organizer data, eight event cards on the sampled profile, slot labels, and working search. Desktop and 320px layouts were reviewed; the 320px page had no horizontal overflow.
- `git diff --check`: passed.

## Deviations from plan

The local database contains many bare test organizations. The directory keeps them visible because existing production organizers may also have null optional fields. Organizers with upcoming events sort first so those with active calendars remain easy to find.

The local event image reference for one organizer points to a missing Storage object. Image load failures now show a neutral Race Pace placeholder, without inventing an organizer image.

## Issues and release boundary

No known code blocker. Some existing local organizers have no Home Base, so the region index currently shows only All regions. The choices appear as organization admins fill their locations. Storybook catalog adoption follows application visual acceptance. No hosted service or production data changed.
