# Implementation Report — assisted registration revisions

**Plan**: docs/plans/2026-09-16-assisted-registration-passport-revisions.md
**Branch**: feature/admin-ui-changes
**Status**: PARTIAL

## Summary

Started the PIV implementation with a backward-compatible participant identity foundation. The local database now supports independent Passports and restricted helper management. Existing checkout remains self-only; assisted registration is not ready to activate.

## Tasks completed

- Added migration `20260916050940_participant_passport_foundation.sql`: Passport/manager tables, restricted column grants, row-level security, retry-safe authenticated creation, account provisioning and additive registration identity references.
- Backfilled accounts and registrations locally without guessing split names or converting bib names to team names.
- Added shared and identical Deno completeness validators for split names, separate contact fields, birth dates and the new gender options.
- Added 23 tests across `passport-foundation.test.ts` and `passport.test.ts`; updated the deliberate function grant allowlist.
- Added `docs/specs/participant-passport-foundation.md` and updated the plan/roadmap.

## Validation results

- Local migration applied successfully. No hosted mutation/deployment.
- Focused validation: initial 29 tests passed; two additional foundation tests subsequently passed (six integration tests total).
- Site: 374 tests passed; typecheck passed.
- Admin: 815 tests passed; typecheck passed.
- Backend/shared suite excluding `backend.test.ts`: 473 tests passed across 53 files.
- Additional selected payment/webhook checks: 7 passed, 1 failed, 22 skipped. Failure is `backend.test.ts:503`: fake-checkout returns 404 instead of the expected 200 because the current local runtime has PayMongo configured. The endpoint deliberately rejects fake confirmation in this mode. Provider settings were preserved.
- Shared standalone typecheck: FAILED on seven existing errors in unchanged `packages/shared/src/photo.ts` at lines 40, 56 and 59. Site/admin compilation has different compiler settings and passed. No new Passport type errors reported.
- Security advisors: no findings on new objects. Existing mutable search_path warnings for `increment_slot` and `decrement_slot` remain.
- `git diff --check`: passed. Root lint is a documented no-op.
- Production builds and browser-assisted flow: not run at this schema checkpoint. No new UI is implemented yet.

**Overall full-project validation: FAIL / incomplete**, despite passing foundation and app checks, for the explicit existing typecheck and provider-mode test failures above.

## Deviations from the plan

This report covers the first implementation checkpoint, not all six slices. Slice 1 remains partial: versioned document records and the complete consumer cutover are pending. The registration bridge explicitly rejects assisted rows until payment/ticket/roster authorization is migrated together. The new completeness validator is not yet connected to checkout.

## Remaining work

Passport editing and shipping geography; assisted checkout and participant uniqueness; organizer waivers/privacy records and acceptance policy; pricing and all operational consumers; optional check-in; secure claiming; full local/browser/release checks. Organizer acceptance policy, claim verification and retention ownership remain release decisions. No commits or push were made.

## Second checkpoint — Passport editor and shipping

Implemented the self/managed Passport editor, optional participant email, split identity/contact fields, Team name, updated gender selections and optional shipping. Existing photo controls and self race totals remain. Self edits synchronize legacy prefill atomically; managed edits cannot overwrite helper profiles.

Local migrations `20260916054023_passport_profile_bridge.sql` and `20260916054358_passport_shipping_address.sql` applied. The shipping migration imports 42,046 barangays from the repository's existing PSGC API source. All parent cities resolve; the largest city's 897 barangays fit the explicit 1,000-row query limit. Geography is a stored snapshot, not a claim that the reference is the latest PSA release. Refresh against the approved current PSA dataset before production activation. ZIP validation checks four digits, not geographic/postal matching.

Validation for this checkpoint:
- Site: 380 tests passed; typecheck passed.
- Backend/shared excluding provider-mode-dependent backend.test.ts: 476 tests passed.
- Focused Passport/shipping/grant tests: 34 passed (included in the broad suite).
- Admin typecheck passed. Earlier admin test result remains 815; not rerun this checkpoint.
- In-app Browser: incomplete save rejected; self Passport saved and persisted after reload; shipping region/province/city/barangay and leading-zero ZIP saved; non-member Passport created and saved with no email; selecting self again retained the helper's original identity/address.
- Security advisors reported only the same two existing search_path warnings. No new findings. Diff whitespace check passed.
- React review applied to effect cleanup, participant switching, error handling and labeled controls. Fixed region-only city choices to expose only province-less cities, avoiding ambiguous same-name municipalities until a province is selected.

