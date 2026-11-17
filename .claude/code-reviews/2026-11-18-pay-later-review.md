# Pay Later code review

Scope: application, shared contracts, forward migration, Edge Functions, email rendering/delivery and focused tests on `codex/pay-later`.

## Stats

Stats exclude this review and the implementation report to avoid counting generated review prose.
- Files modified: 34
- Files added: 27
- Files deleted: 0
- New lines: 3013
- Deleted lines: 77

## Result

Code review passed. No unresolved technical findings detected in the reviewed scope.

Backend review traced organization/user authorization, explicit grants, immutable deadlines, atomic inventory allocation, screening transfer, prepared/dispatched payment expiry, verified capture cutoff and late-payment reconciliation. Database regression tests cover concurrent last-slot attempts, replay, cross-organization/editor rejection, add-on rollback, screening rejection and unpaid check-in denial.

Application review traced own-Passport registration, approved screening links, ordinary/group flow preservation, frozen fee display, exact deadline rendering, payment callback invalidation and paid/expired ticket behavior. Admin server actions verify active organization and admin role before invoking database authorization.

Email review confirmed escaped HTML/text, confirmed recipients, bounded leased jobs, stable delivery idempotency keys, retryable failures and stale-state suppression. Independent backend review rechecked the final worker fixes and found no further issues.

## Resolved findings

| Finding | Correction | Evidence |
| --- | --- | --- |
| Approval email could survive an ordinary registration | Suppress after any pending/paid runner entry for the event | Focused worker regression |
| Delayed approval email could prompt registration after admission closed | Check event status and admission cutoff before delivery | Focused worker regression |
| Payment prompts could be sent for suspended organizations | Recheck organization active status | Focused worker regression |
| Early event closure could display a missed future deadline | Separate closure and deadline reasons | Reservation-card regression |
| Unpaid discard conflicts with immutable grant history | Hide unsupported discard for Pay Later | Ticket-panel regression |
| Screening help mixed admission and deferred payment dates | Conditional copy separates both deadlines | Six focused screening tests |
| Dialog expanded to desktop viewport | Scoped width cap overrides shared dialog safety rule | Actual browser verification |
| Canonical table header fixed height overlapped wrapped mobile email | Auto-height mobile cells and scoped padding reset | Browser verification and focused tests |
| New native alert/table markup failed required audit | Use canonical shared components | Audit: zero remaining sites |

See the [implementation report](../reports/2026-11-18-pay-later-report.md) for checks and release boundaries. Local fake-provider success does not establish hosted PayMongo or production acceptance.
