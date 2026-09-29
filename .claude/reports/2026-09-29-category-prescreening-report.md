# Implementation Report — Category reservations and pre-screening

**Plan:** `docs/plans/2026-09-29-category-prescreening.md`
**Branch:** `codex/category-prescreening-prototype`
**Status:** Local release candidate. Hosted staging acceptance and production promotion remain incomplete.

## Completed locally

- Owner approved the HTML/Storybook proposal and authorized application implementation.
- Added category reservation settings and inclusions; copied legacy event inclusions unchanged.
- Added separate review batches, participant applications, private proof upload records and storage bucket.
- Added shared capacity projection across registrations, unresolved checkout sessions, reservation places and review holds.
- Added atomic submission/review, fixed group payment windows, deduplicated notification jobs and tenant checks.
- Added database-owned event capacity and atomic category saves preserving unseen concurrent additions.
- Added entry admission guards and heterogeneous category reservation fees with immutable snapshots.

## Latest validation — 30 September 2026

All feature work remains isolated from the shared checkout. No hosted mutation has occurred at this checkpoint. Local Supabase uses API 57521/database 57522.

- Frozen dependency install passed. Both application typechecks and isolated production builds passed.
- Runner: 70 files / 497 tests. Admin: 125 files / 1,004 tests. Shared UI: 13 tests and typecheck passed.
- Backend/shared: final run passed all 101 files / 826 tests after the maintenance changes.
- Clean replay: 177 migrations, zero retired push jobs and zero legacy service-role vault keys. The local assertion uses the repository's exact queries with an explicit isolated-port guard for 57522.
- Legacy upgrade rehearsal: reset to the 159-version baseline, insert a synthetic 170-slot event with 15 paid, 6 expired and 3 cancelled registrations and eight inclusions, then apply the feature migrations. All 24 registration IDs/statuses/amounts/ticket tokens, category identity/capacity and inclusion order/content survived. New feature flags stayed off; capacity claims remained 15. This rehearsed through version 176; the independent 177-version clean replay adds only maintenance fairness and unused-proof cleanup.
- Fieldnotes audit: 316 modules, zero unresolved controls and zero duplicate primitives. Storybook: 19 proposals, typecheck and all four catalog builds passed.
- Actual local browser: own/managed mixed categories, resumable image proof, upload alone creates no capacity claim, atomic two-slot submission, pending payment disabled, private organizer image, approval and combined PHP800 reservation readiness.
- Actual local browser: managed participant rejection requires a reason and releases only that participant. A new no-review category request succeeds without changing the original group's payment deadline. Cancellation releases remaining free holds.
- Actual local email delivery: Mailpit captured submission and approval notifications. Submission goes to the booking runner only and lists all selected participants.
- Responsive checks: desktop status and two-column proof dialog, tablet status at 768px, mobile status and scrollable proof dialog at 390px. No horizontal overflow. Keyboard tab containment, Escape and focus restoration passed for the review dialog. All five payment logos loaded.
- Local PayMongo is intentionally unconfigured. Provider-unavailable handling retained both holds and the fixed deadline. No actual provider payment or hosted sign-in acceptance is claimed.
- Local fixture cookies bypassed the sign-in form because CAPTCHA was not configured for the isolated build. They are not sign-in acceptance evidence.

## Added integration

Admin category controls and review table use canonical Fieldnotes controls. Runner request/status pages distinguish free screening holds from paid reservations. Private proof verification decodes image bytes and signs short-lived authorized URLs. Category inclusions are shown per selected distance. Email jobs use the existing leased outbox, deduplication, and visible delivery status.

The runner now reads aggregate category availability from the same capacity-claim ledger used by checkout. Published events expose only counts, never participant records. General registration and reservation actions respect their separate pools, including pending review holds. Existing paid reservation places retain their conversion path when general availability reaches zero. The request form disables full categories and explains immediate payment readiness when no selected Passport needs review.

The provider retry review identified that uncertain creation cannot be replayed beyond PayMongo's 24-hour idempotency retention. Reservation requests now have a persisted request clock and a conservative 23-hour retry limit. Replaced, provider-confirmed terminal sessions retain an audit history. Old-session captures route to reconciliation. Group retries preserve order/participant expiry. The 72-hour batch deadline never changes.

## Remaining release gates