**Still PARTIAL.** Registration wizard replacement and server-side Passport completeness enforcement are not implemented in this checkpoint. Assisted checkout, immutable shipping snapshots, waiver/privacy records, claiming, optional check-in and the remaining operational consumers follow. No hosted deployment, commit or push.

## Third checkpoint — self-checkout Passport gate

The public registration route now requires a complete saved self Passport. It displays split names, Team name, independent emergency details and booking email for review. Identity corrections go through the Passport editor. The server independently loads and validates the authenticated runner's Passport before making a new reservation, then writes canonical identity/contact snapshots instead of trusting client values. Existing live registrations retain the duplicate-entry response. Draft storage is scoped to account plus category.

Explicit requests for a different Passport are refused while assisted checkout is disabled. Participant-based uniqueness, helper payment/ticket ownership and organizer acceptance still require coordinated implementation. The legacy wizard fallback remains for compatibility; the public route always supplies the validated Passport.

Validation:
- 382 site tests passed; site typecheck passed.
- 477 backend/shared tests passed across 54 files (backend.test.ts remains excluded for its separate fake-provider configuration).
- New live API test: incomplete Passport plus forged complete custom_data returns 422, with no registration or slot change. A valid saved Passport reaches event validation and a successful test checkout. Stored name/phone come from the Passport, not forged request fields.
- Expiry and concurrent duplicate tests now create complete Passports in fixtures; their real locking and replay assertions passed unchanged.
- An initial deadline test hit a transient 502 while Edge code reloaded; focused rerun and the final full suite passed.
- In-app browser verified saved details, progression to kit options and final review showing Runner/Team name. Browser submission/waiver acceptance was not performed. API test exercised successful checkout in the existing local provider mode.
- Diff whitespace check passed. No hosted deployment, commit or push.

Remaining: assisted booking identity/authorization cutover, organizer waiver/privacy implementation, shipping delivery selection and immutable address snapshots, optional check-in, claims and complete release verification. Status remains PARTIAL.

## Booking owner access preparation — 2026-09-16

Added server authorization for the recorded booking helper in payment-session and payment-verify. Ticket email targets the booking account, with legacy participant fallback. A follow-up migration adds read-only booking access to registrations, payments and add-ons, and extends existing event/organization visibility predicates. Applied locally only. No client ownership write grants were introduced.

Personal race history now explicitly filters by participant account, so wider staff/booker access cannot inflate career totals. Ticket identity only uses the viewer profile as a fallback when the viewer is the recorded participant. Missing participant details never borrow the helper identity.

Validation: 385 site tests passed before two additional ticket identity regressions; site typecheck passed. The focused ticket/history run then covers those additional regressions. Thirteen backend tests passed for booking authorization, function grants and the self-checkout gate. The existing registration-gate run passed 23 tests with eight provider-dependent skips. Diff whitespace check passed.

Limit: assisted checkout remains disabled. The database compatibility trigger still enforces self-only bookings. These checks do not prove a real non-member booking, payment or ticket delivery. Participant-based uniqueness, nullable account references, notifications, admin reports and booking lists still require coordinated changes. Adult waiver acceptance policy is awaiting the user's choice: participant acceptance on the helper device or an organizer-approved representative process. No hosted deployment, commit or push. Overall status: PARTIAL.

## Organizer waiver versions checkpoint — 2026-09-16

Proceeding with the recommended adult flow: the participant personally accepts on the helper's device. The authenticated booking actor remains separate. No representative acceptance mode is enabled by this decision, and no legal text is supplied by the application.

Added organizer_waiver_versions with exact text, database-computed SHA-256 hash, publisher and publication timestamp. Publishing requires authenticated organizer-admin authorization. Stable version IDs support exact retry; changed text or a different organization cannot reuse a version. Client roles have no insert/update/delete grants. Public reads expose published documents only, never participant acceptance records. Applied locally only.

Focused validation: 11 tests passed across organizer waiver publication/access and function grants. Includes wrong-organization denial, anonymous publish denial, exact hash, idempotent retry, and denied edits/deletes. The first local migration attempt rejected a non-immutable hash expression; switched to pgcrypto's immutable digest before the migration successfully applied.

Remaining: admin authoring UI, event version selection, acceptance records, stale-version checkout enforcement and the complete assisted-booking cutover. Existing registration continues using its legacy waiver until those consumers are wired together. Overall status remains PARTIAL. No hosted deployment, commit or push.

Final regression for this checkpoint: 484 backend/shared tests passed across 56 files. Excluded supabase/tests/backend.test.ts because it requires the separate fake-provider configuration; this is not a claim that the excluded suite passed. Diff whitespace check passed.

