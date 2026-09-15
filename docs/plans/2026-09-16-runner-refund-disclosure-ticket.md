# Runner refund disclosure and owner ticket verification

Scope: public web and related admin policy labels. Preserve all money formulas and existing refund work. No hosted writes, deployment, commit or push.

1. Read the existing organization refund policy through current event/registration queries. Add a reusable runner notice to registration review and payment. Explain none/full-net/flat-fee accurately, including retained processor and platform fees even when no surcharge is added at purchase. Never promise a gross refund or invent missing policy terms. Validate site typecheck and focused query/payment tests.
2. Replace misleading admin Full refund labels with Refund excluding fees, preserving enum values and calculations. Validate existing admin policy tests/typecheck.
3. Investigate ticket_token persistence after refund. Fix confirmed inactive-ticket presentation using an RCA; preserve paid race passes and protect against payment CTAs for terminal entries. Validate focused ticket cases and full site suite.
4. Use Computer to sign in as a dedicated local QA owner. Verify refund notice before payment, paid ticket owner view, My Races navigation, refreshed/refunded ticket state, and another runner's access refusal. Use existing sample records or disposable local test fixtures; no live payments. Record evidence and remaining gaps in the readiness checklist.

No policy snapshot/audit redesign or refund fee calculation changes included. Existing organizations expose policy columns to authenticated readers under RLS. A missing policy displays an explicit unavailable notice. Standalone low-impact copy changes do not require new tests; add tests for policy branching and inactive-ticket behavior.

## Current evidence — 2026-09-16

- Fresh fetch confirmed feature/admin-ui-changes contains origin/main f13f4bb. HEAD8e1321b is one commit ahead and zero behind. No merge/rebase needed; all uncommitted work preserved. No newer main design commits were available. Components use the existing local design tokens and form layout; no separate external design reference was supplied.
- Added published refund policy/retention to existing event and registration queries. Existing authenticated and anon column privileges verified; no schema changes. Notice reviewed for full, none, flat_fee, and unavailable terms.
- Computer signed into a dedicated local QA owner and returned from sign-in to the intended payment page. Notice verified both before Pay and on registration Review before the unchecked waiver. Review-only draft was not submitted.
- Owner registration e242e6a0-5996-4183-b95a-1f9c9edf0e65 in event592bae02-d354-43f6-8572-4090ea4093db. PayMongo sessioncs_a2682e0c73fcd0cdb60dda10 verified livemode=false. Computer Pay → GCash test authorization → provider redirect → /pay/callback → owner ticket succeeded. Ticket correctly showed QA Ticket Owner, OWNER QA and sizeM. My Races showed Confirmed and View ticket reopened it.
- Cross-runner ticket2179ad95-0379-4d9d-8ca6-7f7c1419829c returned not found to this owner.
- Authenticated admin test refund returned pending then both original provider success callbacks reconciled. Refundref_Ron2Fewy4cpCw8bZZLkgePVd: payment100000centavos, actual processing2500, commission0, refunded97500, one refund audit, slots0. Refreshing owner's ticket displayed Registration refunded without QR/print/kit/payment controls.
- Temporary webhook disabled and relay/tunnel stopped. No live money, hosted writes, commits or pushes.
- During review, old /pay bookmarks were found to lack terminal-state guards; related fix tracked in the ticket RCA. Final validation follows that fix.

## Final outcome

All four steps completed locally. Ticket and payment bookmarks now gate controls by registration status. Explicit payment-session refusal never falls back to a stored checkout URL; paid entries recover tickets without offering another payment. Computer verified refunded /pay shows no Pay button and My Races shows Refunded without View ticket.

Final validation: site347tests/34files, admin756tests/92files, both app typechecks, git diff --check. Backend was unchanged in this slice; prior durable-refund gate457passed is not represented as a fresh backend run. No build was run against the live Docker .next bind mount. Full policy query reads and rendering were verified in the browser.

Review found no remaining confirmed defect in this slice. Operational gaps elsewhere in the checklist remain. New review draft contains only local sample data and was not submitted. All external payment activity was provider test mode. Changes remain uncommitted.
