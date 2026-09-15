# Web and admin end-to-end checklist

Status: in progress. Only the public web app and admin console are in scope.

Use Pass, Fail, Blocked, or Not tested for each row. A code inspection is not a browser pass. Record fixture IDs, expected behavior, actual behavior, and evidence for each run. Sample data only; payment provider tests must use test credentials.

| Area | Required checks | Status |
| --- | --- | --- |
| Local setup | Preserved DB backup; migration history, schema, grants, storage; local browser/server API targets; paused external jobs | In progress |
| Accounts | Platform admin, two organizations' owners/editors/marshals, two runners; signup confirmation, login/logout, duplicate email, expired link, recovery, safe redirects | Not tested |
| Organizations | Provisioning, invitations, organization switching, branding, suspension and deletion guards | Not tested |
| Tenant isolation | Organization A cannot read/change B's events, registrations, payments, exports or storage; runner ownership; scoped marshal access | Not tested |
| Events | Road and trail categories; draft/publish; required fields; dates and Manila deadline boundaries; images, maps, add-ons; cancellation/rescheduling | Hosted sample create/publish passed; remainder not tested |
| Discovery | Browse, text search, filters, event detail, empty states, public visibility and unpublished-event protection | Not tested |
| Registration | Profile, emergency contact, shirt, custom inputs, waiver, add-ons, required validation, immutable price snapshots | Not tested |
| Capacity | Duplicate registration, last-slot concurrency, expiry, released capacity, re-registration, admin override audit | Not tested |
| Payments | Success/failure/cancellation, method matrix, altered client totals, repeated and late webhooks, callback ordering, unpaid ticket protection | Not tested |
| Commissions | Absorb/pass-on × percent/fixed × payment method; independent centavo calculation; rounding, add-ons, changed terms; predicted/actual/historical fees | Not tested |
| Refunds | Eligibility, retained fees, partial/full, duplicate/concurrent requests, provider failure, slot release, ticket invalidation | Not tested |
| Payouts | Statement creation, double-inclusion prevention, paid reference, refund before/after opening and settlement, one-time clawback | Not tested |
| Race kits | Release eligibility, lookup, sizes/add-ons, duplicate release prevention, staff access and audit | Blocked: implementation missing in initial inspection |
| Check-in | QR/manual, duplicate/invalid/wrong-event/unpaid/refunded tickets, marshal scope, undo and audit, camera fallback | Not tested |
| Registrants | Filters, sorting, pagination, fields, updates, cancellation/refund states, counts consistent with registrations | Not tested |
| Reports and exports | Every report reconciles to source rows; date/org/event filters; >1,000 rows; CSV escaping/formulas, Unicode, centavos and timezone | Not tested |
| Email | Confirmation/invitation/recovery; ticket delivery, correct local links, retry and failure visibility | Confirmation delivery and link passed; remaining email flows not tested |
| Deployment | Exact revision builds, Vercel root directories/env, auth URLs, storage images, Edge Functions, test-mode provider integration, cron, backups, remove sample credentials | Not tested |

## Current discrepancies

See `2026-09-15-web-admin-readiness.md` for the initial GAP list and verified baseline checks.

- Local and hosted migration histories both contain the same 86 versions. Application columns, constraints, views, policies and all 33 application functions match. Hosted has an additional `rls_auto_enable()` event-trigger helper; this is a recorded environment difference, not a missing application migration.
- Auth email and ticket email use different delivery paths. Mailtrap SMTP does not configure the Resend-based ticket sender.
- Source inspection: `apps/web/lib/settlement-math.ts` maps payment creation time into `paid_at` and hardcodes `refunded_at` to null. Verify against actual payment/refund timestamps before accepting settlement exports.

## Evidence record template

- Check / environment / date:
- Account role and organization:
- Event / registration / payment / statement IDs:
- Expected result and independently calculated amounts:
- Actual result and evidence:
- Status and discrepancy reference:

## Local setup run evidence

2026-09-15: backend 402/402 passed; site and admin typechecks passed. Mailtrap captured local runner confirmation (message 5702321885), and its link confirmed local user f41c96dc-90a5-48de-88b5-68feb1f0b3cd. Homepage renders following local image fix. No completed runner payment yet.

Discrepancies: hosted effective grants differ from local despite identical migration history; investigate before deployment. Signup redirects home without a check-your-email state. Confirmation defaults to the site root rather than the callback route. Automated backend tests leave sample events visible in the local marketplace; keep test fixtures separate for repeatable visual QA.

Local account follow-up: browser/server cookie names differed because Docker uses host.docker.internal and the browser uses 127.0.0.1. Both Next server clients and middleware now derive the cookie name from the public URL. Computer verified direct `/races` access with My Races, Profile and Log out navigation. Final validation: site 322, admin 739, backend/shared 402 tests passed (1,463 total); both app typechecks passed. Registration/payment walkthrough remains pending.

