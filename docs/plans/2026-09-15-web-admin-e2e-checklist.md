# Web and admin end-to-end checklist

Status: in progress. Only the public web app and admin console are in scope.

Use Pass, Fail, Blocked, or Not tested for each row. A code inspection is not a browser pass. Record fixture IDs, expected behavior, actual behavior, and evidence for each run. Sample data only; payment provider tests must use test credentials.

| Area | Required checks | Status |
| --- | --- | --- |
| Local setup | Preserved DB backup; migration history, schema, grants, storage; local browser/server API targets; paused external jobs | In progress |
| Accounts | Platform admin, two organizations' owners/editors/marshals, two runners; signup confirmation, login/logout, duplicate email, expired link, recovery, safe redirects | Not tested |
| Organizations | Provisioning, invitations, organization switching, branding, suspension and deletion guards | Staff invitations/scoping/resend passed locally; broader organization lifecycle remains open |
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
| Email | Confirmation/invitation/recovery; ticket delivery, correct local links, retry and failure visibility | Confirmation, staff invitation and resend passed locally; recovery and wider reliability remain open |
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

## Zero-commission pilot — 2026-09-15

- PASS locally: 0% commission with absorbed processing, two fake payments, one refund, settlement and authenticated CSV reconciliation, simulated payout, replay refusal and zero follow-up statement.
- Computer verified commission, settlement and payout recording. No actual money transferred. Fees remain predicted; CSV browser download and real provider lifecycle remain unverified.
- OPEN: misleading settlement certainty wording; completed event still shows unsold-entry projections. Payment CSV needs status-aware interpretation after refunds.
- Evidence and fixture IDs: [zero-commission pilot report](2026-09-15-zero-commission-pilot.md).

## PayMongo preflight — 2026-09-16

- PASS: 31 focused payment/method/processor-fee/report-date tests.
- PASS: running local webhook rejects missing, invalid, expired and tampered signatures; accepts a signed unknown QA event without money mutation.
- BLOCKED: no local PayMongo test API key. Computer dashboard access also blocked by an open Brave extension UI. Actual provider checkout/webhook/refund journey has not run.
- Setup and remaining steps: [PayMongo test-mode readiness](2026-09-16-paymongo-test-mode.md).

## PayMongo test key retry and refund patch — 2026-09-16

- PASS: actual PayMongo test-mode GCash checkout, signed provider webhook, failure/expiry, retry and PHP 25 actual processing on each PHP 1,000 payment. Platform commission stayed zero; organizer net PHP 975.
- FOUND AND FIXED LOCALLY: documented refund events were ignored; payment.refunded wraps refunds inside a payment resource. Normalize both observed payload shapes. Provider processing status now remains pending, and unknown statuses cannot finalize a refund.
- PASS: both provider test refunds succeeded for PHP 975. Captured/provider-retrieved payloads reconciled locally after the fix; duplicate replay did not double-refund; occupied slots returned to zero. Fresh original provider delivery after the patch remains untested.
- OPEN RELEASE BLOCKERS: simultaneous refund requests, callback-before-persistence, lookup errors acknowledged as unknown, and failed notification after terminal success. Owner browser ticket confirmation and production rollout remain pending.
- Temporary provider webhook disabled and public tunnel stopped. [Full evidence](2026-09-16-paymongo-test-mode.md), [refund investigation](../issues/issue-paymongo-refund-events.md).
- Validation: 55 focused payment/refund tests and 6 signed-webhook integration tests passed. Full backend gate failed: 419 passed, 5 failed, 14 skipped; eight failed suites including fixture-setup failures. Fixture isolation and legacy payout test compatibility need diagnosis before release.

## Durable refunds verified locally — 2026-09-16

- FIXED: concurrent refund ownership, uncertain retry idempotency, early callback persistence, lookup failure acknowledgment, and terminal success preservation. Distinct additional provider success is now a durable review discrepancy, never silently treated as replay.
- PASS: full backend457tests; admin756tests; admin typecheck; diff check. New migration recorded locally only.
- PASS (Computer + original provider callbacks): freshPHP1000GCash test payment, actualPHP25processor fee, zero commission; admin preview/submission returnedPHP975. Provider success callbacks reconciled directly. One request/audit, refunded registration, released slot.
- PASS: webhook-only tunnel disabled/stopped after test, provider test runtime restored. No real money, commit/push, or hosted change.
- OPEN: runner-facing refund wording must clearly disclose retained fees before payment; “full” currently means eligible net rather than entire original payment. Owner ticket browser confirmation and naturally pending Check refund status walkthrough remain unverified. Production notification reliability, hosted rollout, and remaining operational checklist still block production readiness.
- Evidence: [durable refund plan and results](2026-09-16-durable-refund-requests.md).

