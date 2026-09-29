# Category reservations and pre-screening

Status: HTML prototype approved by the owner on 29 September 2026. Application implementation is underway in the isolated worktree. Staging acceptance and production release remain unstarted.

## Execution contract

The user approved the feature plan on 29 September 2026. The first milestone is an interactive HTML prototype for review. Application implementation follows prototype approval. Preserve existing Fieldnotes page layouts and runner event presentation. Use category forms and a new Pre-screening approvals section; do not redesign unrelated pages.

Worktree: `codex/category-prescreening-prototype`, created from `origin/staging` at `5a53ba7`. Preserve unrelated changes in the original checkout and the Storybook Hub. The feature must follow staging → main, followed by main → staging synchronization.

## Accepted behavior

- Event capacity is the sum of category slots. Remove editable event total; maintain the legacy stored value as a database projection during compatibility.
- Category reservation allocation is part of capacity: 100 total minus 20 reservation equals 80 general slots. Category settings include enablement, separate nonrefundable fee, allocation, sales cutoff, and full entry payment deadline.
- Reservations work during Coming Soon and open registration. Sales cutoff releases unsold allocation to general availability while preserving participant holds.
- Inclusions belong to categories and follow the selected category through runner flows.
- Optional category pre-screening has a required requirement description when enabled. Each own or managed Passport supplies one JPEG, PNG, or WebP image, maximum 10,000,000 bytes, labeled 10 MB. Runner explanation is optional.
- A successfully submitted request atomically holds every requested participant slot. Uploading alone holds nothing. Pending reviews have no automatic expiry. Existing entries are grandfathered when requirements are enabled.
- Approval precedes reservation or entry payment and belongs to the participant/category. It carries into reservation conversion without a second screening.
- Preserve mixed-category groups and managed Passport selection. One group payment becomes available only when every remaining participant is approved.
- Start a fixed 72-hour payment window once the remaining group is approved and its payment path is available. The booker's authenticated email link retains approved Passports and categories. Retries, replays, and resends never extend the window.
- Rejection requires a reason and releases only that participant's slot. They may independently register in another non-screening category subject to new availability; this never resets the original group's timer.
- Requests submitted before reservation cutoff retain their promised review/payment opportunity. If the later deadline conflicts with the full 72 hours, approval requires an organizer extension.
- Release unpaid expired holds only after safe reconciliation of outstanding provider checkouts.

## Current system references

- `apps/web/app/(admin)/events/event-editor-form.tsx`: event-level Coming Soon settings, total capacity, inclusions, save orchestration.
- `apps/web/components/CategoryEditor.tsx`: existing category fields and layout to extend.
- `apps/web/app/(admin)/registrations/`: preserve registration table; add pre-screening approvals.
- `apps/site/components/event/coming-soon.css`, event presentation and reservation routes: retain existing shells and add category actions.
- `apps/site/app/reservations/[id]/ReservationStatusPanel.tsx`: reservation status compatibility.
- `supabase/functions/registrations-checkout/`, `reservation-checkout/`, `group-reservations/`, `reservation-verify/`: admission, payment ownership, grouping and conversion.
- `supabase/functions/coming-soon-delivery/`, `expire-coming-soon-reservations/`: durable notification and expiration patterns.
- `supabase/tests/coming-soon-reservations.test.ts`, `group-reservation-api.test.ts`, `group-reservation-validation.test.ts`: regression extension points.
- Shared validators and Deno copies must stay synchronized. Financial reconciliation statuses must not be reused as pre-screening statuses.

## Milestones

### 1. HTML and Storybook proposal

Deliver category editor, event actions, per-Passport proof form, request states, organizer proof review, and email previews. Use only illustrative local data. Verify desktop/tablet/mobile, keyboard focus, dialog image viewing, disabled/error states, and reduced-motion rules. Catalog forms as proposals, then obtain owner approval before application integration.

### 2. Additive schema and capacity foundation

Create new migrations only. Add category reservation settings/inclusions with new settings off by default. Retain event fields and categoryless reservation compatibility. Backfill inclusions in order without changing category IDs or registration/payment records.

Introduce distinct pre-screening batches and participant applications with org, event, category, Passport, booker, intent, requirement snapshot, private proof path, decision, reviewer, timestamps, and payment deadline. Add explicit column/function grants and tenant-scoped RLS. Model capacity ownership across registrations, provider checkouts, paid reservations, and screening holds without double counting.

Use consistent lock ordering across submission, category updates, decisions, checkout, conversion, payment and expiry. Save categories transactionally with explicit edits/deletions; preserve unseen rows added by another editor. Reject deletion or capacity reduction that invalidates held/paid places. Maintain the legacy event total from the database.

### 3. Submission, review, and private proof

Authenticated operations cover submit, status, cancellation, and organizer review. Verify booker authority for own/managed Passports and each category's org/event. Validate image bytes, MIME/content and maximum size server-side. Store private objects with tenant and participant access rules; authorize signed viewing links. Use resumable upload progress/retry per Supabase guidance. Unused uploads older than seven days are retired under the submission event lock and removed through a retryable private Storage cleanup outbox. Submitted proofs are excluded. Cleanup never releases capacity because upload itself owns no slot.

