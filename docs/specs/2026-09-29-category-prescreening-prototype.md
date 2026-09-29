# Category reservations and pre-screening: design proposal

Status: approved by the owner on 29 September 2026. This prototype is the visual implementation contract.

Canonical HTML: [interactive preview](../previews/category-prescreening/index.html). [Responsive review](../previews/category-prescreening/responsive.html). [Implementation plan](../plans/2026-09-29-category-prescreening.md).

## Visual scope

Reuse Fieldnotes forest green, warm neutral surfaces, existing admin sidebar, compact labels, rounded inputs and category cards. Preserve the runner photographic event presentation. New UI is limited to category settings, per-Passport proof, request status, organizer review, and email previews. The prototype represents unrelated sections compactly; their application layouts are not being redesigned.

Category settings progressively disclose reservation allocation/fee/deadlines and pre-screening requirement fields. Inclusions are inside the category. A derived summary replaces total-event input. Capacity math appears next to its controls.

Runner forms retain own and managed Passports, with a category and proof per selected participant. The form separates uploading from submission and explains exactly when a place is held. The group status lists independent decisions with one group payment summary. Rejected participants retain a distinct alternative-category action.

Organizer approval uses a separate table under Registrations, with search/category/status filters. The proof dialog pairs the image with the requirement snapshot, Passport, explanation, and decision actions. Rejection requires a reason. A conflicting deadline disables approval and links back to category settings.

## State catalog

Storybook title: `Fieldnotes/Proposals/Category reservations and pre-screening`.

Eighteen stories cover event setup, runner event, per-Passport proof, pending review, partial group approval, ready to pay, participant rejected, payment expired, capacity unavailable, organizer approvals, deadline conflict, email delivery failed, empty queue, email previews, mobile form, and tablet editor. Coming Soon/open and upload error cases are interactive Preview states within every story.

## Accessibility and responsive behavior

- Labels, fieldsets, captions, described upload errors, live toast announcements, visible keyboard focus and skip link.
- Native modal dialog supports Escape and returns focus to its opener. Zoom is available by button and keyboard.
- 390px: single-column forms and status, horizontal table scroll, top screen navigation scroll, fixed editor save bar.
- 768px: compact editor without sidebar; runner form with secondary guidance column.
- Desktop: existing admin sidebar/section navigation and side-by-side proof review.
- Reduced motion removes transitions/animations. Allocation width changes are not animated.

## Review before approval

Review the new forms, wording, decisions, and placement. Use sample proof to avoid supplying real runner records. The preview intentionally uses no real event data. Approval must not be read as evidence that capacity concurrency, tenant isolation, image storage, email delivery, or payment behavior has been implemented.

## Verification boundary

Local browser checks cover the interactive proposal. Server admission, private storage, resumable network uploads, transactional holds, durable emails, real authentication, provider reconciliation, migration replay and staging E2E are deferred to the application phase. Production is unchanged by this milestone.

## Owner clarification: reservation payment

For a category requiring pre-screening, reservation payment is unavailable until approval. The event action says “Request reservation review”; the fee is informational and payable only after approval. A mixed group waits for every remaining participant. This applies during both Coming Soon and open registration.

## Annotation revision: free holds and mixed groups

All status badges are text-only; decorative dots are removed. Removed the entry-versus-reservation payment choices from pre-screening submission. The form now has one “Submit & hold N slots” action and explains that submission is free.

During pending review, every active participant appears as “Slot held,” including categories without requirements. The summary shows “Due now: PHP 0” and disabled group payment. Exempt participants say “No review needed,” rather than implying an organizer approved them. Only required reviews enter the pending approval queue. Once all required reviews are approved, the existing later payment route becomes available with the fixed 72-hour deadline.

Added Storybook states for the booker requiring screening with an exempt managed Passport, and the reverse. This clarification does not remove the separate reservation fee after approval or change its existing nonrefundable pricing rule.