## Runner refund disclosure and owner ticket flow — 2026-09-16

- PASS: freshly fetched origin/main f13f4bb is already included in feature/admin-ui-changes (HEAD8e1321b, ahead1/behind0). No newer main design commits; uncommitted changes preserved.
- FIXED: runner registration review and payment now disclose actual organization refund terms, retained processing/platform fees, and capped organizer cancellation fees. Admin full-policy labels say Refund excluding fees. Monetary formulas unchanged.
- FIXED: refunded/cancelled/expired entries no longer show a race pass based on a retained token. Paid entries missing a token offer refresh instead of another payment. Old payment bookmarks suppress Pay for terminal entries; explicit backend refusal blocks stale checkout fallback.
- PASS (Computer): local owner sign-in with intended return path; refund notice before registration submission and payment; PayMongo test GCash checkout → original callback → correct owner ticket; My Races → View ticket; cross-runner ticket denied; authenticated admin refund → original provider callbacks → owner ticket invalidation after refresh and refunded My Races. PHP1000 paid, actualPHP25processor, zero commission, PHP975refund, one audit, slot released. No live money.
- PASS: final site347tests, admin756tests, both typechecks and diff check. No fresh backend test run needed for this frontend slice; earlier457pass remains prior evidence.
- Temporary provider webhook disabled and tunnel/relay stopped. No hosted changes, commit or push. Detailed evidence: [runner plan](2026-09-16-runner-refund-disclosure-ticket.md).
- NEXT: pending-refund browser check, race-kit release and marshal/check-in operations, report/export checks, and deployment parity remain in the broader readiness queue. Production notification reliability remains unresolved. Current refund-policy settings are displayed; no policy-version snapshot redesign was included.

### 2026-09-16 — pending refunds and race-day check-in

- PASS (controlled local fake-provider fixture): pending refund preview offers **Check refund status** and disables the note. Double-clicking kept one request, zero refund audits, the paid registration, and one reserved slot. The pending toast did not claim completion.
- PASS (controlled terminal events): a failed request retained the paid registration and slot; reopening offered the reviewed ₱975 refund from ₱1,000 with ₱25 retained. A delayed success arriving while that dialog was open released exactly one slot and recorded one refund audit. Double-clicking the stale confirmation returned **already refunded; no new refund issued**. No PayMongo latency or live money was simulated as genuine provider evidence.
- Fixture: event `9b9aa7a3-9b0d-411e-a25d-e41be56c8e38`, registration `a8caa77f-7437-42eb-9ba1-830a0b0ed9fc`. Final state refunded, request succeeded, slots_taken 0. Admin totals showed ₱975 and one completed refund.
- PASS (Computer browser): eligible paid runner manual check-in changed IN/LEFT from 0/1 to 1/0. Undo returned 0/1. Sample runner `5fb56ea7-5cea-4550-acff-2cc03d2fd020` was restored to not checked in.
- PASS (local endpoint): duplicate check-in returns already; refunded ticket returns not_paid; malformed ticket returns invalid_ticket. A marshal restricted to the durable-refund event sees only that event, receives an empty other-event roster, and cannot check into the pilot event (403).
- FOUND AND FIXED: the scanner omitted selected event_id, and the endpoint accepted a different event's ticket when staff could access both events. The endpoint now requires event_id, compares it before insertion, and verifies the signed ticket event against its registration. The scanner passes the selected event, reports wrong_event, and ignores a scan response after switching events. Browser reproduction now displays **Ticket belongs to another event / No check-in was recorded**. See [root cause and fix](../issues/issue-checkin-selected-event.md).
- Validation: admin suite 758/758 across 93 files; admin typecheck passes; focused live backend/check-in authorization suite 16/16. Browser scan and database verification agree. Full backend/payment suite was not rerun for this isolated check-in change.
- OPEN: race-kit release is not implemented. The claiming role has no release capability or usable workflow. This remains a pilot blocker.
- OPEN: checkin_undo deletes the row without preserving a durable undo audit. The registration audit remained unchanged after check-in/undo. Staff need a lasting operational history before pilot sign-off.
- NOT YET VERIFIED: marshal invitation and browser login journey, physical camera decoding and permission fallback, race-day exports, notification reliability, and hosted deployment parity. The local marshal fixture was created via the authorized API workflow; this does not prove invitations work.
- Release requirement: deploy the admin and check-in Edge Function together. Older admin bundles lacking event_id fail closed and require refresh. No hosted functions, database, or Vercel deployments changed in this slice.

