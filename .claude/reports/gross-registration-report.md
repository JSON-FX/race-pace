# Implementation Report — Gross Registration

**Plan**: `.claude/plans/gross-registration.md`  **Branch**: `codex/gross-registration`  **Status**: COMPLETE (implementation); hosted release acceptance pending.

## Summary

Registrations now shows selected-event original captured sales before fees and refunds. The existing filtered cards keep their behavior. A caller-scoped SQL aggregate reads participant allocations once, including fully refunded charges, without table filters or row limits. A failed financial read displays Unavailable rather than zero.

## Tasks completed

- Additive migration and transaction integration test: `supabase/migrations/20261006173324_admin_event_registration_gross.sql`, `supabase/tests/event-registration-gross.test.ts`.
- Explicit function-grant allowlist and existing real group capture/refund assertion.
- Event-only reader, five-card row and matching suspended skeleton in the admin app.
- Focused reader/component tests, feature contract, plan and docs ledger.

## Validation results

| Check | Result |
| --- | --- |
| Frozen workspace install | Passed; lockfile unchanged |
| Admin tests / typecheck / build | Passed: 130 files, 1,058 tests |
| Storefront tests / typecheck / build | Passed: 77 files, 550 tests |
| Backend/shared root suite, fake-provider functions and native proof verifier | Passed: 117 files, 1,012 tests |
| Shared UI audit / typecheck / tests | Passed: 2 files, 13 tests; audit found zero remaining violations |
| Clean isolated migration replay | Passed: 181 migrations |
| Supabase local security advisors | No issues found |
| Pinned Deno 2.9.6 frozen dependency graph | Passed |
| git diff --check | Passed |

Total: 2,633 passing tests. Local runtime is Node 26.10.0; GitHub CI independently validates under the repository's pinned Node 24.

## Tests added

Cover original legacy captures through partial/full refunds, unpaid exclusion, other-event separation, foreign-tenant denial, runner denial, empty event, caller privileges and anon rejection. The real group capture/refund fixture confirms allocated gross is counted once after refund. UI tests cover event-only scope through filtering/pagination, integer/string cents, successful zero, failed reads and invalid/unsafe totals.

## Deviations from the plan

No separate grid-only test was added. Existing page/component tests cover rendering; hosted desktop/tablet/mobile acceptance verifies actual CSS behavior. This avoids duplicating the class implementation in a test. No dependencies were added.

## Issues encountered

The first local database check ran before the isolated stack was healthy and was rerun successfully. One parameterized UI fixture initially inferred the wrong tuple shape; it was corrected before full validation. Local proof-verifier credentials were reconciled with the fake-provider environment before the backend suite. None remain unresolved.

## Release boundary

Option B is verified active. This feature includes an additive database aggregate, so the controller conservatively deploys both apps. Benchmark CI, staging, owner approval wait and production separately. Hosted staging acceptance and protected owner production approval remain pending; production checks are read-only.
