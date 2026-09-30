# Organization discounts — implementation review

Reviewed the local `codex/org-discounts` diff against staging `70fc678`. Scope includes the new migration/RPCs, provider dispatch and confirmation, checkout components, org-admin actions, reports/exports, and regression tests. No hosted acceptance is implied.

## Stats

- Modified files: 32
- Added files: 19
- Deleted files: 0
- Added lines: 3584 (including new files and documentation at review time)
- Deleted lines: 64

## Findings resolved

| Severity | Finding | Resolution and evidence |
| --- | --- | --- |
| High | A free confirmation must not fall back to a legacy reservation deadline when category places exist but the matching held Passport place is absent. | Require a matching held category/Passport place whenever places exist, then enforce its deadline. Final migration replay and backend suite cover the resulting schema. |
| High | Event repricing could overwrite the discount snapshot. | Exclude frozen discount registrations in the worker and enforce the exclusion in both reprice RPCs. |
| High | A provider rounding cent could be assigned to a zero-value participant. | Assign provider excess only to a positive-gross participant. Retain zero commissions and processor allocations for free lines. |
| High | Actual absorbed processing costs must not create negative organizer proceeds. | Single confirmation parks an invalid capture for reconciliation; new group allocations enforce nonnegative net inside the fulfillment transaction. |
| Medium | Complimentary registrations need cancellation without a zero-value refund. | Use existing cancellation RPC with explicit zero-settlement evidence, capacity release and ticket cancellation. Redemption remains consumed. Browser acceptance passed. |
| Medium | Tablet discount type was clipped and Passport removal had a 36-pixel target. | Responsive field reflow, Lucide X, 44-pixel target. Fresh reviewer scored both resolved, disposition ship. |
| Medium | Mixed free and paid groups reported the entire capture as complimentary for GCash, Maya and QR Ph. | Aggregate payment method now comes from positive-gross allocations. Three regressions reproduce the original defect and pass after correction; free participant rows remain complimentary. |
| Medium | Complimentary Method badges hid their only label because they had no brand marks. | Show text when there are no marks. The regression failed before the fix and passes afterward. |
| Low | New admin route inherited the Dashboard breadcrumb. | Added Discounts title for list and detail paths. Browser readback passed. |

## Verified boundaries

- Admin and tenant checks are enforced in PostgreSQL, not only pages; runner mutations use verified actor identity through service-only RPCs.
- Code-row locking serializes bounded redemption across events. Event-first locking coordinates application, provider dispatch, free confirmation and expiry.
- An uncertain external creation remains locked. Only definitive rejection or provider-verified expiry permits retry/edit.
- Discount amounts are integer centavos; original totals and terms remain available after settlement and refund.
- CSV fields use existing formula-safe encoding. New routes use organization-scoped queries and eligible-Passport search rather than a global directory.
- No application control can supply the authoritative payment amount.

No unresolved implementation finding remains in the reviewed scope. Hosted PayMongo acceptance remains a separate release gate. Local checks and exact results are in the implementation report.
