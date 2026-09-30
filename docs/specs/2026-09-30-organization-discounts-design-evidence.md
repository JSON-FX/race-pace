# Organization discounts: design evidence

September 30, 2026. Local application evidence only. This records the finish review of the approved [organization discounts scope](2026-09-30-organization-discounts.md).

## Authority and preservation

This feature extends Fieldnotes and the existing Race Bib checkout. It does not establish a new visual direction. The checked authorities are:

- Storybook Hub `projects/race-pace/PRODUCT.md` and `projects/race-pace/DESIGN.md`, under `/Users/jsonse/Documents/development/storybook-hub`.
- [Fieldnotes component contract](2026-09-27-fieldnotes-components.md).
- [Race Bib single-registration contract](2026-09-23-race-bib-single-registration.md).

The Hub product contract separates local illustrative examples from application integration and release. Its design contract keeps operational controls, semantic colors, clear status text, mono identifiers, and canonical shadcn primitives. The application contract preserves page foundations while adopting those primitives.

The discount surfaces preserve the existing operational palette, interface typography, rounded controls, and bordered panels. Single checkout keeps the photographic masthead, progress rail, ticket-like panel, and pale race summary. Savings appear beside the relevant participant or in the payment summary. Free entries explicitly state that no payment details or fees are required.

No new tokens, imagery, or motion were introduced by these surfaces. Existing imagery belongs to the Race Bib shell. Application UI modules continue to reexport canonical primitives from `@race-pace/ui`; checked examples include Button and NativeSelect. No unexplained visual-direction drift was found in the checked scope.

The isolated application worktree has no root `PRODUCT.md`, `DESIGN.md`, or `.impeccable` directory. The existing authority is in the Hub project. Those files, including `projects/race-pace/.impeccable`, were preserved. No replacement design system or sidecar was created.

## Checked application sources and states

| Source | Recorded behavior |
| --- | --- |
| `apps/site/components/checkout/DiscountCodeField.tsx` | Labeled code input, Apply and Enter submission, busy lock, inline error alert, applied savings, optional organizer fee coverage, Remove, and payment-lock explanation. Eligible locked checkouts expose a close-checkout action. Feedback has a polite live region; errors use an alert. The input and Apply controls are 44px high; Remove has a minimum 44px target in both dimensions. |
| `apps/site/app/pay/[registrationId]/PayPanel.tsx` | Itemized discount deduction and updated subtotal within the existing Race Bib payment step. Zero totals replace payment methods with “Your entry is free” and “Confirm free registration.” The free state suppresses the payment security note and refund notice. |
| `apps/site/app/group/order/[orderId]/GroupOrder.tsx` | A code field belongs to each participant. The summary combines savings and uses explicit free-booking copy. The prepared free state offers confirmation without payment details. Completion shows “Booking confirmed” and separate ticket links. Loading, blocked, expired, and cancelled states remain explicit in source. |
| `apps/web/app/(admin)/discounts/workspace.tsx` | Regular shared codes and unique special-code batches; percentage/flat amounts; scope and coverage; optional Manila dates; fee absorption; Passport search, assignment, and unassignment. Busy, success, error, empty, scheduled, expired, inactive, fully claimed, and active states have explicit text. The table separates redeemed, reserved, and remaining uses. |

This source inventory is broader than the screenshot coverage below. Source inspection does not establish that every state received a browser or assistive-technology check.

## Responsive evidence

Files are local captures in `/tmp/racepace-discounts-evidence`. Dimensions below were checked from the image files. Each listed image was visually inspected for this document. The supplied capture-gate result passed the corrected capture set.

| Surface | Capture dimensions | Evidence files | What the images establish |
| --- | --- | --- | --- |
| Single checkout, desktop | 1440 × 1000 | `checkout-desktop-viewport.png` | Existing masthead and two-column Race Bib composition; applied free code, savings, and zero balance. The bottom action is outside this viewport. |
| Single checkout, tablet | 768 × 1024 | `checkout-tablet-real-top.png`, `checkout-tablet-real-action.png` | Race summary moves above the main panel; payment sections stack; free confirmation remains visible in the lower capture. |
| Single checkout, phone | 390 × 844 | `checkout-phone-top.png`, `checkout-phone-action.png` | Masthead and progress rail fit the narrow layout. The lower capture shows applied savings, free-entry explanation, and the full-width confirmation action. |
| Admin, desktop | 1440 × 1000 | `admin-desktop-fixed.png` | Two-column special-code form, fee absorption, and expanded Passport assignment within the existing admin shell. |
| Admin, tablet | 768 × 1024 | `admin-tablet-fixed.png`, `admin-unassign-fixed.png` | The amount sits below its type selector, leaving “Percentage off” readable. The assignment capture shows the selected Passport and enlarged unassign control. |
| Admin, phone | 390 × 844 | `admin-mobile-fixed.png` | Single-column form and readable type selector. The image covers the upper form, not every field or the full table. |
| Group free booking, tablet | 768 × 1024 | `group-free-tablet.png`, `group-confirmed.png` | Prepared summary shows a ₱2,500.00 discount, ₱0.00 fees, and ₱0.00 total. The next capture shows confirmation with two individual ticket links. |

Use the `real` tablet and `phone` checkout files named above. Earlier alternate captures in the evidence directory are not the responsive baseline for this record. Captures show local example accounts and event data; they are not production evidence.

## Finish review

The fresh finish reviewer reported **ship** after two corrections: the admin discount-type selector no longer truncates at the checked widths, and icon-only removal targets meet 44px guidance. The amount/type pair stacks below the wide desktop breakpoint. Passport unassignment and checkout removal use explicit minimum target dimensions. The reviewer reported no regressions from those corrections.

The saved detector output at `/tmp/racepace-discounts-design-detect.json` is `[]`. This is a clean result for that detector run, not proof of complete accessibility or release readiness. This documentation pass inspected the corrected sources and images; it did not rerun the interactive review.

## Storybook and remaining limits

The checked Hub snapshot is `projects/race-pace/src/discounts/`. Its `Fieldnotes/Contexts/Discounts` stories cover code entry, applied, complimentary, payment-locked, and organizer-workspace examples. The stories label their example data and local fixture actions. Their service replacements do not establish working server mutations, payment closure, or financial correctness.

Group screenshots cover the tablet free-summary and confirmation states only. They do not establish complete desktop/tablet/phone verification of the group participant rows or every payment state. The listed captures also do not establish dark-mode, keyboard-only, screen-reader, or every error-state acceptance.

No hosted staging or production acceptance is claimed. Backend correctness, automated validation, provider behavior, and release evidence remain separate gates. The screenshots and detector output are temporary local artifacts; retain them separately if this record must remain reproducible after `/tmp` cleanup.
