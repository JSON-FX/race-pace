# Pay Later hosted staging acceptance

Initial application revision: `212b68bd1468e97ffb8c2969aebf7a912c57d098` (PR #239).
Integrated CI: `44177676810`, all checks passed.
Release attempt: `44178631177/1`.

Both Vercel deployments reached Ready and passed exact deployment and alias verification:

- Runner: `dpl_EXz4SuXYpBGPSkDwEC1Arvj8VDSJ`.
- Admin: `dpl_D6PEbbAvN9oBzkWyAUyUGhjEtp4p`.
- Supabase: staging `pepbmqomiailnnvvwupz`, 185 migrations including `20261118090000`.
- Active functions: registrations-checkout v30, payment-session v30, payments-webhook v29,
  send-lifecycle-email v17. Full 33-function version and bundle inventory is in the release artifact.

The final GitHub ledger write failed because its payload exceeded 16,383 characters.
The follow-up controller fix retains verified inventory and leaves full workflow evidence
unchanged. See `docs/issues/pay-later-release-record.md`. This initial workflow did not
enter production; no production approval was given.

## Browser and backend acceptance

Ego Lite authenticated as a new organization-scoped QA administrator. The real grant form
found the user by exact email, defaulted to December 19 for a January 16 event, omitted
category selection, and explained the separate pre-screening requirement. Submission
created one eligible grant. No category capacity was held until reservation.

The same administrator's own-event roster request returned 200; another organization's
event returned 403. Authenticated users cannot call the privileged reservation SQL function;
the service role can, and the deadline SELECT grant is installed.

A synthetic reservation for the designated recipient's existing Passport held one 21 km
slot. The QA clock was advanced only on this new test grant/registration to exercise the
reminders and expiry. The real expiry function returned `expired`, released the slot,
and retained no ticket token. The hosted admin record displayed Expired and released-slot
copy at desktop and 390px mobile widths without horizontal overflow.

## Five email transports

Recipient: support.racepace@gmail.com, explicitly chosen by the owner.
Provider: Resend; environment: staging; public action URLs target the staging runner site.
The protected deployed worker returned HTTP 200, claimed 1, sent 1, skipped 0 and failed 0
for each message. Each outbox job completed in one attempt with no error.

| Template | Outbox ID | Sent at (UTC, November 17) | Worker request |
| --- | --- | --- | --- |
| Approval | c8870ced-6741-46b4-849f-14b54e5f8956 | 21:26:57 | 304233 |
| Reservation | fc1223a5-b90a-434c-b9a2-9a62bc0a64d9 | 21:27:16 | 304238 |
| Seven-day reminder | 586d8514-0486-4ff9-b515-6d5e188c885d | 21:28:00 | 304239 |
| One-day reminder | 567fe9cc-6f41-4e26-a42d-14e5c6586147 | 21:28:17 | 304243 |
| Ticket invalidation | 22425905-5be1-4464-b6e2-9573e5b3edff | 21:28:46 | 304244 |

The scheduled lifecycle worker is active every minute. Reminder delivery was accelerated
for this fixture instead of waiting until 09:00 Philippine time. Its distinct deadlines
are test scenarios, not edits available to normal runners. Resend acceptance is proven. The owner confirmed that all five emails arrived at
support.racepace@gmail.com during this release session. Rendered-client appearance was
not separately inspected in Gmail.

The event and organization are clearly prefixed `[TEST]`. The existing recipient's login
and Passport were not changed. Hosted PayMongo capture/reconciliation still requires the
separate staging payment acceptance before production approval; local fake-provider tests
are not evidence of a hosted payment capture.

## Final recovery verification

The recovery fix merged in PR #240. Final staging revision:
`4bb527ab2f93263d04fca22f60dd5959d515c0e8`.

- Integrated CI `44182181449`: success.
- Release `44182876135`, attempt 1: staging job success; production waiting for owner approval.
- GitHub staging ledger deployment `7867232869`: complete with success status.
- Runner deployment: `dpl_H8gCVKPFpmGd8rxVunVdjj3pMg2L`.
- Admin deployment: `dpl_BhtS5nc1nn3r5XstaCCxqiDah9Gj`.
- Both public `/api/release` endpoints returned HTTP 200 and the exact final revision with
  staging project `pepbmqomiailnnvvwupz` at 2026-11-17 21:50 UTC.
- Migration inventory remains 185, latest `20261118090000`.
- Final active versions: registrations-checkout v31, payment-session v31,
  payments-webhook v30, send-lifecycle-email v18.
- All 33 function candidate-source hashes match the initial tested rollout. Application
  and function source files are unchanged by the recovery fix.
- Final outbox readback: exactly one completed job for each of the five templates,
  zero errors, no pending test jobs. The scheduled email worker succeeded after recovery.
- Owner explicitly confirmed that all five messages arrived.

Full deployment, migration, configuration-digest and function-bundle evidence is retained
in `staging-evidence-1` on release run 44182876135. Production has not been approved or deployed.
