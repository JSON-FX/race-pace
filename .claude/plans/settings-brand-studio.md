# Feature: Settings Brand Studio

## Feature description

Redesign the admin organization settings page using the approved Brand Studio composition.
Preserve its current actions and permissions while introducing a reusable, form-aware searchable combobox.

## User story

As an organization admin, I want settings grouped around my public brand so that I can update identity, event defaults, and waiver policy confidently.

## Problem statement

The current page is a vertical stack with weak hierarchy, inconsistent field treatment, and two native selects that become difficult to scan as events and waiver versions grow.

## Solution statement

Add a live-data brand preview, desktop section rail, responsive card grid, and token-based section treatments.
Build a generic combobox from the existing Popover and Command primitives and submit its controlled value through the current form contracts.

## Out of scope / non-goals

- Do not change database tables, Supabase policies, uploads, or Server Actions.
- Do not add organization or event fields.
- Do not refactor the specialized race-day `EventCombobox`, whose deterministic search contract is intentionally different.
- Do not deploy or change hosted environments.

## Feature metadata

**Feature type**: UI enhancement and reusable component
**Complexity**: Medium
**Primary system**: `apps/web`
**Dependencies**: Existing `radix-ui`, `cmdk`, Lucide, Tailwind v4, and Shadcn primitives

## Context references

- `apps/web/app/(admin)/settings/page.tsx:10` - permission, organization scope, data loading, and page composition.
- `apps/web/app/(admin)/settings/settings-form.tsx:13` - profile, check-in, branding, and current Server Actions.
- `apps/web/app/(admin)/settings/waiver-form.tsx:9` - waiver publishing, native selectors, and immutable history.
- `apps/web/components/EventCombobox.tsx:10` - specialized event search whose deterministic behavior must stay unchanged.
- `apps/web/components/ui/command.tsx:16` - existing searchable list primitives.
- `apps/web/components/ui/popover.tsx:8` - existing accessible floating surface.
- `apps/web/app/globals.css:1` - semantic RGB token contract and light/dark themes.
- `docs/specs/2026-09-22-settings-brand-studio-design.md` - approved design requirements.

## New files

- `apps/web/components/ui/searchable-combobox.tsx`
- `apps/web/components/ui/searchable-combobox.test.tsx`
- `apps/web/app/(admin)/settings/settings-section.tsx`

## Implementation plan

### Phase 1: Shared selection foundation

Create a controlled generic combobox with option labels, descriptions, keywords, badges, disabled state, accessible names, and optional hidden form input.
Test opening, filtering, selection, form value updates, keyboard semantics supplied by Command, empty state, and disabled state.

### Phase 2: Brand Studio composition

Update the page header, real-data identity preview, desktop section rail, and responsive card grid.
Keep the existing permission and no-organization branches intact.

### Phase 3: Settings forms

Restyle the profile, check-in, branding, waiver publishing, event assignment, and version history sections.
Replace only the two waiver-assignment native selects with the shared combobox.

### Phase 4: Validation

Update focused tests for the approved labels and behavior.
Run focused tests, the full admin test suite, and `pnpm --filter web typecheck`.

## Step-by-step tasks

### CREATE `apps/web/components/ui/searchable-combobox.tsx`

- **IMPLEMENT**: Controlled Popover and Command combobox with optional form name.
- **PATTERN**: Compose `components/ui/popover.tsx` and `components/ui/command.tsx`.
- **GOTCHA**: Use existing semantic tokens and keep the specialized event search unchanged.
- **VALIDATE**: `pnpm --filter web exec vitest run components/ui/searchable-combobox.test.tsx`
- **SATISFIES**: Shared searchable selector requirement.

### UPDATE settings page composition

- **IMPLEMENT**: Identity hero, section rail, responsive grid, and admin-access context.
- **PATTERN**: Use existing card, badge, avatar, and `initials()` helpers.
- **GOTCHA**: Preserve `manage_org`, `requireOrgId`, and parallel query behavior.
- **VALIDATE**: `pnpm --filter web exec vitest run 'app/(admin)/settings/page.test.tsx'`
- **SATISFIES**: Approved Brand Studio structure.

### UPDATE settings forms

- **IMPLEMENT**: Token-based cards, refined upload presentation, checkbox treatment, searchable event and waiver fields, and clearer immutable history.
- **PATTERN**: Keep all existing action bindings and hidden identifiers.
- **GOTCHA**: `eventId` and `waiverId` must still reach `selectEventWaiverAction`.
- **VALIDATE**: `pnpm --filter web exec vitest run 'app/(admin)/settings/settings-form.test.tsx' 'app/(admin)/settings/waiver-form.test.tsx'`
- **SATISFIES**: Functional parity and approved interaction.

### UPDATE documentation and full validation

- **IMPLEMENT**: Link the approved spec and plan from the roadmap and record validation results.
- **VALIDATE**: `pnpm --filter web typecheck && pnpm --filter web test`
- **SATISFIES**: Repository documentation and quality gates.

## Testing strategy

Unit tests cover the generic combobox, form value submission, filtering, selection, permissions, publish-review reset, and existing action calls.
Page tests continue covering organization scope and authorization.
Manual browser validation covers light/dark appearance, responsive stacking, real Popover positioning, keyboard use, and upload dialogs.

## Acceptance criteria

- [x] Approved Brand Studio layout is implemented with existing tokens.
- [x] Searchable event and waiver Popovers replace native selects.
- [x] One generic shared combobox supports other pages.
- [x] Existing settings functionality and permissions remain unchanged.
- [x] Focus, filtering, empty state, selection, and hidden form values are tested.
- [x] Admin tests and TypeScript checks pass.

## Open questions / assumptions

No product questions remain. The approved prototype and current action contracts settle the implementation choices.

## Amendments

- The manual browser pass stopped at the existing Turnstile login gate. No authentication or bot-protection safeguard was bypassed for this UI-only change.