## Admin waiver publication checkpoint — 2026-09-16

Settings now offers organizer waiver authoring, a required review confirmation, publication and readable version history. Text changes invalidate review and generate a new retry identity. Exact retries retain their version ID. The server action checks the selected organization and admin role; raw database errors are not exposed.

Review found auth_can_admin_org permits editors. Added a follow-up migration requiring actual admin or super-admin authorization inside organizer_publish_waiver. Direct editor RPC rejection is regression-tested, not only hidden in the UI.

Validation: all 821 admin tests passed before adding two focused UI tests; admin typecheck passed. Twelve focused backend tests passed, including editor denial and grants. In-app browser published a non-legal QA sample in the local QA Finance organization and displayed it in version history. No actual participant acceptance occurred. The UI explicitly states that event registration has not switched to this version.

Still pending: event version selection, acceptance records, stale-version enforcement and assisted checkout. Local only; no commit, push or deployment. Overall status remains PARTIAL.

Final focused UI/action tests: eight passed, including review invalidation after edits and read-only publication history. Final admin typecheck and diff whitespace check passed.

## Event waiver binding and self-acceptance checkpoint — 2026-09-16

Admin Settings now lets an organization admin assign one of its published waiver versions to an event. Composite foreign keys prevent cross-organization documents. The RPC and direct-write trigger both exclude editors. Existing null-version events deliberately retain the legacy waiver during rollout; organizer selection cannot revert an event to legacy mode.

Runner registration fetches and shows the selected title/text, submits that version and resets acceptance when loading a draft or receiving a different version. Checkout rejects stale/missing version IDs for configured events. The registration trigger locks the event while checking its selected version and generates canonical acceptance evidence: participant Passport, booking actor, accepting name, document hash, capacity, method and server timestamp. Updates cannot rewrite that evidence. Self-only enforcement remains; no helper is recorded as personally accepting for someone else.

Validation:
- 486 backend/shared tests passed across 56 files; fake-provider backend.test.ts excluded as previously documented.
- Extended live checkout API test passed with an organizer version and canonical acceptance snapshot.
- 387 site tests passed, followed by seven focused wizard tests including version submission.
- Admin full run: 821 passed and two failed due to the newly added action missing from a test mock. Fixed that mock; final ten affected admin UI/action tests passed.
- Final site/admin typechecks and diff whitespace check passed.
- In-app browser assigned the clearly labeled QA sample to the local QA Finance fixed-pass-on event and showed the successful selection. No real legal text or participant acceptance was performed through the browser.

Review: broadened legacy event UPDATE grants could otherwise bypass the admin-only action. The new database trigger closes that route, with a direct editor-write regression test. Null-version compatibility is intentional and is not a claim that every event now requires an organizer-authored waiver.

Remaining: assisted participant uniqueness/account-nullability and notifications, helper booking UI and records, privacy notice/retention decisions, optional check-in, shipping snapshots and full release verification. Local only; no commit, push or hosted deployment. Overall status remains PARTIAL.

## Participant duplicate boundary checkpoint — 2026-09-16

Applied a local follow-up migration that requires a participant Passport on registrations and changes the live-event unique index to (event_id, participant_passport_id). The existing index name remains stable for conflict handling. Payment confirmation's expired-entry check and duplicate maintenance now use the same participant boundary. Added the eventual (booker, participant, idempotency key) retry constraint while retaining the legacy retry constraint during cutover.

A transactional regression simulates a Passport moving to another authenticated account. A second live entry is denied despite the changed account ID. After expiry and creation of a replacement entry, confirmation of the old entry returns conflict and leaves its status and category count unchanged. All simulated identity changes roll back. This is a constraint test, not a shipped Passport claim API.

Audit findings for the remaining coordinated cutover:
- registrations.user_id is still NOT NULL and the compatibility bridge still rejects assisted rows.
- Checkout duplicate lookup and writes still use the authenticated account. These must switch together with the participant selector and accessible-Passport authorization.
- Notification functions fn_notify_on_registration, fn_notify_on_event_change and fn_enqueue_event_reminders assume a participant account; guest recipients must resolve the recorded booker. Reminder deduplication must distinguish multiple participants booked by one helper.
- admin_registration_emails joins Auth through participant user_id and would omit guests. Decide delivery from the recorded booking contact.
- Admin registration/payment views and check-in/kit rosters already LEFT JOIN profiles and can use identity snapshots. kit_release_tx has an explicit snapshot fallback when no profile row exists.
- Existing payment-session/payment-verify authorization and ticket email already recognize booked_by_user_id from earlier checkpoints.