### 2026-09-16 — durable check-in audit completed locally

- FIXED: check-in and undo now append permanent registration_audit entries in their database transaction. Duplicate check-in and repeated undo remain idempotent without duplicate history. Registration row locking serializes eligibility with refunds.
- PASS: scoped read-only checkin_history exposes only operational fields to authorized staff. Service-only checkin_record_tx rejects client calls; grants audit passes.
- PASS (Computer): QA Pilot Runner 2 check-in then undo left two visible entries, staff UUID/role and timestamps. IN/LEFT returned to 0/1. Database retained both audit records and no active check-in.
- Validation: admin 760/760 across 94 files; live backend/check-in and grants 11/11; admin typecheck and diff check passed. Full backend/payment suite not rerun for this isolated audit slice.
- Local migration: 20260915190158_race_day_checkin_audit.sql. Deploy migration before updated check-in function/admin. Hosted release remains pending.
- Kit implementation remains pending the pilot policy question. Plan: [race-day operations](2026-09-16-race-day-operations.md); spec: [check-in audit](../specs/checkin-audit.md).

### 2026-09-16 — complete-kit release implemented and verified locally

This supersedes the earlier open kit-policy/implementation notes above. User approved runner-only whole-kit collection, pending-refund blocking, and admin reversal with a reason.

- FIXED: dedicated Race kits station, scoped Race Kit staff role, runner lookup/signed-ticket lookup, reviewed shirt/add-ons, duplicate protection, admin reversal, permanent audit history, runner collection status and shirt edit lock.
- PASS (Computer): super admin released size M plus QA Finish Towel. Runner ticket displayed Collected and hid Change. Admin reversal required a reason and returned Ready for pickup. Runner then changed M to L. Event-scoped kit staff signed in directly to Race kits, saw only the assigned event, released the corrected L kit using a signed ticket, and received Already released on a repeat lookup. Staff had no reversal action. Direct Payments navigation was denied.
- FIXED during walkthrough: staff role label incorrectly said Admin; denied-page copy incorrectly claimed assigned kit staff were unregistered. Both now reflect the actual role and offer a return to the authorized workspace.
- PASS (database): historical M release and reversal reason preserved; corrected L release has the kit staff actor. Registration audit records all changes. Concurrent release attempts create one active kit; unauthorized other-org users cannot read or mutate it. Pending refunds, unpaid/refunded entries, stale snapshots, forged tickets, and runner mutations are rejected.
- PASS (export endpoint): authenticated filtered CSV returned 200, header plus one row, correct runner/category, size L, towel, Released state and kit staff UUID. Pagination test covers 1,001 rows; later-page failure returns an error; formula escaping passes. Fixed duplicate blank CSV rows caught by the test.
- BROWSER LIMIT: Brave returned ERR_BLOCKED_BY_CLIENT when following the download link despite server 200. No browser protection was changed. Production-domain browser download remains a release check.
- Validation: full admin suite 769/769 across 96 files, then updated Sidebar suite 8/8; full site suite 349/349 across 35 files; backend kit/check-in/grants/team suite 26/26; both app typechecks and diff check passed. Full backend/payment suite and production builds were not rerun for this kit slice.
- Local migration `20260915191046_race_kit_release.sql` applied and recorded. New local Edge Function served. Hosted schema/functions and Vercel deployments unchanged; no commit or push.
- Fixture: event `465b48d1-9e2b-4cb6-8b44-92c506a98953`, registration `7049bbea-ec9d-441b-96d2-e29f635288cb`, kit staff `58f7a916-8592-47cd-b79a-b032b041c5f4`. Local sample data only; fake payment and API-created staff are setup, not evidence of payment processing or invitation delivery.
- NEXT: invitation acceptance for Race Kit staff and marshals, remaining financial reports/exports and payout reconciliation, notification reliability, physical scanner acceptance and hosted/Vercel rollout checks. See [kit spec](../specs/race-kit-release.md).

