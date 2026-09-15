# Financial readiness checks — 2026-09-16

Status: local scoped checks passed. Not a production deployment approval.

## Fixes
- Shared local webhook signer reads the same ignored functions environment file as the runtime. It rejects non-loopback API targets and missing configuration. Provider credentials and runtime signature verification were not changed.
- Signed refund callback fixtures now confirm a fake payment through the actual signed webhook. Previously they ignored a disabled fake-checkout response and incorrectly treated a pending registration as paid.
- Follow-up migration 20260915212629 uses payments.amount for registration revenue. Base price remains unchanged and is labeled Base amount in the table and Base Amount (PHP) in its CSV. CSV consumers matching the old Amount header must update.

## Live local financial scenarios

Every scenario used four fake payments through payment-session and signed confirmation. No external payment capture or bank transfer occurred. Expected amounts were calculated independently from stored fee terms and current local processor rates.

| Scenario | Charge | Commission | Processing | Organizer net |
| --- | ---: | ---: | ---: | ---: |
| fixed-absorb | PHP1000.00 | PHP50.00 | PHP15.00 | PHP935.00 |
| fixed-pass-on | PHP1065.99 | PHP50.00 | PHP15.99 | PHP1000.00 |
| percent-pass-on | PHP1082.91 | PHP30.00 | PHP52.90 | PHP1000.01 |

For each scenario:
1. Confirmed two payments and reconciled payment CSV, registration CSV, aggregate queries and settlement CSV.
2. Opened and marked the first statement paid with a QA-SIMULATED reference. Repeated mark-paid returned already.
3. Simulated a full organizer-net refund after settlement through refund_registration_tx. This validates the ledger transition, not provider refund delivery.
4. Confirmed two further sales. The next statement deducted the earlier refund once. Marked it paid and verified another replay is idempotent.
5. Opened a third statement: net and clawback are zero, proving no duplicate recovery.
6. Parsed CSVs with decimal arithmetic. Combined event/status/method/search and registration category/search filters return the correct three paid entries.

## Browser evidence
- In-app Browser registration summary for fixed/pass-on now shows gross PHP3197.97, paid 3, actual refunds PHP1000. Previously gross showed PHP3000.
- Fixed/pass-on settlement shows PHP4263.96 collected - PHP200 commission - PHP63.96 processing - PHP1000 refunds = PHP3000 organizer net. Export triggered a download event.
- Payout browser shows all three scenarios, the original paid statement, later single refund deduction and the zero open statement. These are local ledger records, not bank confirmation.

## Validation
- 815 admin tests across 102 files passed; admin typecheck and isolated production build passed.
- 55 tests passed: local signer configuration, registration gate, KPI aggregates, function grants and durable refund requests. All 27 registration gate tests now pass.
- 13 selected backend signed-webhook/pass-on tests passed; 17 unrelated cases intentionally not selected.
- 63 payout, commission/refund-policy, organizer-net-refund and processor-fee tests passed. These include stale revision, concurrency, full/partial post-settlement recovery and authorization cases.
- 22 focused KPI/grants/commission tests also passed before the final combined regression run (overlaps with the counts above).
- git diff --check passed. Root lint is a no-op. Public site and mobile were not changed in this slice.

## Test setup
Run functions serve with the existing local functions environment file. Tests default to supabase/functions/.env. When using a custom --env-file, set SUPABASE_FUNCTIONS_ENV_FILE to the same path for Vitest. Never copy a provider secret into tracked source.

## Boundaries
- Migration applied locally only. No hosted changes, commit, push or deployment.
- Full backend suite was not run in this PayMongo-configured runtime: separate fake-checkout-only cases assume a different runtime mode. Selected webhook and payout checks are passing; this is not a blanket all-backend claim.
- Repeated partial refund requests are currently rejected by the durable request flow. A legacy direct-RPC payout test documents a second partial-refund limitation. Do not promise multiple successive partial refunds.
- The new fixture events remain open. Simulated mark-paid calls exercised the RPC directly; browser settlement of a completed event remains a distinct operator workflow test.
- Large live CSV exports, final hosted configuration/migration checks, hosted smoke tests and real provider/bank reconciliation remain open.

## Retained sample fixtures
- fixed-absorb: org 116b4f8d-e357-4c17-8575-b0df136b7424, event 85ace86b-8f42-4a98-a476-78b2d51d1588.
- fixed-pass-on: org b3019fe7-45a3-4b68-92f8-0305ef12e7ea, event 830699d5-cd30-49fa-816e-6c57eeb007bf.
- percent-pass-on: org 2cc54eda-e4d4-49a1-a683-d2879c089879, event c6d2f0f7-0e58-4e74-86ae-5baf3ac0f973.
