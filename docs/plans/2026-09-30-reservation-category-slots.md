# Reservations category availability

Status: implemented, verified live in production, and deployed to staging; protected main alignment completed; final main-to-staging sync accompanies the release evidence.

## Requirement and design

Add a category summary between the four checkout summaries and the roster. Each category card shows total slots left, configured category capacity, general slots left, and reservation slots left. Preserve the approved flat Fieldnotes cards and responsive grid. Counts belong to the selected event and remain independent of roster filters.

## Existing contract

Reuse `category_availability(p_event)` from `20260929112000_category_public_availability.sql`. It uses the same capacity claims as admission, including active registrations, held reservation places, unreleased screening applications, and conversion de-duplication. Reservation availability already follows allocation and sales-window rules. Do not subtract checkout counts or `slots_taken` from category capacity.

The RPC publishes availability only for active organizations and coming-soon/open/almost-full events. Missing rows mean unavailable, not zero. Categories without reservations show “Not enabled”. Preserve the page's event membership check before reads, and filter category reads by both organization and event.

## Tasks

1. Add typed category read plus RPC mapping to `apps/web/lib/queries/reservations.ts`. Propagate query errors.
2. Load category availability alongside the event roster after membership validation in `reservations/page.tsx`.
3. Extend existing Card composition in `reservations-workspace.tsx`; add responsive styles in `reservations.css`.
4. Update the existing Reservations Storybook proposal with the same section, clearly illustrative fixtures and meaningful unavailable/disabled states.
5. Run app typecheck/build, source audit and bounded visual review. Owner's session waiver covers additional local test suites; enforced GitHub CI remains required.
6. Commit only this feature from isolated current-staging worktree. Promote through the technically enforced staging-to-main PR route, verify production reads, then merge main back into staging.

## Acceptance

- Total, general, and reservation availability exactly match the existing RPC.
- Managed group places and screening holds count correctly through the canonical ledger.
- Search/payment filters leave category cards unchanged.
- Organization/event changes clear or replace the cards with the matching data.
- Zero, unavailable, disabled reservations, no categories, long labels and phone widths remain clear.
- No migration, capacity mutation, provider change, synthetic production data or payment.

## Open questions

None. The user selected the existing page design and explicitly requested these cards and immediate release. Inherit the existing admission ledger, organization boundary, failure handling and release authorization.
