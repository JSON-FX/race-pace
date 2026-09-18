# Assisted registration and Race Passport revisions

Status: Implementation started. Identity foundation applied locally; remaining slices are pending. No hosted deployment in this pass.
Date: 2026-09-16. Scope: runner web and admin only.

## Goal and confirmed intent

A signed-in user can book an event for another person who does not have a Race Pace login. The participant receives their own Race Passport record, registration and ticket. The helper can complete the process for runners who need assistance, including elderly relatives.

This is assisted registration, not anonymous checkout. A Race Passport represents a runner; a login represents an authenticated person. Creating a Passport must not silently create credentials, invent an email address or claim that the participant verified an account.

## Proposed defaults and release decisions

The user resolved assisted registration and requested planning for the remaining revisions. The following choices remain assumptions, not approved requirements.

| Topic | Proposed default | Consequence if changed |
| --- | --- | --- |
| Required Passport fields | First name, last name, birth date, Male/Female selection, reachable runner contact number, emergency contact name, separate emergency number and relationship | Changes completeness rules and migration prompts |
| Contact accessibility | Allow a shared household/helper phone, explicitly labeled as such; do not require a unique phone or participant email | Avoids excluding participants without their own device |
| Email | Account email stays verified and read-only for self registration. For assisted registration, the helper's verified email is the booking contact; participant email is optional and never treated as verified | Separate participant identity from delivery and billing contact |
| Shipping | Structured shipping address required only when kit delivery is selected; otherwise optional in Passport | If every entry needs an address, collection and privacy notice must change |
| Team name | Optional; replace the Bib name input with a separate team_name field | No team membership system or fee is introduced |
| Shirt size / blood type | Shirt size required when the event supplies a shirt; blood type optional with Unknown allowed | Do not invent medical details to satisfy a form |
| Fees | Keep existing absorb/pass_on and commission settings; show platform fee separately from PayMongo processing | No new fee or commission introduced; zero-commission pilot retained |
| Scope of booking | Updated by user on 2026-09-16: select multiple own/managed Passports on the registration page and pay once; one registration and QR per participant | Pending group-checkout phase below supersedes the original one-participant checkout target |
| Passport claim | Allow later claim through verified account plus ownership verification; no automatic match by name, date of birth or unverified email | Claim and conflict workflow is security-sensitive |
| Assisted waiver | Record the actual participant's acceptance or an organizer-approved representative process; helper authority declaration alone is not assumed legally sufficient | Organizer policy and review required before assisted registration launches |

Interpret “remove binary and prefer not today” as removing Non-binary and Prefer not to say from new web/admin selections. Do not silently remap historical values to Male or Female. Flag incomplete/outdated data for correction before new registration.

## Current implementation and constraints

- `apps/site/lib/profile.ts`: profile identity is tied directly to Auth user ID; one full_name, bib_name and combined emergency_contact.
- `apps/site/app/profile/ProfileForm.tsx`: Passport readiness currently checks only name and emergency contact. Saving fields is independent of registration.
- `apps/site/app/register/[categoryId]/page.tsx`: requires sign-in and checks the current user's existing event entry.
- `apps/site/app/register/[categoryId]/RegisterWizard.tsx`: prefills profile, asks for bib name, and optionally saves details back. Uses a static waiver.
- `apps/site/lib/wizard.ts`: contains WAIVER_TEXT and field checks. `apps/site/lib/draft.ts` persists the registration draft.
- `packages/shared/src/index.ts`: PROFILE_KEYS, GENDERS, registrationInputSchema and identity snapshot helpers. Deno copy is `supabase/functions/_shared/validation.ts`.
- `supabase/functions/registrations-checkout/index.ts`: authenticates requester and assumes requester is participant. Existing duplicate check uses event_id/user_id.
- `supabase/migrations/20260809100100_one_registration_per_event.sql`: database unique constraint encodes the same assumption.
- `apps/web/components/PsgcAddressField.tsx` and `apps/web/lib/psgc.ts`: existing region/province/city selector and queries. Barangay coverage requires inspection/import work.
- `apps/site/app/pay/[registrationId]/PayPanel.tsx` and `apps/site/lib/payment.ts`: existing gross-up and fee breakdown; server remains authoritative.
- `apps/web/lib/queries/registrations.ts` and registration/payment export routes: participant identity currently comes from user-linked profiles and snapshots.
- Ticket, refund, payment verification, kit release, check-in, notification and payout consumers all need a participant/booking-owner audit.