### 2026-09-16 — staff invitation and revocation test

Overall: FAIL for complete staff onboarding; email delivery and revocation passed. [Detailed findings and evidence](../issues/2026-09-16-staff-invitation-readiness.md).

- PASS: new Race Kit and marshal invitations sent through the authenticated application endpoint, captured in Mailtrap (5704411906 / 5704412753), accepted through Computer, and confirmed locally. This used the app invitation workflow rather than direct account creation. The admin form submission itself was not browser-tested.
- FAIL: both operational roles land on `/team` and see Organization admins only. Navigation to their appropriate stations works.
- FAIL: invitation/team editing cannot assign an event scope. Both new roles have null scope, giving all events in their organization. Marshal browser picker included an unassigned sentinel event; that temporary event was removed afterward.
- PASS: both users cannot read another organization's roster or payment records. After app-endpoint removal, existing API sessions see zero events and browser refresh denies access. Both test roles are removed.
- SOURCE FINDING: existing-user invitations send no email but the server action always says Invite sent and discards the manual link. Resend and returning sign-in need correction/verification.
- SETUP FINDING: pilot org has no organizer admin. Its last-admin guard rejected a staff invitation after sending the email and creating the account. Successful tests used the North organization with an existing admin. One immediate subsequent email hit Mailtrap's per-second limit; spacing the calls resolved it.
- Targeted validation: 14 auth-confirm/invite-form tests plus 31 team/orgAdmin helper tests passed. Existing redirect tests hardcode `/team`, so a passing unit suite does not establish correct operational-staff onboarding.
- NEXT: fix role-aware invitation landing, configurable event scope and truthful resend/delivery feedback; then rerun the admin-form-to-email walkthrough and returning sign-in. No application code, hosted settings or deployments changed during this test.

### 2026-09-16 — staff invitation gaps fixed and retested

- FIXED: both emailed and manual links choose the current role's home. Legacy `next=/team` is corrected for operational staff.
- FIXED: invite and Team edit controls support all organization events or one selected event for marshal/Race Kit staff. The server rejects foreign events and unsupported scope/role combinations. Omitted scope preserves the existing restriction.
- FIXED: membership writes are atomic and serialize per organization. Concurrent last-admin demotions cannot leave zero admins. Email is sent only after a valid grant is saved; adding staff to an admin-less legacy org no longer incorrectly counts as removing its last admin.
- FIXED: new and existing accounts receive real SMTP email. The UI distinguishes saved access from delivery failure, offers a manual one-time link when available, and supports a resend action without permission changes.
- PASS (Computer): Team showed saved event restrictions. Submitting the invitation form for existing marshal `31663d62-9b26-4284-af53-3188eabf2251` with unchanged role and North event displayed **Access saved. Sign-in email sent**. Mailtrap message `5704439731` was accepted and landed at `/check-in` for QA North Trail 10K.
- PASS (Computer): the Team **Send sign-in email** button delivered message `5704437645` to kit staff `7fb279a1-5580-4322-99c8-3db6fe4803bd`. Accepting it landed at `/race-kits`, with only the North event listed.
- PASS (new identity): the actual authenticated application endpoint created and scoped `d12ad5f3-9902-472f-a809-25362ef66c2f`. Its first confirmation email, Mailtrap `5704441274`, was accepted through Computer and landed directly at `/race-kits`. This new-identity request used the endpoint; the browser form was exercised separately with the existing marshal above.
- PASS (real HTTP): manual token-hash links for claiming/marshal accounts, including legacy `/team`, returned `/race-kits` and `/check-in` respectively and set auth cookies. Invalid foreign-event invitation returned 400 before creating its requested identity.
- PASS (cleanup): all three temporary staff grants were removed through `org-members`. Existing scope was verified before removal. Refreshing the new kit account's browser session reached `/no-access`. Auth identities and sandbox messages remain as sample evidence.
- PASS: 782 admin tests across 98 files; 35 focused membership/helper/grants tests across three files; admin typecheck; isolated production build; `git diff --check`. Database tests include an unassigned same-org event, foreign-org event, rejected edits preserving access, service-only grants and concurrent admin demotions.
- LOCAL ONLY: migration `20260915200038_scoped_team_membership.sql` applied and recorded locally. Hosted migration/function rollout and Vercel deployment remain pending. Earlier dirty work was preserved.
- LIMITS: Mailtrap is now 48/50 messages. Delivery-failure feedback is tested with mocks; SMTP was not deliberately broken. The full backend suite was not rerun because unrelated tests send sandbox emails. Self-service passwordless login is outside this fix; returning staff can use the organizer's resend action.
- NEXT: continue the remaining reports/exports and notification checks, then perform a coordinated hosted migration/function/app rollout and deployment smoke test. This invitation pass does not establish whole-application production readiness.