Permission follow-up: service-only slot-release migration prepared and applied locally; grant/capacity regression and organization isolation suites passed (32 tests). CLI account lacks access to active hosted project; linked lookup returns 403. Hosted grants and browser walkthrough remain pending authenticated access.

Permission stage complete: CLI access restored; three reviewed migrations applied to local and hosted. All 89 migrations match. Client grants now match exactly; service-role differences preserved. Local backend suite 403/403. See docs/issues/2026-09-15-permission-parity.md. Browser admin testing resumed.

## Latest walkthrough evidence (2026-09-15)

See [two-organization walkthrough](2026-09-15-two-org-walkthrough.md) for fixture IDs and exact boundaries.

- PASS: North organizer event create/publish; South cannot open North event edit URL.
- PASS: runner registration, local sandbox payment, ticket render, one slot increment, admin payment totals, manual check-in.
- FIXED LOCALLY: sandbox provider omitted required return URL; 30 focused tests pass including real handoff integration.
- FAIL: registration full name is not persisted; ticket/admin/check-in show missing runner identity.
- FAIL: ticket delivery absent and success copy inaccurate (separate Resend mailer unconfigured).
- BLOCKED IN BROWSER: registration CSV download, Brave ERR_BLOCKED_BY_CLIENT.
- OPEN: reciprocal organization flow; private data isolation; exports and settlements; refunds/payouts; alternate fee terms; race-kit releases; marshal role/scanning; real PayMongo test mode; deployment checks.

Production readiness remains NO. The completed payment is simulated and its processor fee is predicted.

## Runner identity fix verified locally

- PASS: new paid entry 0cd4949d-affb-47ef-95a8-6081cc51d4e2 retains QA Snapshot Runner / SNAPSHOT QA with optional profile save OFF.
- PASS: ticket, admin registration, admin payment, and check-in roster show the submitted identity in Computer walkthrough.
- PASS: database confirms profile identity remains NULL; snapshot supplies operational identity.
- PASS: snapshot precedence and legacy fallback covered by tests; cross-org view tests and function-grant checks pass.
- LOCAL ONLY: new migration 20260914213000 and application changes await coordinated hosted release. Lost names on old entries are not automatically reconstructable.
- NEXT: ticket mail through Mailtrap and truthful delivery feedback; then reports/export reconciliation and payment-provider/payout checks.

## Ticket email verified locally

- PASS: paid-ticket email received in Mailtrap, message 5702383721; event, category, amount, recipient and ticket URL inspected through Computer.
- PASS: automatic fake payment → confirmation → email capture, registration 4a2468ee-babd-45b5-a156-16eeef768d07, Mailtrap message 5702385325. API-driven transaction plus browser inbox verification.
- PASS: email link opens correct authenticated ticket. Ticket page no longer falsely claims delivery.
- PASS: ten email tests, storefront typecheck and whitespace checks.
- NEXT: registration/payment export reconciliation, including known settlement timestamp issues. Production mail delivery/retries and hosted deployment remain open.

## Export checks and streaming fix

- FIXED: payment export failed in deferred stream pulls because cookies were read outside request scope. Captured caller-authenticated client is reused in both exports, including registration email lookup.
- PASS: North authenticated HTTP exports contain 3 registration/payment rows; South contains none, including North's explicit event URL.
- PASS: CSV totals reconcile to DB: PHP 3000 gross, 90 commission, 45 processing, 2865 organizer net.
- PASS: 741 admin tests and typecheck; multi-batch regression verifies 1,001 rows use captured client.
- BROWSER BLOCKED: Brave still reports ERR_BLOCKED_BY_CLIENT on download. Endpoint success is not a browser download pass.
- OPEN: settlement paid_at incorrectly uses payment creation; refunded_at always blank; payment CSV omits processor-fee column. Next stage is accurate settlement timestamps and complete money-report columns before refund/payout reconciliation.

## Financial reporting fixes verified locally

- FIXED: migration 20260915115501 records payment confirmation time atomically. Existing dates are backfilled only from matching system paid audit entries; unknown legacy dates remain blank.
- FIXED: settlement reads confirmation time and validated refund time. Payment CSV includes recorded processing fee/source and distinct checkout/confirmation timestamps.
- PASS: 743 admin tests and typecheck; final export test rerun 13 passed; reporting and function-grant checks 9 passed; git diff --check clean.
- PASS: authenticated HTTP payment export returns North's three rows and South's header only. Each North row shows PHP 1000 gross, 30 commission, 15 predicted processing, 955 net. Confirmation timestamps differ from checkout timestamps.
- PASS: direct database test confirms payment replay preserves paid_at and refund preserves paid_at while recording refunded_at. This is not a browser refund/payout pass.
- OPEN: browser download remains unverified. Full refund/payout browser reconciliation and PayMongo test mode remain pending. Settlement projection says already banked and exact despite predicted processing fees; review this copy.
- LOCAL ONLY: timestamp migration and code have not been released to hosted Supabase or Vercel. Production readiness remains NO.

## Refund and payout walkthrough — 2026-09-15

