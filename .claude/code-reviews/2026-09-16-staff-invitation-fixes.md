# Staff invitation fix review

Scope: role-aware invitation completion, event-scoped Team management, actual SMTP delivery and resend. Earlier refund/check-in/kit changes in this working tree are separate slices.

Source/test stats against HEAD (includes earlier changes in these shared files): 15 modified, 6 added, 0 deleted; 1304 added lines, 293 removed lines. Documentation excluded.

Code review passed. No blocking technical issues detected in this slice.

- Privileged writes use the service-only `team_member_write_tx` RPC. It verifies the actor, locks the organization, validates event ownership, and preserves membership if validation fails. Concurrent final-admin demotions leave an admin.
- Scope omission preserves the current restriction. Explicit null removes it. Only marshal/claiming roles accept event restrictions.
- Mail is sent after membership is saved. New accounts are created unconfirmed first. Existing accounts use real SMTP sign-in delivery. Resend does not modify their grant.
- The response distinguishes saved access from delivery failure. Failed delivery never produces a sent message; a manual link is shown only when available.
- Both token-hash and fragment flows resolve current capabilities. Old `/team` links send operational staff to their own station. External redirect targets remain rejected.
- A rejected scope edit restores the visible selection. Last-admin checks remain server enforced.

Validation: 782 admin tests; 35 focused backend/helper/grants tests; admin typecheck; isolated Next production build; `git diff --check` passed. The database tests include a second unassigned event in the same organization and a foreign organization. Browser/Mailtrap results are recorded in the readiness checklist.

Limits: the full backend suite was not rerun because unrelated tests consume the nearly exhausted Mailtrap sandbox quota. Failure feedback uses mocked delivery failures; SMTP was not deliberately broken. No hosted rollout, commit or push occurred.
