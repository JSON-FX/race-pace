# Public organizer discovery: Trail Atlas

Status: implemented locally for visual review on 2026-09-25. The selected Trail Atlas HTML proposal remains the visual reference; its example organizers and events are illustrative.

## Public experience

- `/organizers` shows a searchable, region-led directory. The page heading covers the Philippines, while the result heading reflects the selected region.
- Region choices are derived from non-empty organization Home Base regions. An organizer without a region stays in All regions.
- `/organizers/[slug]` shows the approved Open spread featured photograph and identity hero, optional About and Home Base facts, upcoming event count, race types, and white event cards with capacity state. Without a featured image, the hero uses a text-led layout.
- The desktop and guest mobile header, signed-in mobile tab bar, and footer link to the directory.
- Missing description, home base, logo, featured photograph, cover, or events never produces invented organization content. Images that fail to load show a neutral Race Pace placeholder.

## Data and visibility

Organization name, slug, description, Home Base, logo, cover, and optional featured photograph come from the organization-admin Settings record. Events, disciplines, dates, distances, registration status, and remaining capacity come from the existing event and category records. No organizer event count or race type is manually edited.

All active organizations appear in the directory, including existing records with null profile fields or no future events. Organizers with upcoming events sort first. Upcoming events are future or same-day events with an explicit public status (`open`, `almost_full`, or `closed`). The upcoming count and cards share that exact set. Race types are derived from public events, including completed events. Row-level security remains the final read boundary; the page applies its own explicit filters because an authorized admin may see more rows than a public visitor.

Descriptions, location, and featured photographs remain nullable in production. The featured photograph uses a separate additive column and never substitutes the cover photo in the profile hero.

## Review boundary

The Open spread follow-up runs in an isolated worktree from `origin/staging`. It requires staged validation before production promotion. The Storybook Hub can adopt the new `RegionIndex`, `OrganizerDirectoryRow`, `OrganizerProfileOpenSpread`, and `OrganizerEventRow` patterns after this application review.
