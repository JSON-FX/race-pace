# Settings Brand Studio design

Status: approved for implementation on 2026-09-22.

## Goal

Turn the admin organization settings page into a clear brand studio without changing what the page saves.
Organization admins keep the existing profile, check-in, branding, waiver publishing, event assignment, and version-history workflows.

## Approved direction

The page opens with a public identity preview using the saved cover, logo, and organization name.
A compact section rail keeps Profile, Branding, Event check-in, and Organizer waiver easy to reach on desktop.
Profile and check-in share the first row on wide screens, while Branding and Organizer waiver use the full content width.
The rail disappears on smaller screens and every section becomes a single-column flow.

The visual treatment uses the admin console's semantic tokens for surfaces, borders, text, status, focus, and elevation.
No feature-specific palette or global theme change is introduced.

## Searchable selection

Event and waiver selection use one shared searchable combobox.
It composes the existing Shadcn Popover and Command primitives and submits through a hidden form value.
Each option can provide a label, supporting description, search keywords, and an optional badge.
The component supports keyboard search and selection, focus management, disabled state, empty state, and accessible combobox semantics.

## Behavior retained

- The page remains restricted to users with `manage_org` and an active organization scope.
- Only organization admins can change settings or publish waivers.
- Image uploads keep the existing crop, upload, save, toast, and refresh flow.
- Published waivers remain immutable and preserve their existing version identifiers.
- Event waiver assignment continues to submit the existing `eventId` and `waiverId` fields.
- Existing acceptances retain their original waiver version.

## Responsive and accessibility requirements

- Controls provide visible focus states through the existing `ring` token.
- The combobox search receives focus when its popover opens.
- Labels, descriptions, errors, status messages, and required state remain programmatically associated.
- Touch targets remain at least 40 pixels tall.
- The layout works from 320 pixels through desktop widths without horizontal page scrolling.
- Motion comes only from existing Popover behavior and respects the application's current reduced-motion handling.

## Non-goals

- No database, Supabase, permission, storage, or Server Action contract changes.
- No new organization fields or event metadata.
- No release, deployment, or hosted-environment changes in this implementation branch.