Submission and slot acquisition are atomic and replay-safe. Decisions are participant-specific and audited. Pending review never expires automatically. Requirement snapshots remain stable across organizer edits.

### 4. Payment, conversion, and notifications

Extend checkout contracts with approved batch identity and category-bound participants. Every single, group, assisted, and managed-Passport backend admission path enforces approval. Retain immutable per-participant reservation fee snapshots and sum heterogeneous fees correctly.

Transfer capacity ownership atomically from application to payment/reservation/registration. Reuse participant/category approval during conversion. Start the 72 hours once, after remaining approvals and payment availability. Guard all late approvals against insufficient deadline duration. Reconcile provider state before expiry releases a held place; handle late callbacks without reviving released capacity or overselling.

Reuse durable email delivery, deduplicate jobs, show delivery failure and resend without modifying capacity or deadlines. Links require authentication and preselect only stored, authorized participants/categories.

### 5. Approved UI integration

Implement approved forms with canonical Fieldnotes controls and Storybook states. Preserve existing page shells. Add category-specific inclusions/actions, own/managed Passport proof collection, pending/partial/rejected/ready/expired states, private proof viewer, and required rejection reason. Render dates in Asia/Manila and amounts through existing integer-centavo money helpers.

### 6. Local validation and review

Run repository CI-equivalent migration replay, grants, tenant isolation, shared and backend suites, both app suites/typechecks, and isolated builds. Run Storybook typecheck/build-all and compare against approved HTML at desktop/tablet/mobile. Review changed admissions and money paths before hosted deployment.

Required scenarios: preserve the active 170-slot event and historical entries/inclusions; last-slot contention; reservation/general allocation during open registration; cutoff releases only unsold allocation; decision replay and conversion without double counting; individual managed-Passport proofs and mixed groups; rejected participant alternative entry; exact 10 MB boundary, invalid/oversized/interrupted/unauthorized upload; unrelated runner/cross-tenant proof denial; fixed deadline across retries/email delay/checkout expiry/late callbacks; existing refunds, receipts, payouts, tickets, check-in and kits.

### 7. Hosted staging acceptance

Deploy the exact reviewed revision to both staging apps and Supabase project `pepbmqomiailnnvvwupz`. Use synthetic staging events and PayMongo test mode. Browser and Computer are first choices; Playwright fallback requires a demonstrated missing capability.

Exercise category setup → per-Passport proof → held places → organizer decisions → authenticated email link → group payment → reservation conversion or ticket. Cover rejection, alternatives, both cutoffs, payment expiry, tenant isolation, and private proof access. Failed or incomplete required checks block production.

Record exact commit, both Vercel deployment IDs, migrations, function versions, provider modes, and acceptance evidence.

### 8. Production promotion and recovery

Immediately before release, repeat read-only production inventory and recovery readiness checks. Promote staging → main only. Apply reviewed compatible backend changes before dependent applications. Use production-safe readbacks, no synthetic production records or automated live charges. Compare against the fresh baseline while allowing legitimate new entries.

If problems occur, stop new feature admissions while preserving existing holds and their review/payment handling. Retain additive schema. Use forward fixes if old backend code cannot understand new holds. Record results and merge main back into staging.

## Planning inventory, not release evidence

Read-only planning inspection found Yalabyalam Backyard Ultra open, 170 event/category slots, one category, 15 paid/6 expired/3 cancelled registrations, no reservations, and eight inclusions. At release, repeat this inventory. Copy inclusions in order; preserve IDs, capacities, payments, registrations, ticket/check-in/kit access. Retain legacy categoryless compatibility in case reservations appear before deployment.

## External implementation references

- [Supabase resumable upload guidance](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
- [Supabase Storage access policies](https://supabase.com/docs/guides/storage/security/access-control)

These are implementation references supplied in the approved plan. Recheck current guidance when implementing network storage.

## Owner clarification: reservation payment

For a category requiring pre-screening, reservation payment is unavailable until approval. The event action says “Request reservation review”; the fee is informational and payable only after approval. A mixed group waits for every remaining participant. This applies during both Coming Soon and open registration.

## Annotation clarification: group holds before payment

Pre-screening submission contains no payment choice. Successfully submitting secures free review holds for all selected participants atomically, including categories without screening. Pending status shows zero due and no enabled checkout. A non-screening participant requires no organizer approval but waits for the group's outstanding required reviews. Own and managed Passports behave symmetrically. The originating category action determines the later checkout route; existing reservation fees remain payable only after required approvals.


### Owner clarification — submission confirmation, 30 September 2026

After a successful submission secures all selected slots, send one durable confirmation email to the verified booking runner. List every own and managed Passport with its category and review status. Explain that payment is not yet due and the 72-hour clock has not started. Do not send separate emails to managed Passports. Enqueue atomically with successful holds, deduplicate retries, and avoid stale pending/hold claims if delivery is delayed beyond a decision. Show delivery status on the request and organizer review.
