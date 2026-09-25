# Public organizer discovery: Trail Atlas

Status: implemented locally for visual review on 2026-09-25. The selected Trail Atlas HTML proposal remains the visual reference; its example organizers and events are illustrative.

## Public experience

- `/organizers` shows a searchable, region-led directory. The page heading covers the Philippines, while the result heading reflects the selected region.
- Region choices are derived from non-empty organization Home Base regions. An organizer without a region stays in All regions.
- `/organizers/[slug]` shows the split cover and identity hero, optional About and Home Base facts, upcoming event count, race types, and white event cards with capacity state.
- The desktop and guest mobile header, signed-in mobile tab bar, and footer link to the directory.
- Missing description, home base, logo, cover, or events never produces invented organization content. Images that fail to load show a neutral Race Pace placeholder.

## Data and visibility

Organization name, slug, description, Home Base, logo, and cover come from the existing organization-admin Settings record. Events, disciplines, dates, distances, registration status, and remaining capacity come from the existing event and category records. No organizer event count or race type is manually edited.

All active organizations appear in the directory, including existing records with null profile fields or no future events. Organizers with upcoming events sort first. Upcoming events are future or same-day events with an explicit public status (`open`, `almost_full`, or `closed`). The upcoming count and cards share that exact set. Race types are derived from public events, including completed events. Row-level security remains the final read boundary; the page applies its own explicit filters because an authorized admin may see more rows than a public visitor.

Descriptions and location remain nullable in production. No database migration or production data change is needed for this page.

## Review boundary

The implementation runs in an isolated worktree from `origin/staging`. It has not been merged, deployed to staging, or deployed to production. Review the local page at phone and desktop widths before a staging pull request. The Storybook Hub can adopt the new `RegionIndex`, `OrganizerDirectoryRow`, `OrganizerProfileSplitHero`, and `OrganizerEventRow` patterns after this application review.
