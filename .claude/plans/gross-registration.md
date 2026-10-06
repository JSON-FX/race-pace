# Feature: Gross Registration

## Contract

As an organizer, I want the selected event's total collected before fees and refunds, so I can distinguish original sales from retained proceeds. The owner selected option 1 on 2026-10-07. Search, status, category and pagination do not change this card. Existing cards retain their filtered behavior.

## Approach and scope

Add an event-only SQL aggregate over `admin_registrations_v.payment_amount`, including paid, partially_refunded and refunded. That existing security-invoker view uses participant allocations for groups and legacy captured amounts for individual registrations. Do not add retained gross and refunds: fully refunded rows can retain nonrefundable fees. Do not download/paginate money rows. No payment, refund, provider, function bundle or existing migration changes.

Use `security invoker`, an empty search path and explicit authenticated/service-role grants after PUBLIC/anon revocation. Preserve tenant RLS; require `auth_can_admin_org(v.org_id)` so runners cannot read even a personal subset through this admin total. New rows are summed as bigint cents in a single statement.

## Mandatory references

- `apps/web/app/(admin)/registrations/kpi-section.tsx:14`: existing async section and card style.
- `apps/web/app/(admin)/registrations/page.tsx:168`: suspended card row and event resolution.
- `apps/web/components/kpi-card.tsx:62`: existing responsive grid and skeleton.
- `apps/web/lib/queries/registrations.ts:287`: aggregate reader/error handling.
- `supabase/migrations/20260930053856_organization_discounts.sql:428`: current view; `:887`: retained aggregate.
- `supabase/tests/function-grants.test.ts`: deliberate public-function allowlist.
- `supabase/tests/registration-payment-reporting.test.ts`: transaction fixture pattern.
- [Supabase functions](https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker): caller privileges and explicit grants.
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security#views): invoker views preserve caller scope.
- `docs/operations/option-b-release.md`: active main integration and protected production approval.

## Tasks (execute in order)

1. CREATE additive migration and backend transaction test. Register the new function in the authenticated allowlist. Verify paid/partial/full-refund original charges, pending/failed exclusion, other event/tenant isolation, empty event and grants. Group allocations are exercised using existing real group fixture routines in the integration suite.
   - VALIDATE: `pnpm exec vitest run supabase/tests/event-registration-gross.test.ts supabase/tests/function-grants.test.ts` against an isolated local replay.
2. ADD `getEventRegistrationGross(eventId)` reader returning integer cents or null on failure/invalid result. UPDATE the section to fetch it alongside filtered aggregates; show Unavailable for a failed financial total. Add the fifth card with whole-event caption. Allow grid class overrides on the existing row/skeleton; use two columns on small screens, five above 1200px for this page only. Set loading skeleton to five.
   - VALIDATE: `pnpm --filter web exec vitest run lib/queries/registrations-aggregates.test.ts 'app/(admin)/registrations/kpi-section.test.tsx' 'app/(admin)/registrations/page.test.tsx'`.
3. UPDATE focused tests and docs ledger/spec. Confirm selected event, ignored filters, refunded captured gross, zero and unavailable states. Run required local checks in an isolated worktree; review complete diff and create PIV implementation/review reports.
   - VALIDATE: app typechecks/tests/builds, shared UI audit/typecheck/tests, backend/shared suite with fake provider functions; `git diff --check`.
4. COMMIT, push and open PR to main. Review PR; wait required checks before merging. Record push/CI/merge timestamps. Follow automatic release through exact staging acceptance on desktop/tablet/mobile. Obtain owner approval at protected production. Verify live release and record job durations, queue/approval intervals and end-to-end time.
   - VALIDATE: GitHub exact-main CI, release artifacts, aliases and compiled identity; Browser checks without production writes.

## Acceptance criteria

- New Gross Registration card matches the selected event's original successfully collected amount before fees/refunds, including original refunded charges and each group allocation once.
- Other events and tenants never contribute. No table filter or page changes its value.
- Zero is reserved for a successful empty aggregate; a failed read renders Unavailable.
- Existing Retained gross and Refunds behavior is preserved; five-card responsive/loading layout matches existing design.
- Required checks and staging acceptance pass before protected production; no production fixtures or automated payments.
- Benchmark records actual CI and release time separately. This includes an additive database aggregate and is not represented as a UI-only baseline.

## Open questions / assumptions

None. The owner confirmed the calculation; event-only scope follows the original annotation. No dependencies added. The initial Option B cutover record stays separate from this feature.

## Risks

New function requires migration before dependent app deployment; Option B orders those steps. Backend changes conservatively select both apps. Gross counts accepted allocated captures, not quarantined/unallocated provider money, matching existing registration reporting. Existing financial tables/RLS remain authoritative.

## Amendments

2026-10-07 — Existing component/page tests cover card rendering and the skeleton contract; no separate grid-only test file was added. Focused backend tests and the existing real group capture/refund suite passed before UI implementation.
