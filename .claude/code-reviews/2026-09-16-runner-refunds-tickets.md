# Runner refund and ticket review

Scope: this turn's runner policy reads/notice, registration/payment insertion, admin policy labels, and inactive ticket presentation. Earlier durable refund changes retain their separate review report.

The notice matches current backend policy: full returns net after processor/platform fees, flat_fee also retains min(configured fee, net), none refuses runner cancellations. Missing terms never imply refund eligibility. Existing RLS and column grants permit policy reads without extra database privileges. No fee calculations or enum values changed.

Ticket review confirmed historical QR token persistence was incorrectly used as current eligibility. The fix requires paid status and a token, hides inactive controls, and offers a refresh rather than payment for paid entries awaiting a token. Provider check-in remains the authoritative paid-only boundary.

Related payment bookmark guard and stale explicit server-refusal fallback were added to the same lifecycle correction. Parent verifies the final implementation and tests before completion.

Design: existing typography, colors, border, spacing, form and button components retained. Main was fetched and has no newer design commits to incorporate. External design alignment cannot be claimed without a supplied current design artifact.

Final follow-up: PayPanel checks terminal statuses before rendering checkout. All explicit server error codes forbid fallback; only unclassified transport failure retains the existing fallback, with current local status/deadline checks. Neutral not_pending text avoids misidentifying refunded/cancelled entries as paid. New regression cases pass, and Computer confirms the refunded bookmark behavior.

Code review passed for this slice. No remaining confirmed technical issues detected. Validation: site347, admin756, both typechecks, whitespacecheck. This is not a production-readiness certification or an external-design approval.
