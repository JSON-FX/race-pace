# Implement the approved Reservations page

## Scope and settled decisions

Implement the approved four-card, eight-column prototype. One row per checkout is confirmed. Existing organization permissions, payment ledger, participant categories, and deadlines remain the data boundary. UI actions only read data. The earlier UI refinements and category fees remain separate scoped commits, combined for the owner-authorized production release.

## Context

Read the prototype and its brief/review, `lib/queries/reservation-payments.ts`, `registrations/reservation-section.tsx`, `components/EventCombobox.tsx`, `lib/queries/roles.ts`, and `lib/nav-items.ts`. These settle identity, RLS, selected organization, official picker behavior, and shared navigation. No architecture question remains open.

## Tasks in order

1. CREATE typed reservations query. Page through event-scoped headers in batches of 100 with nested places/payment, then deduplicate profile reads. Compute event-wide totals once. Category extensions override older participant deadlines. VALIDATE: admin typecheck. Satisfies identity, complete totals, grouping, and scope.
2. CREATE page, client roster/picker, scoped CSS, loading and error states. Adapt the approved composition to real rows, avatars, dates, money, and existing shell. Search and payment filters leave summary totals unchanged. VALIDATE: admin typecheck and production build. Satisfies all visual and interaction requirements.
3. UPDATE shared nav/title, event/payment links, legacy redirect, and Registrations composition. Update existing tests that explicitly expected the removed embedded roster. VALIDATE: admin typecheck. Satisfies discoverability and compatibility.
4. REVIEW scoped source and actual app desktop/phone reads. Refresh implementation report and roadmap. VALIDATE: diff check and Fieldnotes audit. Satisfies approved composition and data isolation.
5. COMMIT scoped feature. Combine this session's completed commits into an isolated release worktree, inspect the full release diff, and deliver both applications. GitHub enforces staging as the production PR source; promote that route and sync main into staging afterward.

## Validation and deviations

The owner requested urgent production delivery and explicitly waived additional test runs. Do not run new exhaustive local suites. Compilation, actual UI readback, source review, and required GitHub branch checks still establish build and release evidence. Existing test assertions must match the intentional removal. No hosted payment or synthetic production record may be created. Production completion requires exact revision, Ready deployment IDs, aliases, and readback; a push alone is insufficient.

## Risks and acceptance

Large event rosters need multiple bounded reads; never stop at a database default limit or present partial totals. All event choices must belong to the active organization, including for super admins. Expired/cancelled historical holds must not count as awaiting payment. Legacy records may lack category data. Use honest fallbacks. Profile lookup failure must fail the page rather than silently erase identities. Finish when all eight fields and four scoped summaries work, the earlier changes are included, both production deployments serve the release, and staging contains main.

## Local completion

Steps 1–4 are implemented. Admin typecheck and isolated production build passed. Fieldnotes audit passed with 324 modules, 256 audited, zero native sites and duplicate primitives. Actual local Browser readback covered desktop/phone roster, complete paid amount/date, no-match filtering without summary changes, and semantic dark correction. Fresh finish reviewer scored its single correction resolved; implementation report records scope and remaining release evidence. Additional local tests remain waived.