No non-member booking was enabled or represented as tested. The remaining guest-account consumers and UI still need implementation. No commit, push or hosted deployment. Overall status remains PARTIAL.

Validation for participant boundary: the broad run passed 486 tests and exposed one stale migration-order assertion. That assertion incorrectly required every future replacement of the dedupe function to predate the original cleanup. Updated it to inspect the latest function definition installed before the cleanup invocation; later replacements remain valid. All four focused migration-order/participant tests then passed. The initial local migration parse error was corrected before successful application; no hosted migration was edited. Diff whitespace check passed.

## Assisted booking integration checkpoint — 2026-09-16

Local checkout now accepts a complete unclaimed Passport managed by the authenticated booker. No Auth account or invented participant email is created. The helper must have a confirmed account email. A published organizer waiver and explicit participant-on-helper-device acceptance are required. Account-bound Passports belonging to someone else are not accepted through this flow.

Registrations now allow a null participant user_id while retaining separate Passport and booker references. The database bridge validates these relationships and the waiver trigger records canonical participant name, booker, capacity, method, version/hash and timestamp. Duplicate lookup and retry writes use participant identity. Payment billing remains the authenticated booker. Existing self registration remains compatible.

Guest registration/event/check-in notifications fall back to the booking account. Reminder keys distinguish separate guest registrations while preserving legacy self keys. Admin email exports use the booking account. A new local transaction test proves two guest reminders survive repeated scheduler runs without duplication.

The public web flow offers a participant selector for events with versioned waivers. Draft keys include actor, category and participant. Guest forms do not prefill the helper's profile or kit values. The final step names the participant and asks them to accept personally on the helper's device. /bookings lists entries made for others, with payment/ticket links. Profile and event pages expose the new flow. Personal race totals remain participant-only.

Review fixes:
- update_registration_fields_tx used user_id <> actor, which fails open for NULL guest accounts. Replaced with null-safe participant/booker checks and tested unrelated-user denial.
- Another manager of a Passport must not receive the original booker's checkout URL from the duplicate response. The response now omits transaction identifiers unless the caller owns that booking or is its claimed participant. Regression test passed.
- Admin registration types now explicitly allow a null participant account.

Validation:
- 489 backend/shared tests passed across 59 files. Excluded backend.test.ts for its separate fake-provider configuration.
- The live assisted API test booked two different Passports using one helper and the same retry key. They created distinct registrations. Duplicate retries returned the existing entry. Unauthorized Passport access, unrelated ticket reads, unrelated payment verification and unrelated field edits were denied.
- Payment confirmation was simulated through the real database RPC with explicitly QA-signed ticket tokens. Both entries became paid, distinct tokens decoded to their registration/event IDs, and the category count became two. This does not claim a completed PayMongo payment, production signing-secret verification at a scanner, or actual ticket email delivery.
- 388 site tests passed, followed by eight focused wizard tests covering assisted acceptance. Final assisted API test also passed after the duplicate-response access fix.
- Site and admin typechecks passed; diff whitespace check passed.
- In-app Browser: selected the saved QA Elder Participant, verified participant fields plus helper booking email, selected kit size, and reached final review with the personal-acceptance wording. Browser waiver checkbox remained unchecked and no browser checkout was submitted.

The basic assisted checkout path is now available LOCALLY for configured events. Hosted activation remains pending. Still required: full browser payment/QR/kit/check-in journey, optional check-in implementation, shipping snapshots, privacy notices/retention and controlled claims, full admin export/report verification, isolated production builds and hosted rollout. No commit, push or deployment. Overall status remains PARTIAL.


## Non-member PayMongo test journey — 2026-09-16

Status: PARTIAL, local only. Browser used the actual PayMongo TEST checkout and GCash test authorization. No real money was charged. Registration `938b1bb5-1ed0-406c-9e9f-d1b5d13a29ba` belongs to QA Elder Participant without an Auth account. The recorded helper paid and received the ticket. Only the explicitly nonbinding local QA waiver sample was accepted.