- PASS (Computer): North admin refunded QA Mail Flow Runner (4a2468ee-babd-45b5-a156-16eeef768d07). Stored refund PHP 955, slot count 3 to 2, paid_at preserved and refunded_at populated. Settlement PHP 3000 - 90 - 45 - 955 = 1910.
- FAIL: refund drawer, confirmation and success toast advertise PHP 1000, but provider path and ledger use PHP 955. RefundModal derives its amount from total_amount instead of refund policy/net_to_org; success ignores pending/already result. Correct amount preview and outcome messaging before launch.
- PASS (Computer): platform login; opened North statement 6abc5fbd-fd59-4b96-b46b-66bf864c93b1 for PHP 1910. Payment action locked while event unfinished.
- QA fixture setup: marked only North event 6cf4de5f-decf-4877-8bd0-7dd9abf7859f completed in local DB. Dates unchanged. It remains completed for these payout tests.
- PASS (Computer): recorded simulated payout reference QA-SIMULATED-20260915-001. No actual bank transfer.
- PASS (authenticated API): refunded QA Snapshot Runner after payout (0cd4949d-affb-47ef-95a8-6081cc51d4e2).
- PASS (Computer): next statement 3b0f8a07-d870-40b4-ba11-9e453855e0a6 showed PHP -955 owed back; recorded simulated recovery QA-SIMULATED-RECOVERY-20260915-001. No actual transfer.
- PASS (authenticated RPC/readback): subsequent statement 87ed5a86-ba10-4528-b3c2-e8449efbbded has zero net and zero refunds. Reopening concurrently/existing open rejected with 23505. No duplicate earnings or clawback in this sequential scenario.
- PASS: 32 focused tests across payout-statements, payout-statements-v2, refund-net-to-org and refund-policy.
- OPEN: refund UI amount/pending feedback; misleading already banked and exact settlement copy; real provider pending/failure and fee confirmation; flat-fee/pass-on browser journeys; refund after statement opening before payment; payout exports. No hosted deployment or production readiness claim.

## Refund feedback fixed; payout window blocker confirmed

- FIXED LOCALLY: authenticated server preview shares refund policy calculation with execution. Shows original payment, retained fees and runner refund. Submission checks expected amount before contacting provider. Pending/already responses retained; failure never reports success.
- PASS (Computer): c7b6b89a-88ad-4805-9705-cac7a527dff3 preview showed PHP 1000 / 45 / 955. Submitted refund; UI status Refunded and DB refunded_amount=95500, slots_taken=0. All three North QA registrations are now refunded. Existing North zero open payout statement is stale after this last post-payout refund; do not settle it.
- PASS: full admin suite 748 tests before final six action tests; final focused suite 21 passed; admin typecheck and whitespace check passed. Backend focused suite 33 passed plus one explicitly expected failure.
- FAIL: refund between opening and settlement allows a stale PHP 3820 statement to be marked paid when PHP 1910 remains owed. See docs/issues/issue-payout-stale-statement.md. Reproduced with authenticated RPCs and disposable fixtures, not an actual transfer.
- NEXT: prevent stale payout settlement, including new payments and fee changes between opening and payment. This is a production blocker. No hosted changes or real transfers.

## Stale payout settlement fixed locally — 2026-09-15

- Migration 20260915123631 saves payment financial snapshots and statement revisions. Open/refresh/settle lock registration and payment writes for their short transaction, preventing changes between comparison and stamping. No network work occurs while locked.
- Settlement refuses changed financial rows and old caller revisions without writing payment stamps or a transfer reference. Legacy three-argument callers fail closed with review_required. Existing open statements need explicit refresh; paid history remains unchanged.
- Admin now offers Refresh statement and sends the reviewed revision. Refresh recalculates the original accounting formulas and increments revision; it never marks a statement paid. Reopening a settlement dialog clears old references/errors.
- PASS: full refund window regression, new entries, partial refunds, processor corrections, stale caller after refresh, concurrent duplicate settlement, simultaneous refund/settlement, replay, organization-admin refusal and function grants. Final backend run: 32 passed, zero expected failures.
- PASS: full admin suite 754 passed; final payout page checks 6 passed, typecheck and diff check passed.
- PASS (Computer): old North statement 87ed5a86-ba10-4528-b3c2-e8449efbbded rejected QA-STALE-MUST-REJECT without marking paid. Explicit refresh changed zero to PHP -955 recovery. Reviewed and recorded simulated recovery QA-SIMULATED-RECOVERY-20260915-002. UI now shows three settled statements, net PHP zero. No real transfer.
- Deployment: local only. Migration must precede updated admin deployment; old clients deliberately cannot settle. Snapshot function internal only; refresh and settlement recheck super-admin authorization. Hosted not changed.
- Limitation: conservative table locks serialize payout work across events and briefly block writes; load/latency validation is still required before production volume. This protects ledger recording, not manual transfers made outside the app before review. Real payment provider lifecycle and production readiness remain unverified.
