# Fieldnotes event workflow pilot

Status: local implementation for review. Fieldnotes is the selected Race Pace direction. This pilot covers the public runner `/events` list and the admin `/events` directory only.

## Design contract

- Use the forest green, warm canvas, surface, line, and status roles in the Storybook Hub `projects/race-pace/DESIGN.md`.
- Use New York or a system serif fallback for public editorial headings and race names. Use the Apple system interface stack for filters, body text, controls, and all admin content. Use SF Mono or a system monospace fallback for card indexes and distances.
- Show race photography, name, date, location, distance, and any exceptional availability status together. Keep the race link visible without a hover.
- Place a labeled race search above the runner filter chips. Match race names, organizers, and places without replacing the existing distance, terrain, and province URL filters. Keep the combined result shareable and give search its own clear action.
- Keep admin information compact, searchable, sortable, filterable, and horizontally scrollable within the table region on phones.
- Preserve the existing data queries, URL filter contract, row navigation, column controls, edit menu, cancel and reschedule actions, error state, capability checks, and organization scope.
- Keep styles scoped to the two pilot routes. Existing home and race rail cards stay unchanged.
- Support light and dark surfaces, visible keyboard focus, reduced motion, and phone/tablet/desktop layouts.

## Source sync

The separate Storybook Hub at `/Users/jsonse/Documents/development/storybook-hub` is the design source of truth. This application branch began from `origin/staging` at `e123585`; the approved event workflow contexts are pinned at Hub commit `96dba8aba9c39588ea863240e4a24ffd70dc42cd`. The following stylesheet pairs must stay byte-identical when the design is updated:

| Canonical Hub source | Application copy | SHA-256 |
| --- | --- | --- |
| `projects/race-pace/src/pilots/runner-events.css` | `apps/site/app/events/fieldnotes.css` | `04b33dabf2a21ec6ecd0d977fcbebf95aaa75b11069a7c58b170dcdd3e2dbfda` |
| `projects/race-pace/src/pilots/admin-events.css` | `apps/web/app/(admin)/events/fieldnotes.css` | `e5738adba0598aaec25b4ee7f6429b6059d39b0c073d1658699912f614155a5c` |

Storybook's event workflow story demonstrates illustrative content. It is not a copy of production data or application behavior. The application adapters remain responsible for live queries, permissions, navigation, and actions.

The proposed runner event detail treatment was canceled before this staging release. No application or Storybook change for `/events/[id]` is included.