Verified:
- Browser checkout quoted entry PHP 1,000.00 + Race Pace PHP 50.00 + processing PHP 15.99 = PHP 1,065.99. Provider test payment succeeded and returned a participant ticket.
- Corrected ticket email delivered to local Mailpit for the helper. It names QA Elder Participant and shows the captured gross PHP 1,065.99. The old message had omitted participant name and incorrectly showed base PHP 1,000.00.
- Admin released the complete size-M kit. Feeding the email QR token to kit lookup subsequently offered reversal, not another release.
- Feeding the same ticket token into the browser check-in station succeeded. Repeating it reported already checked in. Database read-back found exactly one active kit release and one check-in.
- After the helper-read policy fix, the helper ticket shows Collected and locks size changes. Unrelated readers remain denied in the database regression test.
- Registration list/details show the participant name, helper contact email and paid state. Managed ticket navigation now returns to Bookings I manage.

Fixes delivered locally:
- Callback initializes its registration from query parameters and distinguishes unresolved session storage from a genuinely missing registration. This removes the initial false lost-payment message.
- Ticket navigation chooses managed bookings for the helper.
- Email escapes participant names and reads the captured total from a paid payment row, refusing to invent a receipt total when that row is missing.
- Follow-up migration `20260916125500_booker_kit_release_read.sql` grants the recorded booker read access to their booking's kit release. It adds no write permission or global Passport-manager access.

Validation: 392 site tests passed across 44 files; site typecheck passed. Nine focused email/handler tests passed. Nine focused guest-notification/kit-read/function-grant tests passed. Diff whitespace check passed. Focused callback SSR and ticket navigation tests are included in the site total. Review checked the local patches and migration access scope.

Open discrepancies and next work:
1. Processing quote PHP 15.99 differs from the provider TEST response's actual PHP 26.65. Ledger reconciles correctly: 106599 - 5000 - 2665 = 98934 centavos to organizer. Verify the merchant's fee schedule and test-mode behavior before changing the production rate card.
2. Admin registration detail says Total paid PHP 1,000 and its history says Paid PHP 1,000. These use the entry base while the actual captured gross is PHP 1,065.99. Reconcile admin detail, audit history, exports and payout presentation in the next financial reporting pass. Preserve historical audit evidence rather than silently rewriting it.
3. Legacy Bib name wording is still visible in kit/admin screens. Complete Team name presentation and export migration without discarding historical values.
4. QR payload submission was verified; no physical camera scan or printed-paper/PDF output was verified. No CSV file or payout statement was generated in this checkpoint.
5. Optional organizer check-in, registration shipping snapshots, privacy/retention/claims, isolated production builds and hosted rollout remain pending.

No commit, push or hosted deployment. This is not a production-readiness sign-off.


## Admin money reporting checkpoint — 2026-09-16

Local correction complete: registration detail reads payment gross, preserves entry base, shows checkout fee difference, and uses refunded amount for refunded records. Registration CSV appends Captured Gross and Refunded columns without changing the existing Base Amount column. Missing payment figures are unavailable/blank rather than invented from entry base. Follow-up migration adds payment_amount to the security-invoker view and makes future confirmation audits record captured gross with an explicit amount_basis marker. Existing audit rows are unchanged and labeled Payment confirmed / entry base in the UI.

Payout walkthrough found a held statement could not be refreshed from the UI. Added the existing refresh action while settlement stays disabled. Browser refresh of the QA guest event reconciled PHP 1,065.99 gross - PHP 50 commission - PHP 26.65 processing = PHP 989.34 held. No transfer was recorded. The admin registration detail visibly shows PHP 1,065.99 and PHP 65.99 checkout fees.

Validation: initial full admin suite passed 827 tests and exposed two CSV test expectations, corrected; focused final reporting suite passed 45 tests. Initial backend suite passed 492 tests and exposed the old Passport backfill assertion that required booker=participant for every entry. Updated the invariant to allow separately recorded bookers while requiring a Passport and consistent claimed participant. All 17 focused database/Passport/grant tests then passed. Admin typecheck and whitespace check passed. New database test proves charged gross audit and replay idempotency. CSV browser download was triggered but no saved file was located; route-level CSV content tests passed, so actual browser file persistence remains unverified.

Review: existing audit evidence preserved, RLS invoker scope and service-only confirmation grants retained. Pending production checks remain unchanged, including PayMongo fee-rate discrepancy, optional check-in, shipping snapshots, privacy/claims and rollout. No commit/push/deployment.

User proposed group checkout: select own and managed Passports on one registration page, pay once, receive one named QR per participant. Recommended architecture is one booking order with separate participant registrations and atomic capacity reservation/payment confirmation. Own participation should be optional. Price is sum of entries/add-ons plus order-level payment fees; it must not multiply a per-transaction fixed fee by participant count. Separate participant waivers, kit choices, refund allocations and report reconciliation are required. Group checkout is a proposed next scope, not implemented in this checkpoint.
