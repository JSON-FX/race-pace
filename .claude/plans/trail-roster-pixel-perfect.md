# Feature: Pixel-perfect Trail Roster registration

## Feature Description

Translate the approved `docs/previews/group-checkout-five-options.html` Trail Roster concept into the live group-registration flow. Preserve every existing reservation, category-capacity, waiver, add-on, draft, and QR-ticket behavior while matching the selected wide roster, event hero, participant rows, combined-booking summary, and responsive breakpoints.

## User Story

As a runner managing several Race Passports, I want the approved Trail Roster interface to work exactly as proposed so that I can select attendees, assign each category, complete their details, and reserve one combined booking confidently.

## Problem Statement

Production contains the Trail Roster interaction model but not its approved composition. The live page is a narrow stack of generic cards, while the proposal uses a 1160px shell, forest hero, two-column roster and sticky live summary.

## Solution Statement

Implement a two-step client flow. Step one mirrors the approved roster and combined-booking summary. Step two progressively reveals the existing participant details and waiver forms, then reserves the same group order through the unchanged service contract.

## Out of Scope / Non-Goals

- Do not change reservation, payment, refund, delivery, database, or Edge Function contracts.
- Do not change the already-approved Trail Ledger payment page.
- Do not add new dependencies or replace existing ShadCN controls.
- Do not promote or deploy this branch without a separate release request.

## Feature Metadata

**Feature Type**: Enhancement
**Estimated Complexity**: Medium
**Primary Systems Affected**: Runner group registration UI and tests
**Dependencies**: Existing ShadCN `Button`, `Card`, `Checkbox`, `Select`, and Race Pace design tokens

## CONTEXT REFERENCES

### Relevant Codebase Files

- `apps/site/app/register/[categoryId]/GroupRegister.tsx` - Owns selection, participant forms, drafts, validation, and reservation.
- `apps/site/components/registration/TrailRosterParticipantSelector.tsx` - Owns Passport rows and per-runner category selection.
- `apps/site/app/register/[categoryId]/__tests__/GroupRegister.test.tsx` - Reservation and mixed-category behavior.
- `apps/site/components/__tests__/trail-roster-participant-selector.test.tsx` - Row selection and capacity behavior.
- `apps/site/app/globals.css` - Existing Race Pace forest and primary color tokens.
- `/Users/jsonse/Documents/development/race-pace/docs/previews/group-checkout-five-options.html` - Approved Trail Roster visual source.

### New Files to Create

- `docs/specs/trail-roster-layout.md` - Durable implementation contract for the approved prototype.

### Patterns to Follow

- Keep all client state in `GroupRegister`; presentation components receive typed data and callbacks.
- Continue using ShadCN controls for keyboard behavior and accessible state.
- Use mobile-first Tailwind utilities and existing semantic color tokens.
- Keep prices in integer centavos and render through `formatPeso`.

## IMPLEMENTATION PLAN

### Phase 1: Durable design contract

- Record that accepted prototypes are implementation specifications covering visual composition, breakpoints, states, and functionality.
- Add a Trail Roster specification with exact desktop and mobile behavior.

### Phase 2: Pixel-faithful roster

- Restyle Passport rows to the approved 44/46/flexible/190 desktop grid.
- Add initials avatars, selected status, capacity-aware ShadCN category controls, disabled and incomplete states.
- Build the 1160px page shell, forest hero, event card, roster surface, and sticky combined-booking summary.

### Phase 3: Functional progression

- Add roster and participant-details steps without changing persisted booking data.
- Make the summary continue action advance to details.
- Preserve all existing waiver, add-on, validation, error, reservation, and redirect behavior.

### Phase 4: Responsive and regression validation

- Update component tests for the progressive flow and live summary.
- Test 375px, 768px, 1024px, and desktop composition with no horizontal overflow.
- Run focused tests, the complete runner suite, typecheck, and production build.

## STEP-BY-STEP TASKS

### UPDATE `AGENTS.md`

- **IMPLEMENT**: Persist the accepted-prototype implementation contract.
- **VALIDATE**: `git diff --check`

### CREATE `docs/specs/trail-roster-layout.md`

- **IMPLEMENT**: Record exact visual hierarchy, responsive breakpoints, interaction states, and functional invariants.
- **VALIDATE**: `git diff --check`

### UPDATE `apps/site/components/registration/TrailRosterParticipantSelector.tsx`

- **IMPLEMENT**: Match the selected runner-row layout with responsive category placement and initials avatars.
- **GOTCHA**: Keep ShadCN Select and Checkbox semantics and existing category-capacity calculations.
- **VALIDATE**: `pnpm --filter site exec vitest run components/__tests__/trail-roster-participant-selector.test.tsx`

### UPDATE `apps/site/app/register/[categoryId]/GroupRegister.tsx`

- **IMPLEMENT**: Add the hero, event card, two-column roster, live summary, progressive details step, and responsive layout.
- **GOTCHA**: Preserve draft storage, individual waiver acceptance, add-ons, validation, and reservation payloads.
- **VALIDATE**: `pnpm --filter site exec vitest run app/register/[categoryId]/__tests__/GroupRegister.test.tsx`

### UPDATE registration tests

- **IMPLEMENT**: Assert the proposed copy, summary lines, mixed categories, step transition, and final reservation.
- **VALIDATE**: `pnpm --filter site exec vitest run components/__tests__/trail-roster-participant-selector.test.tsx app/register/[categoryId]/__tests__/GroupRegister.test.tsx`

## TESTING STRATEGY

### Unit Tests

- Participant selection and removal.
- Category controls enable only for selected Passports.
- Initials and selected labels render.
- Live combined summary reflects names, categories, and prices.
- Continue moves from roster to participant details.
- Mixed-category reservation payload remains unchanged.

### Edge Cases

- No participants selected.
- Incomplete Passport.
- Category without remaining capacity.
- One participant versus multiple participants.
- Long event and participant names.
- Mobile stacking without horizontal overflow.

## VALIDATION COMMANDS

1. `git diff --check`
2. `pnpm --filter site exec vitest run components/__tests__/trail-roster-participant-selector.test.tsx app/register/[categoryId]/__tests__/GroupRegister.test.tsx`
3. `pnpm --filter site typecheck`
4. `pnpm --filter site test`
5. `pnpm --filter site build`

## ACCEPTANCE CRITERIA

- [x] Desktop matches the selected Trail Roster hero, roster, and sticky summary composition.
- [x] Mobile stacks rows and category controls without horizontal overflow.
- [x] Every selected participant can use a different category.
- [x] The summary updates immediately with participant, category, and entry price.
- [x] Existing details, waiver, add-on, reservation, and redirect behavior still works.
- [x] ShadCN controls remain keyboard and screen-reader accessible.
- [x] Focused tests, full runner tests, typecheck, and production build pass.
- [x] Repository guidance prevents future prototype approvals from being reduced to behavior-only implementations.

## OPEN QUESTIONS / ASSUMPTIONS

No open questions. The approved Trail Roster prototype is the visual source of truth. The existing backend and reservation behavior remain the functional source of truth.

## AMENDMENTS
