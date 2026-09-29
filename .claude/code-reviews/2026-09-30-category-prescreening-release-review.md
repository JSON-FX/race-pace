# Category reservations and pre-screening release review

Scope: the isolated feature branch from staging `5a53ba713bdf6288178e4bd195f366e0f5939bff`. Review covers category capacity and persistence, approval-gated admission, private uploads, own/managed groups, reservation/payment conversion, provider expiry, notification delivery, application forms, and compatibility migrations. This review does not establish hosted acceptance.

## Stats before this report

- Files modified: 49
- Files added: 71
- Files deleted: 0
- New lines: 6,315
- Deleted lines: 437
- Binary additions: prototype artwork, three licensed image decoder modules and three image fixtures.

## Findings corrected

1. **High — provider dispatch versus expiry.** Reservation checkout previously prepared its request without the common event lock. `20260929184246` serializes request dispatch, validates actor/generation/deadline and preserves the original request clock. Regression includes a two-connection race.
2. **High — promised payment terms could disappear.** Disabling reservation settings could clear fee/deadline while review holds remained. `20260929184550` preserves those terms and rejects event cutoff reductions that break ready windows. Regression assertions failed before the correction and now pass.
3. **Medium — reservation retry route and display.** Status could redirect to an expired provider URL and display a newly edited category fee. It now re-enters verified checkout and renders immutable participant fee snapshots.
4. **High — mixed-category direct reservation deadline.** A checkout used the latest participant deadline rather than the earliest. `20260929185924` separates the checkout bound from conversion deadlines and sends late direct captures to reconciliation. The regression failed before the correction.
5. **High — group cancellation left screening claims.** `booking_order_cancel` closed entries but retained screening holds. `20260929190608` releases those applications only after safe checkout cancellation and preserves the fixed deadline. Regression failed before the correction and now passes.
6. **Medium — expiry queue starvation.** Unbound provider work could repeatedly fill the oldest page. `20260929191739` rotates checked candidates while maintaining event-before-reservation locking. It does not release unresolved holds.
7. **Medium — unused proof retention.** The same migration retires unused upload tickets after seven days and queues private Storage deletion. Submission and cleanup share the event lock; referenced proof is excluded. Failed deletion stays queued. Tests confirm submitted proof and capacity remain unchanged and retired tickets cannot submit.
8. **Low — cancelled request showed a payment deadline.** The status view now shows the pay-by section only for ready batches.

## Security and compatibility evidence

- Tenant grants, anonymous denial, unrelated runner/reviewer proof denial, own/managed Passport ownership, exact 10 MB image validation and immutable proof objects are covered by the backend suites.
- A clean 177-version migration replay passed. Legacy fixture upgrade preserved a 170-slot category, all 24 registration IDs/statuses/amounts/ticket tokens, eight ordered inclusions and 15 paid capacity claims.
- Final local suites: backend/shared 826; runner 497; admin 1,004; shared UI 13. Both application typechecks and isolated builds passed. Fieldnotes found zero unresolved controls or duplicate primitives.
- Browser exercised mixed groups, free holds, proof review, rejection, alternative category without timer reset, cancellation, responsive layouts, focus containment/restoration and payment logos. Mailpit captured booker-only participant-list submission and approval email.
- No hosted writes or live charges were performed during this review.

## Release blockers outside the local source review

- Hosted staging exact-commit deployments and full PayMongo test-mode acceptance are still required, including conversion, refunds, receipts, payout, tickets, check-in and kit regressions.
- Reduced-motion runtime acceptance remains open. A 20-megapixel image-decoding limit is disclosed in the form; owner decision on that extra limit is pending.
- Recheck production inventory and recovery readiness immediately before any promotion. Preserve additive schema and use forward fixes if new holds exist.

No unresolved confirmed code defect remains from the findings above. Production promotion is blocked until the required acceptance evidence is complete.