Email tooling follow-up: Mailtrap is at 48/50. Race Pace already runs `supabase_inbucket_race-pace` using `public.ecr.aws/supabase/mailpit:v1.30.2`, exposed at `http://localhost:54524`. Recommend routing routine local email there and reserving Mailtrap for hosted checks. Configuration has not yet been switched.

### 2026-09-16 — local Mailpit enabled and email walkthrough

- LOCAL CONFIG: removed external SMTP from local Auth configuration. Live auth container now uses `supabase_inbucket_race-pace:1025`. Local ticket provider is `mailpit`, using Docker's `inbucket:1025` alias. Mailpit UI remains at `http://localhost:54524`. Resend remains the default production transport. No Mailtrap messages were sent in this run.
- PASS (in-app Browser): new scoped kit invitation `3ZX58AWGUWNlDRveOHSrZl` accepted to `/race-kits`, restricted to North event. After sign-out, resend message `6c6IFIzP3gid8fgVTSihVo` established a fresh staff session at the same station.
- PASS (mail capture/address confirmation/manual sign-in): runner message `6pQ4ODYTORG2fEdeeURPb2` confirmed the address. Existing-password sign-in reached My Races. Signup creation used the public API; the full browser signup form flow was not exercised.
- FAIL (product workflow): confirmation-link landing did not finish runner sign-in. Recovery message `1WelUtHvpchwXQuMuqjCPG` arrived, but its link opened the homepage, with no reset form. Neither app exposes a forgot-password workflow. See `../issues/2026-09-16-runner-email-auth-gaps.md` for scope and evidence boundaries.
- PASS (ticket endpoint + in-app Browser): protected `send-ticket-email` returned 200 for registration `7049bbea-ec9d-441b-96d2-e29f635288cb`. Message `1ji7W4Ox5sckPZq8569bvn` displays the QR, correct event/category/date/reference and PHP 1,000 total. Its View your ticket link opened the correct owner ticket with the previously collected size L kit. This tests the protected sender directly; payment-triggered automatic invocation was not repeated.
- PASS (failure handling): initial SMTP hostname resolution failed with EDNS and returned 502/send_failed. Using the network alias fixed the issue and retry delivered the message. Registration stayed paid at 100000 centavos. Unauthorized email invocation returned 401. Unit tests cover SMTP rejection, exceptions, closure and no fallback to external mail.
- PASS: 13 email/template/transport tests, `git diff --check`; live staff, confirmation, recovery and ticket messages captured in Mailpit. Restart preserved the local database; scheduled jobs remain inactive. An initial Docker removal race required one clean startup retry.
- NEXT: implement runner confirmation completion and password recovery, then continue remaining report/export and hosted deployment checks.

Mailpit test cleanup: the temporary scoped staff grant was removed through the application endpoint. Refreshing its existing in-app Browser session reached `/no-access`. The ticket owner session and captured messages remain available for review.

## 2026-09-16 — confirmation and recovery completion

- Implemented runner confirmation-required state, explicit callback and safe destination preservation. User submitted the signup form for `qa-browser-auth-20260916@example.com` in the in-app Browser. Mailpit `0PcPHLZk2SmXjihOI9gAPM` acceptance reached authenticated `/races`. Reusing the email link reached the sign-in error state.
- Added forgot-password and dedicated recovery pages to both apps. Browser request captured runner message `68HUwnn4sv20hhFtZYkO57` and admin kit staff message `0D1tCQ5d1LnCl6vjNeyW9N`. Both real PKCE links enabled the new-password form. Missing runner link and reused admin email link were rejected despite existing sessions.
- User handoff pending for final password entry/submission in both browser forms and subsequent UI sign-in. Browser tool policy requires user credential entry. Do not count the complete browser reset journey as passed yet.
- Independent local Auth API test on disposable identity `689bfb49-2675-473c-8d7a-b9ec370d6732`: genuinely expired recovery rejected after fixture timestamp was aged; fresh recovery accepted; password update succeeded; old password rejected; new password accepted; reused token rejected. No roles granted. This protocol test is separate from the pending browser handoff.
- Local Supabase restarted with data preserved to apply exact recovery redirect allowlist. Mailpit SMTP host verified; active cron count remains zero. Mailpit's ephemeral captured-message list was cleared by the restart; earlier mail evidence remains documented.
- Hosted Auth needs exact `/auth/recovery` URLs for both deployed origins before release. The local config does not change hosted settings. No hosted changes, commit, push or deployment in this slice.

