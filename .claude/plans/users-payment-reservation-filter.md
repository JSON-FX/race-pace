# Users payment amounts and reservation category filtering

## Scope and Acceptance

Fix payment displays in `/users` for all own and managed Passport registrations, using the actual captured participant amount. Preserve individual legacy payments and the full captured transaction in the account's Most recent payment summary.

Add a dynamic category dropdown to the `/reservations` roster. Options come from every category of the selected event. Match any participant in a checkout by category ID, combine with search and payment status, reset pagination on changes, and clear all three filters together. Keep checkout totals and event summary cards independent of filtering.

No open product questions remain: reuse the existing payment semantics and dropdown styling. For the investigated booking, paid participant cards show ₱1,743.59 each; the account transaction summary shows ₱3,487.18.

## Context

- Root AGENTS.md and docs/operations/release-workflow.md govern ordinary delivery.
- User explicitly requested a production-first release on October 1, 2026, followed by staging synchronization.
- GitHub main protection requires a pull request and `web-admin-validate`. The workflow rejects main pull requests whose source is not staging. Release the reviewed feature revision directly through Vercel production and deploy only platform-users to production. Then integrate through feature-to-staging and staging-to-main pull requests without changing protection rules.
- Production base: `f2f1b3e662b637d192471bdb44320831dad75fc6`.
- Isolated worktree: users-payment-reservation-filter; branch: codex/users-payment-reservation-filter.
- Prior investigation: docs/issues/issue-users-group-payment-display.md in the shared checkout.
- supabase/functions/platform-users/index.ts: paid group attempts currently repeat gross_cents on every registration.
- supabase/migrations/20260916193919_group_financial_reporting.sql: participant reports use capture allocations.
- apps/web/lib/queries/reservations.ts: complete event categories are already provided; add category IDs to reservation rows.
- apps/web/app/(admin)/reservations/reservations-workspace.tsx: reuse the existing shadcn Select, local filters, pagination, and wrapping toolbar.
- apps/web/app/(admin)/reservations/page.tsx: organization/event key resets workspace state.
- Supabase select reference: https://supabase.com/docs/reference/javascript/select (JSON field aliases and embedded relations).

## Implementation Tasks

1. Update group attempt reads to include fulfilled capture amounts and participant allocations. Map per-registration payment amounts from allocation gross_cents. Select a fulfilled capture rather than an arbitrary rejected capture. Preserve legacy paid/refunded values and zero-value captures. Account transaction summaries use the full captured amount. Missing allocations must not fall back to an order total.
   - Files: supabase/functions/platform-users/index.ts and supabase/functions/platform-users/index.test.ts.
   - Validate: pnpm exec vitest run supabase/functions/platform-users/index.test.ts supabase/functions/_shared/platformUsers.test.ts.
2. Add category_id to reservation Place reads and categoryIds to ReservationRow. Add a category Select populated from event categories. Compose the category predicate with search/status and preserve group checkout amounts.
   - Files: apps/web/lib/queries/reservations.ts, its new test, apps/web/app/(admin)/reservations/reservations-workspace.tsx, and its new test.
   - Independent of task 1; parallel implementation uses separate file ownership.
   - Validate: pnpm --filter web exec vitest run lib/queries/reservations.test.ts 'app/(admin)/reservations/reservations-workspace.test.tsx'.
3. Add a /users rendered regression proving unequal participant paid amounts and a separate full transaction summary.
   - Validate: pnpm --filter web exec vitest run 'app/(admin)/users/users-directory.test.tsx'.
4. Run PIV validation and review on the complete scoped diff. Review payment/security boundaries without modifying the money ledger, schema, providers, or unrelated code.
5. Commit and push the scoped branch. Release through an authorized route that GitHub permits, verify exact deployed source/function and live reads, then synchronize staging as requested. Record actual release evidence in docs/operations/launch-progress.md.

## Validation

- Frozen dependency install.
- Local Supabase migration replay and scripts/ci-assert-local.mjs.
- Both Next app typechecks, tests, and isolated worktree builds; root database/function/shared tests.
- Primary Browser UI verification for category filtering and user cards, including desktop/tablet/mobile toolbar layout.
- Payment cases: legacy paid/refunded, equal and unequal group allocations, provider-added fees, zero-value free capture, rejected capture preceding fulfilled capture, missing participant allocation.
- Filter cases: categories with zero reservations, mixed-category groups, combined filters, pagination reset, clear filters, duplicate labels with different IDs.

## Release Limits

No production test payments or synthetic records. No branch-protection or workflow changes to bypass GitHub's enforced production-source restriction. The explicit production-first exception applies to this scoped release only. Production provider deployment precedes staging code integration and final Git synchronization.
