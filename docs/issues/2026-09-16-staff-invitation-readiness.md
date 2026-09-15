# Staff invitation readiness — local test findings

Date: 2026-09-16 (Asia/Manila)
Status: the three findings below are fixed locally by `docs/plans/2026-09-16-staff-invitation-fixes.md`. The original failed-test evidence is retained below. See the readiness checklist for the subsequent passing run and remaining deployment limits.

## Executed flow

Invitations and removal were sent through the actual authenticated `org-members` application endpoint, not `auth.admin.createUser` or direct role insertion. Mailtrap sandbox messages were inspected and their actual email links accepted through Computer. The admin form's submit/remove buttons were not exercised end-to-end in this run; its source and existing tests were inspected separately. This boundary must not be reported as a complete admin-form browser pass.

Test organization: QA Trail North 20260915, `31f09849-8f9f-4de4-828d-02124dd90312`, which already has an organizer admin.

| Role | User ID | Mailtrap message | Email acceptance |
| --- | --- | --- | --- |
| Race Kit / claiming | b2bbdf3b-de3f-4be1-942e-3c3c9b244386 | 5704411906 | Browser session established; confirmed timestamp 2026-09-15T19:51:43Z |
| Marshal | 31663d62-9b26-4284-af53-3188eabf2251 | 5704412753 | Browser session established; confirmed timestamp 2026-09-15T19:53:55Z |

Both arrived at `/team` and saw **Organization admins only**. Their navigation correctly offered Race kits or Check-in, respectively. Following that link reached the operational station.

## Findings

### 1. Invitation acceptance always lands on an unauthorized page for operational staff

Expected: claiming → `/race-kits`; marshal → `/check-in`.
Actual: both SMTP invitation links landed on `/team`.

Sources: `apps/web/app/auth/confirm/finish/page.tsx` hardcodes `/team` as its fallback. The token-hash route in `apps/web/app/auth/confirm/route.ts` has the same fallback. `supabase/functions/_shared/orgAdmin.ts` also embeds `next=/team` in manual links.

Fix direction: resolve the caller's role after establishing the session and use the shared capability-based home selection. Preserve safe relative redirects and handle missing/revoked roles. Add regression coverage for both invitation mechanisms and both operational roles.

### 2. Event-specific staff assignment is unavailable through invitations and team editing

Expected: an organizer can limit staff to the event they will operate.
Actual: `InviteMemberForm` sends only email and role. `org-members` accepts no event scope and `setOrgRole` inserts a role without `event_scope`. Both invited users had `event_scope = null`, which authorizes all events in their organization.

Reproduction: an empty local event named QA Unassigned Staff Scope Sentinel was added to North. The invited marshal's event picker included it, alongside the intended North race. `checkin_events` returned two events. The sentinel was removed after the test. Cross-organization event/roster reads returned no rows, so this is missing configurable event restriction rather than cross-tenant leakage.

Fix direction: add an explicit all-events/specific-event choice for operational roles, validate that the event belongs to the organization, and persist scope on invite/edit. Preserve scope during role updates or require a deliberate replacement. Test selection, cross-org scope rejection and immediate restriction changes.

### 3. Existing-user invitations claim an email was sent when no email is sent

Source-confirmed: `org-members` calls `inviteUserByEmail` only for a new auth user. Existing-user requests only assign a role and call `generateLink`, which returns a manual link. `inviteMemberAction` discards the response body and always says **Invite sent to ...**. The form provides no manual link.

This was found by tracing the current flow, not by claiming a second Mailtrap delivery. Fix direction: implement a truthful resend/existing-member experience, expose the intended fallback when delivery fails, and test actual email capture for an existing user. Return sign-in after the one-time invite also needs coverage: the current login offers password or Google, while the invite does not collect a password.

## Passing checks

- Real SMTP invitations captured by Mailtrap and accepted in the browser for both roles.
- Role-specific navigation and station access work after manually leaving `/team`.
- Cross-organization rosters and payments returned no rows for both users.
- Removing each role through `org-members` returned success. An already-established API session then saw zero authorized events. Existing browser sessions redirected to `/no-access` on refresh. The two test users now have zero role rows.
- Endpoint attempts against the separate pilot event returned 403 after removal; this is additional denial evidence, not proof of an own-event mutation transition.
- Existing auth-confirm/invite-form tests: 14 passed across three files. Existing team/orgAdmin helpers: 31 passed across two files. These tests currently encode `/team` as the expected fallback and do not detect the role-specific product failure.

## Setup and environment limits

An initial request used QA Zero Commission Pilot, which has no organizer-admin role. `wouldLeaveNoAdmin` rejected adding non-admin staff. However, `inviteUserByEmail` ran first: Mailtrap message 5704410263 was sent and user `4c3f958c-faf9-4c25-a394-b39a89739da1` was created without a role. Validate invitation preconditions before sending mail to avoid this orphan-invitation state. The orphan has no access and was retained as test evidence.

The next immediate SMTP call hit Mailtrap's per-second limit (550). Sequential invitations spaced by the browser work succeeded. No plan upgrade, mail forwarding, browser security changes or message deletion was performed.

Only local sample identities and sandbox mail were used. No hosted database/function changes, migrations, commits, pushes or deployments. The broader financial-report, notification and deployment checklist remains open.
