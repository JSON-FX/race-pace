# Registration identity disappears

Observed in the local browser walkthrough: QA Local Runner was entered in the form, but its paid ticket and organizer roster showed no name. The wizard omits full_name from custom_data and only saves kit fields to profiles. Ticket, admin views, check-in, and settlement read profiles only. Existing tests populate profiles, hiding this new-runner path.

Assessment: high operational impact, medium complexity, high confidence. Registration ownership remains correct; staff cannot reliably identify the runner.

Decision: persist entered full_name alongside the existing bib snapshot. Operational displays prefer non-empty registration identity, with profile fallback for legacy entries. A later profile edit must not rename an earlier entry. This extends the existing snapshot policy explicitly to identity. Profile save-back stays optional and best effort. No migration rewrites historic data or changes authorization.

Plan: repair wizard serialization and optional identity save-back; add a shared identity resolver; use it in ticket and settlement; follow-up migration updates the two security-invoker views and guarded check-in roster. Preserve grants and RLS. Add snapshot/legacy/isolation tests and repeat browser registration without saving a profile. Payment billing and email provider setup remain separate work; no deployment or commit requested.

## Verification

Implemented locally with follow-up migration 20260914213000. Existing applied migrations remain unchanged. Site suite: 323 passed before two additional optional-save cases; the final focused wizard suite passes all 5 cases. Admin suite: 739 passed. Shared identity, admin views, check-in roster, and function-grant checks: 11 passed. Both app typechecks and diff whitespace checks pass.

Browser: created dedicated confirmed local test account runner-identity-20260915@example.com. Submitted QA Snapshot Runner / SNAPSHOT QA with profile saving OFF, then completed fake payment. Registration 0cd4949d-affb-47ef-95a8-6081cc51d4e2 is paid. SQL confirms both profile name fields are still NULL and the registration snapshot contains both names. Ticket, admin registrations, admin payments, and check-in roster show the submitted identity. This specifically reproduces and resolves the original no-profile path. Earlier test registration's lost full_name cannot be recovered automatically; no invented backfill was applied.

Remaining: payment-provider billing still reads the profile, ticket-email configuration and delivery reporting remain open, and hosted application/migration deployment has not been performed. Settlement identity mapping is updated, but full export reconciliation remains a separate checklist item.