Inherited architecture: Next.js apps, Supabase Auth/Postgres/Storage, row-level security, privileged Edge Functions and atomic money RPCs. Preserve integer-centavo calculations and organizer isolation. Shared package changes may affect mobile compilation even though mobile screens are outside scope.

## Target user flow

The initial single-participant flow below is implemented incrementally. The pending group-checkout phase extends selection, review and payment to several participants in one order.

1. Sign in and choose Register myself or Register someone else.
2. Select an existing accessible Passport or create a managed Passport for the participant.
3. Complete that participant's required fields. Show a checklist with links to missing fields.
4. Select event options, shirt size if needed, and pickup/delivery when supported by the event.
5. Review participant identity, booking contact, shipping snapshot, organizer waiver and privacy notice.
6. Record the approved acceptance process. A helper must not be recorded as the participant accepting personally.
7. Submit; server validates identity, management access, completeness, event status and capacity.
8. Create a pending entry with the existing expiring slot hold. Only successful payment secures a paid slot. Show the expiry clearly; no permanent unpaid reservation.
9. Generate a signed ticket QR for every confirmed participant, including non-members. Let the authorized helper view, download and print each participant's ticket. Send booking communication to the chosen verified booking contact.
10. Helper sees Bookings I manage; runner sees their own race history. Later Passport claim preserves registration and financial history.

## Data and access design

### Participant versus account

Introduce a runner identity entity independent of Auth, provisionally `runner_passports`. Use a nullable unique claimed_user_id, creator audit field, first_name, last_name, team_name, date_of_birth, gender, contact fields and completeness inputs. Final SQL names must follow repository conventions after a full consumer audit.

Use a separate management relationship between Passport and helper account. Authorization must use that relationship or claimed ownership, not a client-submitted owner ID. Changes go through authenticated, checked operations; clients cannot grant themselves management rights.

Global reusable Passports are identity data, like existing user profiles. Event records remain org-scoped. Organizer staff can see only the participant fields needed for their organization's registrations, not unrelated Passports or another organizer's entries. Marshal access excludes addresses and financial details unless explicitly required.

Registration stores participant_passport_id, booked_by_user_id, immutable booking/participant field snapshots and the selected communication recipient. Preserve legacy user_id until all consumers are migrated. Never repurpose its meaning invisibly. Payment payer, participant, booking actor and eventual account owner must remain distinguishable.

One live registration per event applies to the participant Passport, not the helper. A helper can book themselves and multiple other runners. Idempotency includes authenticated actor and the selected participant; retries must not create duplicate Passports or consume another slot.

Do not expose a global name/email search to helpers. Reuse known managed Passports. Same-name matches may prompt review but must not auto-merge people. Document that identity deduplication cannot be guaranteed from names alone. Claim conflicts or duplicate live entries require a controlled support resolution.

### Structured identity and addresses

- Separate first and last name; derive display full name for compatibility.
- Do not split legacy names mechanically and assume correctness. Keep original display name and ask for explicit completion.
- Add team_name separately. Old bib_name values are not team names and must not be copied into team_name automatically. Bib numbers remain unchanged.
- Separate runner phone, emergency name, emergency phone, relationship and optional relationship detail.
- Store phone numbers as strings. Normalize supported formats without losing leading zeros; validate independently. Do not require uniqueness or a phone OTP subscription.
- Shipping: region, province where applicable, city/municipality, barangay, ZIP code, house/unit/building and street/address line. Store geographic codes plus labels in registration snapshots.
- Validate geographic parent-child relationships on the server. Handle cities without a province and reset descendants when a parent changes.
- Use Philippine Standard Geographic Code (PSGC) data for geography. ZIP is a distinct field, not inferred from a PSGC code. Keep it as a four-digit string; verify authoritative mappings before adding ZIP lookup.
- Do not add a courier integration or delivery fee unless separately specified. If delivery selection does not exist, implement the event option explicitly before conditionally requiring shipping.

