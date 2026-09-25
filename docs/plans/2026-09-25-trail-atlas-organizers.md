# Trail Atlas organizers implementation

Status: implemented locally for visual review. Selected design: Trail Atlas, including the annotated revisions.

## Goal

Give runners a public directory of active organizers and a profile for each organizer. Show only admin-maintained organization details and published future events. Add an Organizers destination to desktop, guest mobile, signed-in mobile, and the footer.

## Data contract

- Query active organizations using public row-level security. Keep organizations with missing optional profile fields or no future events visible.
- Derive region filters from non-empty `home_region_name` values. Never hard-code Mindanao or a fixed region list.
- Use nullable `description`, home city, province, region, logo, and banner fields from organization settings. Omit absent profile facts.
- Derive upcoming counts, race types, next event, dates, distances, and availability from future published events and their categories. Apply explicit public status filters even for a signed-in admin.
- Do not insert sample organizers or change production data.

## Steps and validation

1. Add a typed read model in `apps/site/lib/organizers.ts`, with pure mapping and filtering helpers. Validate with focused tests for null fields, regions, upcoming dates, and availability.
2. Build `/organizers` and `/organizers/[slug]` with the Trail Atlas directory, split hero, white event cards, search, region filters, and empty states. Validate with site typecheck and focused component tests.
3. Add Organizers to desktop and mobile navigation plus the footer. Validate keyboard navigation and narrow viewport layout.
4. Review the rendered page at desktop, tablet, and mobile widths against the selected HTML preview. Run site typecheck and site tests. Record the result and any deviations.

No production release is part of this implementation pass. Stage and production deployment follow the repository release workflow after visual acceptance.
