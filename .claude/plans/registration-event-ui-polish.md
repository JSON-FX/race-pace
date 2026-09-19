# Feature: Registration and event UI polish

## Feature Description

Replace two raw-link registration surfaces with responsive Race Pace interfaces and correct the event gallery copy so organizer-uploaded images describe an upcoming event.

## User Story

As a runner, I want clear participant and assisted-registration choices so that I can register myself or someone I manage without guessing what each link does.

## Problem Statement

The participant picker and event-page assisted-registration block render as unstyled links. The gallery heading also describes every organizer upload as content from last year, even when the images are posters or previews for an upcoming event.

## Solution Statement

Use the site's existing green, forest, card, border, typography, icon and spacing tokens. Present participant choices as accessible cards, add a responsive assisted-registration section to the event dossier, and relabel the gallery as organizer-provided event content.

## Out of Scope / Non-Goals

- Do not change registration, Passport, waiver, checkout or payment behavior.
- Do not enable group checkout or alter its feature flag.
- Do not change event image storage or admin uploads.
- Do not add dependencies or new design tokens.

## Feature Metadata

**Feature Type**: UI enhancement and copy correction
**Estimated Complexity**: Low
**Primary Systems Affected**: `apps/site` registration and event pages
**Dependencies**: Existing Next.js, Tailwind, Lucide and Race Pace tokens

## CONTEXT REFERENCES

### Relevant Codebase Files

- `apps/site/app/register/[categoryId]/page.tsx:45-57` - Current participant chooser and existing data boundary.
- `apps/site/app/events/[id]/page.tsx:60-73` - Current raw assisted-registration block.
- `apps/site/components/event/EventPageBody.tsx:225-295` - Event dossier section order and discipline tone.
- `apps/site/components/event/sections.tsx:190-260` - Gallery implementation and reusable `Section` pattern.
- `apps/site/app/register/__tests__/page.test.tsx` - Registration route test conventions.
- `apps/site/components/event/__tests__/event-page-body.test.tsx:284-303` - Event section test conventions.
- `apps/site/app/globals.css` - Race Pace semantic tokens and typography utilities.

### New Files to Create

- `apps/site/app/register/[categoryId]/ParticipantPicker.tsx` - Participant selection UI.
- `apps/site/app/register/[categoryId]/__tests__/ParticipantPicker.test.tsx` - Participant picker behavior and links.

### Patterns to Follow

- Use existing semantic utilities such as `bg-card`, `bg-secondary`, `text-primary`, `border-border`, `font-display`, `font-eyebrow` and `font-mono-race`.
- Use Lucide icons with `aria-hidden` when labels already convey meaning.
- Keep controls at least 44px high and preserve visible focus rings.
- Build mobile-first grids that become two columns at `sm` or `md` breakpoints.
- Keep the event page's trail and road tones through the existing `Tone` contract.

## IMPLEMENTATION PLAN

### Phase 1: Participant picker

- Extract the participant-selection branch into `ParticipantPicker`.
- Add event and category context, responsive participant cards, empty state, group-checkout callout and secondary account actions.
- Preserve every existing URL and participant eligibility rule.

### Phase 2: Event page registration and gallery

- Add a reusable, tone-aware assisted-registration section to `sections.tsx`.
- Render it from `EventPageBody` only for open events with a waiver and categories.
- Remove the raw block from the route page.
- Rename gallery copy to `From the organizer` / `Event gallery` and describe slides as event images.

### Phase 3: Tests and responsive validation

- Test self, managed, group, profile and booking links in `ParticipantPicker`.
- Test assisted-registration visibility and category links in `EventPageBody`.
- Test new gallery copy and removal of the old label.
- Run site tests, typecheck, production build and browser checks at desktop and 375px widths.

## STEP-BY-STEP TASKS

### CREATE `ParticipantPicker.tsx`

- **IMPLEMENT**: Token-driven responsive selection interface with semantic list/cards and clear secondary actions.
- **PATTERN**: `apps/site/components/event/sections.tsx:20-55` and `apps/site/components/landing/OrganizerSignup.tsx`.
- **GOTCHA**: Preserve the existing eligibility filter and URLs exactly.
- **VALIDATE**: `pnpm --filter site exec vitest run 'app/register/[categoryId]/__tests__/ParticipantPicker.test.tsx'`
- **SATISFIES**: Participant picker UI and responsive behavior.

### UPDATE registration and event pages

- **IMPLEMENT**: Use `ParticipantPicker`; move assisted registration into the event body.
- **PATTERN**: Existing `EventPageBody` section sequence and `Tone` styling.
- **GOTCHA**: Assisted registration remains available when the signed-in runner already has an entry because they may book for another Passport.
- **VALIDATE**: `pnpm --filter site typecheck`
- **SATISFIES**: Both previously raw surfaces use the site design system.

### UPDATE gallery copy and tests

- **IMPLEMENT**: Neutral upcoming-event gallery label, event-image alt text and focused assertions.
- **VALIDATE**: `pnpm --filter site test`
- **SATISFIES**: Organizer uploads are no longer described as last-year course photos.

## VALIDATION COMMANDS

```bash
pnpm --filter site test
pnpm --filter site typecheck
pnpm --filter site build
git diff --check
```

Manual browser checks:

- Participant picker at desktop and 375px width.
- Event page at desktop and 375px width.
- Keyboard focus and 44px touch targets.
- No horizontal overflow.

## ACCEPTANCE CRITERIA

- [x] Participant selection is a polished, responsive Race Pace UI.
- [x] Self and managed participants remain selectable through their existing URLs.
- [x] Profile, bookings and optional group checkout actions remain available.
- [x] Event assisted registration is visually integrated with trail and road pages.
- [x] Category choices remain reachable and usable on mobile.
- [x] Gallery reads `From the organizer` / `Event gallery`; old copy is removed.
- [x] Focused and full validations pass.

## OPEN QUESTIONS / ASSUMPTIONS

No open questions. The request and existing contracts settle the scope. The current green tokens, Archivo typography, Lucide icon set and registration URLs are retained.

## AMENDMENTS

- None.