- Publish the reviewed commit and staging PR; require exact-commit GitHub CI.
- Reduced-motion runtime acceptance, final application/Storybook comparison and the disclosed 20-megapixel proof limit decision.
- Hosted staging: exact commit, both apps, migrations/functions/workers, tenant/private-proof tests, PayMongo test payments, conversions, refunds/tickets/kit regression, and delivery evidence.
- Production inventory/recovery checks, staging-to-main promotion only after every required acceptance passes, production-safe readbacks, and main-to-staging sync.

## Final review corrections

- Serialized reservation provider dispatch against expiry with the common event lock.
- Preserved promised reservation terms and ready payment windows against organizer edits.
- Re-entered verified checkout on retries and displayed immutable per-participant reservation fees.
- Bounded mixed-category direct reservation checkout by the earliest entry deadline; late captures enter reconciliation.
- Released screening claims when the related group order is safely cancelled; hid payment deadlines on closed requests.
- Rotated expiry candidates so unresolved provider work cannot starve later holds.
- Added a private cleanup outbox for unused proof uploads older than seven days. Metadata is retired under the same event lock as submission before Storage deletion. Submitted proof is excluded; failed Storage deletions retry. Cleanup never releases capacity.

## Recovery controls

`CATEGORY_ADMISSIONS_PAUSED=true` on the submission and reservation checkout functions stops new feature requests. Existing request replays, approved batch payment, organizer review, reconciliation and expiry continue. Do not roll back to backend code that cannot count screening holds. Keep additive schema and fix forward.

The new `prescreening-maintenance` worker uses the existing payment-expiry secret. Hosted scheduling and secret readback are not yet performed. Keep the existing reservation-expiry and durable-email workers running.

## Implementation limits to review

Superseded on 30 September: the owner removed the custom 20-megapixel limit. The final contract is 10,000,000 bytes (10 MB), with private native Sharp verification and native codec safeguards. Actual hosted 48 MP PNG/JPEG and exact-byte-boundary uploads passed; see docs/operations/category-screening-release-20260930.md.

Local Supabase and both Next applications use isolated ports to preserve unrelated development work. No feature scope or production-safety gate has been waived.

## Owner feedback — 30 September

The first application status screen did not match the approved prototype. Restored its scoped Fieldnotes canvas, typography, panel widths, spacing, avatar initials, status icon, dotless badges and date/time hierarchy. Restored official GCash, Maya, Visa/Mastercard and QR Ph artwork in the payment selector. Applied the same approved anatomy to Passport selection, the proof dropzone, explanation and next-step forms. Email delivery errors remain visible; normal delivery details use the canonical Collapsible control.

Owner requested a submission confirmation and chose one email to the booking runner listing every selected Passport. Migration `20260929111000` queues that email in the successful hold transaction. Replays do not duplicate it; failed submissions enqueue nothing. All-no-review groups receive the ready email instead. Delayed confirmation mail cannot claim pending approval or secured places after decisions have changed the request. No additional participant email addresses are used.

Local Mailpit captured the actual delivery with both Alex Reyes (pending approval) and Mika Reyes (no review needed), one recipient, and no payment deadline. The delivered HTML is available at `docs/previews/category-prescreening/submission-email.html`. Hosted delivery is not yet validated.

The submission email is now the nineteenth Storybook proposal. Hub typecheck, all four catalog builds, local Docker publication and browser render passed. Storybook reports zero accessibility violations, four passes and one inconclusive check; this is not a complete email-client accessibility audit. Temporary local session-bootstrap services were stopped after testing; their disposable scripts are removed before the commit.

The organizer proof dialog now follows the approved two-column anatomy at desktop width. Its signed image has fit/zoom and full-image actions, with runner, category, requirement, explanation, and decision controls alongside it. Browser comparison passed for the approval table and desktop dialog. The category editor has no horizontal overflow at 768px or 390px; mobile reservation controls stack cleanly. The local database reset removed synthetic review fixtures, so a fresh fixture is needed for final mobile dialog acceptance.

The isolated database replay now contains 172 migrations, including a public aggregate availability function. An anonymous Data API call returned category pool counts without participant data. A local open event showed both review-gated entry and reservation actions after category settings were enabled. Browser inspection found both actions visible on a narrow viewport without horizontal document overflow. This local event uses synthetic test data; no hosted record changed.

Earlier dated paragraphs above describe intermediate visual checkpoints. The latest validation section supersedes their test and migration counts.
