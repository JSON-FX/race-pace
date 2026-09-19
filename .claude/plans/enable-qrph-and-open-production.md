# Feature: Enable QR Ph and open production

## Feature Description

Remove the temporary production Coming Soon middleware gate from the runner and admin applications. Add QR Ph to the server-owned PayMongo Hosted Checkout method allowlist and every web/admin presentation that names an offered payment method.

## User Story

As a Race Pace operator, I want the production web and admin applications open with QR Ph available so organizers can create events and runners can pay through a widely used Philippine payment rail.

## Solution Statement

Delete the production-only middleware and layout branches while retaining staging crawler protection. Add `qrph` to the PayMongo checkout defaults, method validation, runner copy, group contracts, admin labels, and the rate-card offered set. Continue using server-side PayMongo secrets, signed webhooks, provider session verification, exact checkout origins, and actual captured fees as the accounting authority.

## Out of Scope / Non-Goals

- No custom QR renderer; PayMongo Hosted Checkout owns QR generation and expiry.
- No `qrph.expired` handler; the application confirms success through existing checkout/payment events and reconciles the Checkout Session.
- No live payment executed by the implementation agent; the owner will perform the first transaction.
- The `/coming-soon` page and its assets may remain as an unlinked page for future maintenance use.

## Feature Metadata

**Feature Type**: Enhancement and launch configuration  
**Complexity**: Medium  
**Systems**: Next.js runner/admin, shared package, Supabase Edge Functions and Postgres rate-card data  
**Dependencies**: PayMongo Hosted Checkout and existing production Supabase/Vercel projects

## Context References

- `packages/shared/src/launchGate.ts` — temporary production gate and persistent staging detection.
- `apps/site/middleware.ts`, `apps/web/middleware.ts` — production redirect and staging noindex behavior.
- `apps/site/app/layout.tsx` — production-only stripped layout that must be removed with the gate.
- `supabase/functions/_shared/payments.ts` — authoritative default Hosted Checkout methods.
- `supabase/functions/payment-session/index.ts` — server-side method allowlist.
- `apps/site/lib/payment.ts` — runner payment keys and rate-card mapping.
- `supabase/functions/_shared/groupPaymongo.ts` and group checkout callers — group method contract.
- `apps/web/components/MethodBadge.tsx` — organizer-facing captured method label.
- `supabase/migrations/20260811096500_processor_rates_offered.sql` — existing offered-rate pattern.
- [PayMongo Hosted Checkout](https://docs.paymongo.com/docs/payment-channels-hosted-checkout) — official `qrph` method identifier and paid Checkout Session event.
- [PayMongo account capabilities](https://docs.paymongo.com/docs/account-settings-account-capabilities) — QR Ph activation and capability behavior.

## Implementation Plan

### Task 1: Remove the production holding gate

- Remove `isPublicLaunchClosed` and its middleware branches.
- Restore the standard runner layout in production.
- Keep staging `X-Robots-Tag` behavior unchanged.
- Update shared launch-gate tests to cover staging detection only.
- Validate: `pnpm exec vitest run packages/shared/src/launchGate.test.ts`

### Task 2: Add QR Ph to Hosted Checkout contracts

- Add `qrph` to the PayMongo provider default method array.
- Add `qrph` to the server-side payment-session allowlist.
- Add QR Ph to runner payment metadata and checkout copy.
- Extend group preparation, group provider validation, and runner group types.
- Keep provider URL, secret-key, signed-webhook, ownership, amount, and livemode controls unchanged.
- Validate: focused site and backend payment tests.

### Task 3: Add admin accounting presentation and rate availability

- Render captured `qrph` payments as `QR Ph` in admin tables and filters.
- Create a follow-up migration that marks the existing current QR Ph rate row as offered.
- Update the exact offered-method database assertion.
- Validate: MethodBadge and processor-rate tests.

### Task 4: Validate and review

- Run runner/admin tests and typechecks, root backend/shared tests, and both production builds.
- Review the complete diff for secret exposure, client-trusted payment amounts, unsafe provider URLs, and staging crawler regressions.
- Write the PIV implementation and review reports.

### Task 5: Release

- Commit and push the reviewed branch.
- Open and merge a pull request into `main` after required checks pass.
- Apply the QR Ph offered-rate migration to production.
- Deploy the changed Supabase payment functions.
- Verify the production web/admin routes no longer redirect to Coming Soon and staging still blocks indexing.
- Do not create a live transaction; hand that test to the owner.

## Acceptance Criteria

- Production web and admin routes render their applications without a Coming Soon redirect.
- Staging retains crawler-blocking headers/protection.
- New PayMongo Checkout Sessions offer `qrph` alongside card, GCash and Maya.
- QR Ph remains a server-controlled allowlisted method.
- Successful QR Ph payments use the existing signed webhook and session-verification paths.
- Admin payment views label captured `qrph` payments as `QR Ph`.
- The existing QR Ph processor-rate row is marked offered without altering historical rows.
- Validation and review pass before production deployment.

## Open Questions / Assumptions

- Settled: use PayMongo Hosted Checkout rather than a custom Payment Intent UI.
- Assumed from PayMongo's current capability documentation: QR Ph is active for the live merchant account. If PayMongo rejects it, fail closed and confirm the account capability before any retry.
- The owner explicitly requested no implementation-agent live transaction test.