### Non-member ticket QR — confirmed requirement

Every confirmed event registration gets its own signed QR, regardless of whether the participant has a login or has claimed their Passport. Bind the QR to the participant registration and event, never just to the helper account. Reuse the existing ticket-signing format and verification path; do not create a weaker guest QR mechanism.

The helper can retrieve and print each authorized participant ticket. A participant can present the printed QR without a phone, email account or app login. Staff can retrieve a ticket only within their permitted organization/event scope. No public lookup by participant name or email.

Generate/retrieve tickets idempotently after the existing confirmation transition. A pending unpaid hold must not authorize kit collection or check-in. Scanner validation must check current registration eligibility and event scope, including cancellation/refund rules and duplicate collection/check-in protection. Claiming a Passport later must not create another entry or break its existing ticket.

Keep only the existing minimal signed identifiers in the QR; do not embed names, phone numbers, addresses or emergency details. Include the participant name and event on the human-readable ticket so helpers can distinguish multiple tickets.

### Optional organizer check-in — confirmed requirement

Organizers can choose whether check-in is required. Disabling check-in must not block registration, payment, tickets, kit release or payout workflows. This applies equally to members and assisted/non-member participants.

Proposed configuration: an organization default copied into each new event, with an authorized organizer admin able to override it per event. Preserve check-in enabled for existing events to avoid changing active operations silently. These configuration defaults are planning assumptions; optional check-in itself is user-confirmed.

- Show a clearly labeled “Require event check-in” toggle in event settings, initialized from the organization default. Changing the organization default affects new events only.
- When disabled, hide event check-in actions and runner instructions. Show “Check-in not required” in event details and operational reports instead of treating runners as missing or reporting a misleading zero attendance rate.
- Keep registration-bound ticket QRs available. Kit release uses its own collection state and remains usable without event check-in.
- Enforce the setting in the check-in Edge Function/RPC path as well as the UI. Reject new check-in writes for disabled events with an explicit check_in_disabled response; do not affect kit-release writes.
- Preserve historical check-in audit records when a setting changes. Do not erase records or mark everybody checked in automatically. Historical records can remain visible with their recorded timestamps.
- Audit any attendance-dependent eligibility, reporting or completion rules. Disabled check-in means attendance was not measured, not that all participants attended or failed to attend.
- Record setting changes with actor and timestamp. A marshal cannot change the setting. Show an operational warning before disabling an event that already has check-in records.

### Waiver and privacy records

Each organization authors and publishes versioned waiver text. Events reference a published version; publishing a replacement never edits an accepted historical document. Block new checkout if the relevant waiver is missing or the submitted version became stale.

Store document version/hash, participant, booking actor, actual accepting person/capacity, acceptance method and timestamp. Store required evidence for an approved offline/assisted process without collecting unnecessary identity documents. Do not assume any relative can waive an adult's rights. Organizer approval and legal review determine the permitted representative process.

Privacy notice is separate from the event waiver. Explain collected fields, purposes, organizer sharing, retention, support contact and rights. Keep optional marketing consent separate and unchecked. Record the notice version and any consent actually required by the approved processing basis; a checkbox alone is not compliance.

Implement scoped access, export minimization, access/correction requests and controlled deletion/retention handling. Financial records must follow the approved retention policy rather than being blindly deleted with a Passport. Protect emergency/medical information and exclude it from logs and ordinary ticket QR payloads. Decide who handles privacy requests and the retention schedule before launch.