### Password handoff: admin verified
User completed the admin kit staff password change. Browser showed success, sign-out reached the anonymous login form, and the new password signed in successfully. Capability routing opened `/race-kits`, showing only the assigned QA event and existing released kit. Runner reset submission and subsequent login remain pending in the separate runner tab.

### Final browser handoff completed
User completed both password changes. Admin new-password sign-in opened the scoped Race kits page. Runner new-password sign-in succeeded and opened protected My Races. Earlier pending browser handoff notes are now resolved. This authentication slice is complete locally; hosted redirect configuration remains a release task.

## 2026-09-16 — report/export audit

Reporting readiness: NOT READY; [detailed findings](../issues/2026-09-16-report-export-readiness.md).

Passed: eight pilot payment rows exactly reconcile to database money/status/IDs; two selected-event registration rows match; browser KPIs match independent arithmetic; zero commission preserved. Actual runner refunds are PHP5860 and current organizer net PHP1985. Payment and registration CSV downloads produced in-app Browser download events. North cannot export foreign event rows, kit staff sees no financial rows, runner receives403. All five existing payout statements reconcile. 106 focused tests passed, including mocked >1000-row export and formula escaping cases.

Open: payment CSV lacks actual refund/current-net reporting, settlement overclaims predicted proceeds as banked/exact, settlement Blob download not observed, partial-refund admin filter/types incomplete, paid rows with null method say Not yet paid. No application code changed in this validation slice. Fix these gaps and test partial refunds before marking reports complete. Hosted rollout remains pending.


## 2026-09-16 report/export fixes
- [x] Actual refund/current proceeds CSV columns, partial-refund filters and readable badges.
- [x] Settlement HTTP download observed in the in-app Browser; local authorization checks passed.
- [x] Paid/null method label corrected; settlement copy no longer claims bank payout.
- [x] Partial registration summary matches payment totals after local migration 20260915211523.
- [x] 815 admin tests, admin typecheck and 21 focused backend tests passed.
- [x] Webhook test signing-key mismatch resolved; all 27 registration gate tests pass.
- [x] Combined-filter and fixed/pass-on report reconciliation; fresh simulated payout/refund/recovery lifecycle passed.
- [ ] Hosted migration/deployment and smoke checks.

Details: .claude/reports/report-export-fixes-report.md.


## 2026-09-16 financial follow-up
- [x] Fixed commission absorb/GCash and pass-on/GCash; percent commission pass-on/card.
- [x] Payment, registration and settlement CSVs reconciled with independent decimal arithmetic.
- [x] Registration revenue now uses charged amount via local migration 20260915212629.
- [x] Refund after settled payout is recovered once; replay and third statement show no duplicate recovery.
- [x] Signed callback tests use local runtime configuration; invalid signatures remain rejected.
- [x] Completed-event payout and recovery forms passed in the in-app Browser with sample records.
- [ ] Real provider/bank reconciliation remains unverified.
- [ ] Large live export, final hosted release/configuration review and hosted smoke tests.

Evidence and exact limits: .claude/reports/financial-readiness-checks-report.md.


## 2026-09-16 completed payout and hosted review
- [x] Completed-event statement opening, missing-reference validation and simulated payout recording.
- [x] Post-payout refund recovery uses the correct direction; third statement is zero.
- [x] Both Vercel project roots and variable inventories verified.
- [ ] Publish the local fixes; production and previews still use older committed revisions.
- [ ] Hosted Supabase migration/function/Auth/email checks blocked by scheduled maintenance (503).
- [ ] Hosted runner recovery is currently404; admin recovery redirects to login. Retest after release.

Evidence: .claude/reports/completed-payout-hosted-review.md.
