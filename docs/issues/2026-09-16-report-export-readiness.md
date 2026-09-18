# Reports and exports readiness audit

Date: 2026-09-16. Local seeded/sample data. Scope: public/admin readiness, reports, CSVs and read-only payout reconciliation. Overall: NOT READY for the reporting slice. No application fixes or hosted changes in this audit.

## Passed

- Pilot organization `935f64ee-bb07-4012-8f0e-8a30f322bdaa`: eight payment export rows match database registration IDs, amount, platform fee, processing fee, stored organizer net and status exactly. Two paid and six refunded rows. Every commission is zero.
- Independent database arithmetic matches both RPC and browser KPIs: retained gross 200000 centavos, platform fee 0, current organizer net 198500, actual runner refunds 586000.
- Event `4de30fc8-4bf7-4d8e-aeb4-522f14aff3c4`: payment and registration exports contain the correct two IDs. Registration amounts/statuses match the source and emails are populated. Browser shows total 2, paid 1, gross revenue PHP1000, refunds PHP985. Filtered payment browser shows gross PHP1000, fee PHP0, net PHP985, refunded PHP985.
- Event settlement browser: PHP2000 gross - PHP0 commission - PHP30 processing - PHP985 refunds = PHP985 current organizer net. Matches the database.
- In-app Browser observed download events for registration and payment CSV controls. Authenticated HTTP bodies were parsed independently using CSV parsing and decimal arithmetic, not text line counts.
- North organizer authenticated exports: three own payment/registration rows, zero rows for an explicit foreign event. Kit staff gets header-only financial exports; runner gets HTTP403. No foreign data leaked in these cases. Sessions for access checks were created through local administrative magic-link APIs, not a browser login test.
- Five existing payout statements satisfy gross - commission - processing - refunds in period - clawback = net owed. Browser matches pilot paid PHP985 with simulated reference and open PHP0 statement. No new statements or transfers created.
- 106 focused tests across six files pass: payment/registration exports, settlement CSV/math, payment aggregates and payout queries. Includes >1000-row batching and formula escaping tests. Large live export was not seeded/exercised.

## Findings

### 1. Payment CSV cannot reconcile refunds or current organizer proceeds by itself

`apps/web/app/(admin)/payments/export/route.ts` and `apps/web/lib/queries/payments.ts` omit `refunded_amount`. Six refunded pilot payments export PHP6000 original gross; actual refunds total PHP5860. Their stored Net to Org is the historical refund/clawback basis, not current proceeds. Simply summing the exported Net to Org column gives PHP7845 instead of the current PHP1985 KPI.

The exported raw amounts match the ledger; the discrepancy is incomplete reporting semantics. Add explicit actual refund and current organizer-net columns, retaining clearly labeled historical ledger values where needed. Verify full and partial refunds and parity with filters/KPIs.

### 2. Settlement claims estimated proceeds are already banked and exact

`apps/web/app/(admin)/events/[id]/settlement/page.tsx:90` says the PHP985 figure is “already banked and exact.” Both pilot event fees are `predicted`. This claim is not supported by processor settlement evidence. Use recorded/estimated language and distinguish payment confirmation from bank payout.

### 3. Settlement download not verified in the in-app Browser

Clicked the client-side Export CSV button. No download event arrived within 15 seconds, and no corresponding JavaScript error appeared. By contrast, registration/payment HTTP export links produced download events. The settlement button constructs a Blob URL and immediately revokes it (`export-button.tsx`). That implementation is a lead, not a proven root cause. Investigate and verify a real saved download; do not report success based on the serializer unit test.

### 4. Partial refund status is missing from admin payment filter/types

`apps/web/app/(admin)/payments/payments-table.tsx` offers paid, pending, refunded and failed only. `lib/queries/registrations.ts` PaymentStatus omits partially_refunded. `components/StatusBadge.tsx` falls back to the raw status string. The database aggregate and settlement do support partial refunds. There are no current partial-refund rows locally, so this is a verified source gap, not a claimed browser reproduction. Add a partial refund fixture and test display/filter/export consistency.

### 5. Missing payment method is mislabeled unpaid

Browser shows the paid kit fixture `7049bbea-ec9d-441b-96d2-e29f635288cb` as “Not yet paid” in Method while Status says Paid. Its method is null. `components/MethodBadge.tsx` derives this text from method alone. Show an unknown/unrecorded method for paid/refunded records. This fixture was simulated; no claim that PayMongo omits methods in real successful callbacks.

## Remaining boundaries

- Settlement download completion remains open; payment/registration downloads passed.
- Test partial refunds, search/method combinations, nonzero/fixed commission and pass-on report reconciliation in the fix pass.
- Payout checks here are read-only reconciliation of existing simulated statements, not bank/provider reconciliation or a fresh payout lifecycle test.
- No broad app/backend suites or production builds repeated because application code was unchanged.
- No commit, push or deployment. Existing authentication/kit/refund/staff changes preserved.


## Fix verification — 2026-09-16
The five findings above are resolved locally. See .claude/reports/report-export-fixes-report.md for evidence. A sixth gap emerged during partial-refund testing: registration summaries excluded partial payments. Migration 20260915211523 fixes counts and retained/returned amounts without changing tenant authorization. Browser shows PHP600 retained revenue and PHP400 refunded.

This closes the identified local defects, not the full production-readiness checklist. Two broader webhook checks have a test signing-key mismatch; deployment and remaining report scenarios are pending.


## Follow-up verification
The signing-key failures and fixed/pass-on reporting checks recorded above are resolved in the later financial readiness pass. That pass found and corrected registration revenue using base instead of charged amounts. See .claude/reports/financial-readiness-checks-report.md for current results and remaining boundaries.