References: [Data Privacy Act](https://privacy.gov.ph/data-privacy-act/), [implementing rules](https://privacy.gov.ph/implementing-rules-regulations-data-privacy-act-2012/), [data subject rights](https://privacy.gov.ph/data-subject-rights/). These inform engineering controls; final notices, legal bases and waiver enforceability require organization-specific review.

## Implementation slices

Execute in order. Each slice gets a focused implementation/review checkpoint. Do not combine schema rollout and production activation before validation.

### 1. Contracts and migration foundation

- Audit all uses of profiles.id, registrations.user_id, PROFILE_KEYS and participant email, including RPCs and row-level security.
- Create follow-up migrations through `supabase migration new`; never edit hosted migration versions.
- Add Passport and management records, split contact/name fields, versioned waiver/privacy records and participant registration references.
- Backfill one Passport per existing account with explicit incomplete flags; preserve registrations and financial IDs.
- Add explicit grants/revokes and row-level security. Use compatibility reads until all consumers move.
- Add scoped tests under `supabase/tests/` and shared validator tests.
- Validate: `pnpm exec vitest run supabase/tests/function-grants.test.ts` plus new migration/backfill/access tests against local Supabase.

### 2. Passport and address editing

- Update `apps/site/lib/profile.ts`, ProfileForm, shared validation and the Deno validation copy.
- Add a pure completeness evaluator shared where possible, with mirrored server validation tests.
- Reuse admin PSGC patterns for runner address fields; add required geography data/imports if barangays are missing.
- Add management UI to select/create/edit accessible participant Passports with large labels and clear error summaries.
- Keep form drafts scoped by actor, participant and event; avoid exposing a previous user's saved personal data after logout/account switch. Define expiry/cleanup of persisted drafts.
- Validate: site tests and typecheck; test whitespace-only inputs, legacy data, shared phone, no personal email, independent emergency number and address cascading.

### 3. Assisted checkout and slot integrity

- Extend registration input with participant ID and document versions. Resolve the booking actor exclusively from authentication.
- Enforce participant completeness and management access before any new reservation/payment session.
- Replace user-based duplicate logic with participant-based constraints, expiry handling and atomic transitions. Preserve payment replay/refund rules.
- Save registration snapshots and explicitly chosen booking contact; billing identity must identify the actual payer.
- Ensure payment-session, payment-verify, refunds and ticket access accept only authorized booker/participant/organizer roles.
- Validate new backend tests for concurrent bookings, final slot contention, expired holds, retry replay, tampered participant IDs and helper booking multiple runners.

### 4. Organizer waiver and privacy UX

- Add organization-level draft/publish UI and event version selection. Restrict changes to authorized organizer admins.
- Replace WAIVER_TEXT with the selected published document. Version changes require explicit renewed acceptance.
- Build assisted acceptance only after its policy is approved; do not silently bypass waiver requirements.
- Add separate privacy notice and evidence records, plus a clear support path for correction/access requests.
- Validate stale-version rejection, cross-org denial, missing-waiver block and accurate accepting-person audit.

### 5. Pricing and operational consumers

- Show entry price, selected add-ons, shipping charge only if separately configured, Race Pace platform fee, PayMongo processing and total before payment authorization.
- Explain organizer-absorbed fees without adding them to the runner total. Show zero platform fee honestly for the pilot; do not label PayMongo charges as Race Pace commission.
- Preserve method-specific integer rounding and authoritative payment-session calculations. Method changes refresh the quote.
- Update runner tickets/history, helper bookings, admin registrants, kit release, check-in, reports and exports to distinguish runner from booker.
- Add the organization default and per-event check-in setting, server enforcement, status labels and audit history described above.
- Keep emergency changes current where safety requires them while preserving historical financial/name snapshots according to existing policy.
- Validate fixed/percent commission, zero commission, absorb/pass_on, refunds and payout totals; no unrelated fee redesign.

### 6. Passport claiming and release validation

- Claiming requires verified login plus a controlled ownership check. No automatic takeover through an email string or knowledge of a name/birth date.
- Define management revocation/continuation on claim. Recommended default: runner chooses whether helper access remains; booker retains only necessary transaction access.
- Claims cannot create duplicate event entries, rewrite payer history or silently merge conflicting accounts. Provide a support path for participants without email.
- Validate claim replay, expired claim links, unauthorized access and existing-account conflicts.
- Run full web/admin checks and local backend suites using the appropriate test provider configuration. Keep test-mode callbacks separate from live provider credentials.
- Run production builds in isolated directories so Docker's .next bind mounts are not damaged.
- Use the in-app Browser for the complete assisted journey and a self-registration regression.
- Apply reviewed backward-compatible hosted migrations, deploy functions and apps, then run hosted test-mode smoke checks before enabling assisted registration.

## Validation commands and acceptance checks

Standard commands:

```sh
pnpm --filter site test
pnpm --filter site typecheck
pnpm --filter web test
pnpm --filter web typecheck
pnpm exec vitest run supabase/tests/function-grants.test.ts
# Run each new backend test file explicitly, then the applicable full backend suite.
# Production builds run from an isolated copy, never in the live Docker bind mount.
```

- [ ] Helper books a non-member without creating a fake email or sharing credentials.
- [ ] Participant receives a separate Passport and ticket; helper's own race totals do not increase.
- [ ] Two confirmed non-member entries booked by one helper produce distinct registration-bound QRs.
- [ ] Authorized helper can download/print each QR; non-member can use the printed ticket without signing in.
- [ ] Non-member QR works for permitted kit release and check-in; wrong-event, ineligible and duplicate scans are rejected.
- [ ] Payment callback retries and later Passport claims preserve one registration and a usable ticket.
- [ ] Unrelated accounts cannot retrieve non-member tickets; QR payload contains no personal contact data.
- [ ] Helper can book two distinct participants for the same event; the same Passport cannot have two live entries.
- [ ] Missing required participant details block direct API calls and UI checkout before reserving a slot.
- [ ] Expiring holds and successful-payment confirmation retain current capacity guarantees.
- [ ] Phone, emergency relationship, split names, team name and structured shipping survive editing and authorized exports.
- [ ] Historical gender, bib names and full names are preserved without false conversions.
- [ ] Waiver belongs to the correct organizer and records the actual acceptance capacity and version.
- [ ] No unrelated organizer/helper can read or edit Passport data, download tickets or initiate refunds.
- [ ] Fee breakdown reconciles to the server charge and reports in centavos, including zero commission.
- [ ] Later Passport claim preserves bookings, history and financial ownership.
- [ ] Enabled events retain the existing check-in workflow for members and non-members.
- [ ] Disabled events permit registration, payment, ticket QR retrieval and kit release without check-in.
- [ ] Direct check-in API calls are rejected when disabled; unauthorized staff cannot toggle the setting.
- [ ] Reports distinguish “not required” from zero attendance and preserve earlier audit records.
- [ ] Changing organization defaults does not silently change existing events.
- [ ] Self-registration, refund recovery and kit release continue to work.
- [ ] Hosted email delivery is configured before relying on emailed claim links or tickets.

## Scope exclusions and release decisions

No anonymous checkout, multi-runner payment cart, courier API, SMS provider, automatic identity matching, medical eligibility decisions, mobile UI redesign or new commission policy. “Elderly” does not imply incapacity; assisted booking remains participant-centered.

Before execution, confirm proposed defaults, acceptance/representative policy, claim verification procedure and privacy retention ownership. This is a high-complexity change because account identity currently doubles as participant identity throughout authorization and payments. Start with the schema/consumer audit, then implement the slices above; a label-only patch would leave incorrect ownership and duplicate-entry rules.

## Amendments

- 2026-09-16 — User explicitly requires QR generation for non-members. Added signed registration-bound tickets, helper download/print access, staff scanning and regression criteria. Planning only; not yet implemented.
- 2026-09-16 — User requires optional organizer check-in. Added proposed organization defaults/event overrides, independent kit release, server enforcement and reporting criteria. Planning only; not yet implemented.

## Implementation checkpoint — 2026-09-16

- User authorized PIV implementation. Added local Passport/manager tables, restricted grants and policies, account provisioning and registration compatibility references.
- Added shared/Deno completeness contracts and tests. Existing checkout remains self-only until all participant-dependent consumers are migrated.
- Slice 1 is **partial**: waiver/privacy records and the remaining consumer audit are still pending. Slices 2–6 are not implemented.
- See [foundation specification](../specs/participant-passport-foundation.md) for the compatibility boundary and remaining cutover work.

## Passport editor checkpoint — 2026-09-16

- Added self/managed Passport editing to the runner profile. Split names, Team name, separate contacts/relationship, Male/Female options, optional email, shirt and blood type fields are available.
- Added structured shipping selection using 42,046 barangays from the existing repository's PSGC source. Every barangay resolved to an existing city before import. ZIP stays a separate four-digit string; no postal-code mapping or delivery service is implied.
- Added database validation for complete optional shipping addresses, geography references and permitted column writes. Self edits synchronize legacy prefill; managed edits never overwrite the helper.
- In-app browser verified incomplete-field rejection, saved self details after reload, structured shipping save, and a non-member save without email.
- Checkout still uses the legacy self-registration wizard. Server completeness enforcement, assisted slot booking, registration snapshots and the other slices remain pending. Passport editing is available locally; no hosted deployment.

## Self-checkout gate checkpoint — 2026-09-16

- Implemented required saved-Passport checks in the public registration page and checkout Edge Function.
- Canonical identity/contact fields now override client-submitted values in registration snapshots.
- Added Passport review with Team name and booking email. Drafts are scoped by account and category.
- Verified no slot/registration write on incomplete Passport; valid test checkout, expiry and duplicate protections pass.
- 382 site tests and 477 backend/shared tests passed; site typecheck passed. In-app browser reached final review.
- Assisted registration remains disabled until participant uniqueness, helper/payment/ticket access and organizer waiver handling are coordinated. No hosted deployment.

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


## Pending phase: multiple Passports, one checkout payment

**User requested addition: 2026-09-16. Status: architecture baseline documented, implementation pending.**

User confirmed same category for everyone on 2026-09-17. See [group checkout architecture](../specs/group-checkout-architecture.md) for order ownership, atomic capacity, fee allocation, refunds and delivery boundaries.
This supersedes the earlier one-participant-per-checkout scope. Retain individual participant registrations underneath a shared booking order. Existing single-participant bookings must continue to work.

### Registration-page experience

- [ ] Replace the single Passport summary with a participant list. Select the account holder's Passport and any authorized managed Passports. Add or edit a managed non-member Passport from this flow without losing selected participants or draft kit choices.
- [ ] Show selected participant count and a completeness status for each Passport. Prevent duplicate selection and reject existing live entries for the same event. Default recommendation: selecting the helper's own Passport is optional.
- [ ] Collect shirt size, add-ons and applicable delivery details for each participant. Preserve separate immutable identity and shipping snapshots. Never copy the helper's details over another participant.
- [ ] Review names, per-person entry/options, participant count, combined price, Race Pace fees and processor fees before payment. Retain organizer-specific waiver evidence for every participant under the agreed acceptance method. One helper checkbox must not falsely attest that all participants personally accepted.
- [ ] After verified payment, show “N tickets” with one named QR ticket per confirmed participant. Provide individual view/print/download actions and a combined ticket-list view for the booking helper. No payment QR may substitute for a participant ticket.

### Order, payment and slot integrity

- [ ] Design and document an organization-scoped booking order with immutable participant line items and a single provider payment. Keep one registration, ticket, kit-release status and optional check-in state per participant. Confirmed boundary: one event and selected category per order; mixed categories and organizations are excluded.
- [ ] Validate access, Passport completeness, event eligibility, waiver version and duplicates for every line on the server. Reserve the entire requested quantity atomically, or reject the order without leaving partial holds. Holds expire together; only verified payment confirms tickets.
- [ ] Compute the total from the sum of participant entry prices and add-ons, then apply configured commission and payment processing rules in integer centavos. Preserve commission per entry and the zero-commission pilot. Charge a provider fixed transaction fee once per payment, not once per participant. Show the combined gross-up clearly for pass-on events.
- [ ] Make order creation and payment confirmation idempotent. Bind the provider amount to the immutable order total. Duplicate callbacks must not allocate extra slots or issue new registrations. Define safe late-payment behavior after expiry; never silently deliver fewer tickets than paid for.
- [ ] Generate distinct signed QR tokens only after the shared payment is confirmed. Every token identifies its own participant registration. Deliver the ticket collection to the verified booker and preserve individual participant access when applicable.

### Refunds, admin and reporting

- [ ] Define deterministic centavo allocation of commission and processor costs across participant lines. Line totals must sum exactly to the order ledger. Do not duplicate order gross across every registration in reports or payouts.
- [ ] Support refunding one selected participant or the full order, with explicit handling of nonrefundable provider fees. Cancel/release only affected registrations and slots. Preserve other participants' tickets and enforce cumulative refunds against the amount actually captured.
- [ ] Show booker, order reference and individual participants in admin. Extend registration/payment exports and payout calculations with order-level versus participant-level amounts. Keep organizer isolation and existing single-entry historical reports intact.
- [ ] Keep kit release, duplicate-scan handling and organizer-optional check-in independent for each participant. A group payment must never mark all participants collected or checked in when only one QR is scanned.

### Acceptance and validation gates

- [ ] Browser: select self plus two managed non-members, complete each Passport/kit/waiver, pay once in PayMongo test mode, then verify three differently named tickets and three distinct QR tokens. Repeat with guests only.
- [ ] Backend: insufficient capacity creates no partial order; concurrent buyers cannot oversell; incomplete or unauthorized Passports fail; duplicate participant selection and existing event entries fail; retries and repeated callbacks create no extra payment or ticket.
- [ ] Money tests: fee absorb/pass-on, percent/fixed/zero commission, provider fixed fee charged once, rounding reconciliation, failed/cancelled/expired checkout, late confirmation and single-line/full-order refunds.
- [ ] Admin: scan one participant twice, release one kit, refund another participant, and verify unaffected entries remain valid. Reconcile registration/payment CSVs and payout totals to the single provider charge without double counting.
- [ ] Run site/admin typechecks and relevant full test suites, backend authorization and payment tests, and an in-app browser walkthrough. Record evidence and unresolved discrepancies before hosted activation.

Dependencies: participant Passport and assisted registration foundations, organizer waiver versions, authoritative payment ledger, and the pending shipping/optional-check-in designs. Before implementation, finalize the order schema, refund allocation rules and migration compatibility as a dedicated PIV implementation slice. No group-order code or hosted changes are authorized merely by this planning entry.


## 2026-09-17 internal group foundation checkpoint

Added scoped order headers, immutable registration order links and category-locked capacity accounting shared with legacy checkout. Unexpired pending registrations now reserve capacity; oversized multi-row writes roll back. Legacy payment-session rejects order-linked registrations. See [foundation plan](2026-09-17-group-order-foundation.md) and its validation report. Public atomic group reservation, payment/refund coordination and participant-selector UI remain unimplemented. No hosted deployment.


### 2026-09-17 atomic group reservation slice

Implemented the [reservation API plan](2026-09-17-group-reservation-api.md) locally. One verified booker, up to ten unique Passports, one category, per-person kit/waiver/identity snapshots, server-priced add-ons, atomic slot holds and stable idempotent replay. Public entry point stays disabled. Next: combined pricing and payment attempts, atomic confirmation and financial allocations; then refunds/reports and grouped UI/ticket delivery.
