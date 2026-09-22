# Trail Roster layout implementation plan

## Objective

Implement the approved Trail Roster proposal in the live group-registration route without changing
the reservation, payment, refund, ticket, or delivery contracts.

## Work

1. Record the approved visual and responsive contract in `docs/specs/trail-roster-layout.md`.
2. Rebuild the first registration step as the 1160px forest hero, roster grid, and sticky summary.
3. Use existing ShadCN Checkbox, Select, Card, Badge, and Button components for real interactions.
4. Keep the participant details, add-ons, personal waivers, draft persistence, and reservation call
   as the second registration step.
5. Verify selection, mixed categories, capacity, the step transition, reservation payloads,
   responsive classes, type safety, and the complete runner test suite.

## Release boundary

This task is application-only. It adds no schema, Edge Function, payment-provider, or hosted setting
change. Staging and production deployment require a separate release action.

## Validation

- Focused Trail Roster and group-registration tests.
- Full runner test suite.
- Runner TypeScript check.
- Production build and responsive browser review before staging promotion.
