# Fieldnotes admin workspaces

Status: owner-approved local implementation; staging release requested, 2026-09-25.

## Scope

Apply the selected Fieldnotes admin treatment to Dashboard, Registrations, Payments, Race kits, Check-in, Team, and Settings. The existing Events directory remains the visual reference. This pass changes presentation only. Existing queries, route guards, event scope, check-in, kit release, exports, forms, and payment actions keep their current behavior.

Owner annotation pass: the admin canvas defaults to white across routes. Settings offers White, White-gray, and Fieldnotes choices stored in this browser only; the choice does not change organization data or dark mode. Check-in uses one search field per roster and a collapsed safeguards disclosure. Dashboard shows capped-race capacity with exact filled and open place counts. The matching interactive component examples live in the canonical Storybook admin workspace stories.

Settings placement refinement: put Workspace background beneath the left Organization navigation card. Keep it visible after the identity preview and before forms on narrow screens. No preference or organization data model changes.

## Visual contract

- Forest ink and action green sit on the default white canvas. White-gray and `#F5F5ED` Fieldnotes canvases are optional browser preferences. Muted green rows help scanning without adding visual noise.
- San Francisco system typography is used for dense admin controls and headings. Numbers keep tabular alignment. The runner's New York editorial typography is not used for financial tables.
- Each page gets a small location eyebrow, clear heading, compact data surfaces, visible focus, restrained hover feedback, and a dark token mapping.
- Wide tables scroll inside a named region. The page itself must fit a 390px phone viewport. Motion is removed for people who request reduced motion.
- Race-day controls remain direct. The check-in station's scanner state and the kit desk's release actions are not hidden behind decorative panels.

## Canonical source and integration

The editable source is `storybook-hub/projects/race-pace/src/pilots/admin-workspaces.css`, with seven page contexts and three annotation follow-up stories in `admin-workspaces.stories.tsx`. The application copy is `apps/web/app/(admin)/fieldnotes-workspaces.css`, scoped to `.fieldnotes-admin-workspace`. The copy and canonical stylesheet share SHA-256 `113ac80cf24c466b30fe04da79227f3bec9fe0c2c64c9717c91d480ebe65a7bd` at this local checkpoint. The route wrappers supply the page label. The admin layout imports the stylesheet once.

The Storybook examples use illustrative data. Local application review used Supabase through the Docker stack. This presentation change adds no migration, Edge Function, or provider configuration.

## Review criteria

Review all seven signed-in pages at desktop and phone widths. Check light and dark mode, focus, table scrolling, search/filter controls, empty states, kit desk, scanner, and Settings form visibility. Validate the application typecheck and admin tests, and build the local Storybook catalog before release planning.
