# Browser UI refinements — PIV review

Date: 2026-09-30. Branch: `codex/browser-ui-refinements`.
Scope: 22 modified application/test files and six new application/test/style files, plus the acceptance plan, evidence and docs ledger. Review included complete changed-file context and the 16 new Hub proposal files.

## Outcome

No unresolved findings in the requested local scope. The change is ready for a scoped commit when requested. It is not a hosted release claim.

## Findings resolved during implementation

1. Converted reservations retain their payment timestamp. Rendering no longer depends on status being `paid`; the regression suite covers a converted entry.
2. The public phone header exceeded 390px when Sign in shared the row. Navigation now wraps below 480px. Its category anchor uses an 8rem scroll margin, verified against the two-row header.
3. Header and bottom navigation overlapped between 640px and 767px. Both now switch at 768px.
4. Larger navigation icons plus labels exceeded the official Button height. The component-specific phone style provides 64px targets and preserves labels at 320px.
5. Long unbroken organization names overflowed beside the new avatar. The existing copy region now permits word wrapping; the 390px page width matches the viewport.

## Data and behavior review

Reservation profile lookups are bounded and deduplicated under the existing authenticated client. Event and organization filters remain explicit. Name fallback excludes Passport placeholders. Managed participants keep their own names and do not inherit the booker's photo. Actual `paid_at` drives the date, including converted reservations; creation time is never substituted.

Personal totals require both the account owner's participant ID and a paid registration in a completed event. Category distances retain fractions. Upcoming/refunded/pending/managed entries do not contribute. The product explains that individual finisher results are not yet recorded.

Screening reads verify the authenticated owner, filter the booking owner, select only presentation fields, and limit records. Mixed paid groups retain rejected participants. Loading and failed reads never appear as a successful zero inbox. Expired payment deadlines remove the payable presentation. Existing request and payment routes remain the authority.

Shared UI primitives and Fieldnotes tokens are reused. New navigation overrides are component-specific. Labels, active route semantics, visible keyboard focus, reduced-motion support and logout behavior are preserved. Home height correction belongs to its grid wrapper; organizer avatars remain separate from featured photography.

## Validation evidence

Runner 537, admin 1,030, backend/shared 854, and shared UI 13 tests passed. Final focused navigation/profile tests passed. Runner/admin/shared UI typechecks, both isolated production builds, Fieldnotes audit, Hub typecheck and four catalog builds passed. Browser checks covered 320px, 390px, 768px, 1241px and 1280px layouts, local auth sign-out, scoped reservation identity/date, primary actions, equal-height cards, organization logos and truthful profile activity.

## Registration inspector follow-up

No unresolved findings. The old top override conflicted with the primitive's centering transform. An unlayered shared rule also defeated its utility width limit. Component-specific sizing resolves both without changing shared Dialog behavior.

| Before | After and evidence |
| --- | --- |
| `top: 6vh` retained a negative half-height translation, clipping the header | Primitive centering retained. Actual 1280×720 bounds: x260, y16, width760, height688. Equal top/bottom gutters. |
| Shared viewport cap expanded the inspector across the page | Component-specific 760px maximum wins over the cap. At 768×640, bounds are x16, y16, width736, height608. |
| Small labels and values separated across a wide row | Labels sit above full wrapping values in two desktop columns and one phone column. Identity, status, payment and submitted fields have separate groups. |
| Full ID and email were truncated | Both wrap and retain copying. The long-name fixture fits 320×568 with a 217px scroll region and visible Close/footer. |
| Only Runner opened the dialog | Noninteractive registration data cells open the existing URL-driven inspector. A native button in the first visible data cell supplies keyboard access. |
| Footer explanation competed with controls for space | Explanation lives at the end of the scroll region. Done and the guarded review action stay visible. Last-field reachability was verified. |

The optional DataTable callback preserves existing link behavior. Selection, modifier clicks, interactive controls and text selection retain their own behavior. No data-table caller changes unless it opts into the callback. Five new tests cover data-cell opening, keyboard opening and selection isolation. The existing 12 inspector tests still protect payment display, add-ons, status precedence, copying and refund/cancellation guards.

Actual Browser acceptance verified category and amount opening, URL readback, Escape, focus return to the native runner button, checkbox selection, fixed controls and internal scrolling. The real refund review opened and returned through Keep it, restoring focus to Review refund. No confirmation action was submitted. The main inspector's money calculations, group participant refund scope and complimentary cancellation contract are unchanged. No backend source or schema changes are required.

See the [implementation report](../reports/2026-09-30-browser-ui-refinements-report.md) for screenshots, local stack boundaries and limitations. Hosted staging validation is a later release step. No unrelated checkout or Hub changes were reverted.
