# Report/export fixes — 2026-09-16

Implemented and verified locally. Hosted deployment remains pending.

## Changes
- Payment CSV adds actual refunded amount, retained gross, current platform fees and current organizer net. Historical net is labeled Stored Ledger Net to Org (PHP). Consumers matching the old header must update.
- Settlement exports use an authenticated HTTP attachment route with owning-organization and capability checks, private/no-store caching, safe filenames and failure responses.
- Settlement copy describes recorded proceeds and possible fee estimates without asserting a bank payout.
- Payment and registration filters/badges support partial refunds.
- Paid/refunded payments with a missing method show Not recorded.
- Browser testing uncovered a registration summary gap. Migration 20260915211523 includes partial refunds in paid counts, retained revenue and actual refunds. Counts are labeled refunded registrations, not requests. Tenant policies and query filters remain in force.

## Evidence
- In-app Browser observed the settlement download event. Authenticated HTTP CSV parsed independently: pilot event has two rows and PHP985 actual refunds.
- Pilot payment CSV totals: actual refunds PHP5860; retained gross PHP2000; current platform fees PHP0; current organizer net PHP1985.
- Simulated partial-refund event 73aee9ec-a1b7-4e10-9ae9-41934c818c53: PHP1000 charge, PHP400 refund, PHP600 retained gross, PHP30 current commission, PHP15 processing, PHP555 current organizer net. Payment CSV and payment cards agree. Registration browser cards show paid 1, revenue PHP600, refunds PHP400.
- Paid kit fixture 7049bbea-ec9d-441b-96d2-e29f635288cb visibly shows Not recorded and Paid together.
- Real settlement access checks: North organizer own event HTTP200, foreign pilot event HTTP404; kit staff and runner HTTP403. These used local API-authenticated sessions.
- Full admin suite: 815 tests across 102 files passed. Admin typecheck passed.
- Database KPI, grants and commission/refund policy suites: 21 tests passed.
- Registration gate: 25 passed, two webhook cases returned HTTP401. Their hardcoded test signing key differs from the local runtime configuration file. No provider key was exposed or changed. This broader check is not a pass.
- Final isolated admin production build passed after all application changes.
- No root lint gate exists; git diff --check passed.

## Boundaries
- Migration applied locally only. No commit, push or hosted deployment.
- Partial-refund fixture is simulated report data, not a provider refund or transfer.
- Existing payout statements were reconciled read-only. Fresh payout lifecycle and bank/provider settlement reconciliation remain separate tests.
- Large live exports, combined filters and nonzero/fixed/pass-on report scenarios still need browser/data walkthroughs.
- Existing authentication, kit, refund and staff changes were preserved.


## Follow-up verification
The signing-key failures and fixed/pass-on reporting checks recorded above are resolved in the later financial readiness pass. That pass found and corrected registration revenue using base instead of charged amounts. See .claude/reports/financial-readiness-checks-report.md for current results and remaining boundaries.
