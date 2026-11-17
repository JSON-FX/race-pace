# Pay Later production release — November 18, 2026

The owner approved production deployment after reviewing the staging implementation,
receiving all five Pay Later emails, and accepting the hosted PayMongo sandbox payment test.

## Accepted source and staging evidence

- Application revision: `4bb527ab2f93263d04fca22f60dd5959d515c0e8`.
- Feature PR #239; release-controller recovery PR #240.
- Integrated CI `44182181449`: success at that exact revision.
- Release workflow: `44182876135`, attempt 1.
- Staging runner: `dpl_H8gCVKPFpmGd8rxVunVdjj3pMg2L`.
- Staging admin: `dpl_BhtS5nc1nn3r5XstaCCxqiDah9Gj`.
- Both staging release endpoints were rechecked before approval. The production job also
  rechecked staging applications, migration history and function bundles before mutation.
- GitHub environment approval records the owner's authorization and hosted acceptance.

[Staging acceptance](../../.claude/reports/2026-11-18-pay-later-staging.md) covers admin
grants, organization isolation, expiry and the five delivered emails.
[Payment acceptance](../../.claude/reports/2026-11-18-pay-later-payment-acceptance.md)
records the real PayMongo sandbox QR Ph capture, paid QR ticket, accepted staff check-in,
cancel/retry behavior and duplicate protection.

## Production backend verification

Production project `whaqarofxdlzxrelbcrq` reports `ACTIVE_HEALTHY`. All 185 migrations are
installed, including `20261118090000`. All 33 hosted Edge Functions report Active.

| Function | Production version |
| --- | --- |
| registrations-checkout | 47 |
| payment-session | 44 |
| payment-verify | 45 |
| payments-webhook | 44 |
| ticket-qr | 27 |
| check-in | 35 |
| send-ticket-email | 32 |
| send-lifecycle-email | 13 |

Readback confirms row-level security on `pay_later_grants`, SELECT access to the two new
registration columns, and the intended function grants. Anonymous callers cannot execute
the Pay Later functions. Reservation and payment confirmation remain service-role-only.
Admin-facing functions retain authenticated access and enforce their tenant/role checks.

## Payment and email boundaries

Production PayMongo, webhook, Resend, worker and ticket-signing secrets are present and
distinct from staging. Existing captured production payments report `livemode=true`.
No payment or refund was initiated during production verification.

Email provider fingerprints identify Resend and `Race Pace <no-reply@notify.racepace.com.ph>`.
Auth SMTP uses `smtp.resend.com:465` with the production sender. Auth Site URL is
`https://www.racepace.com.ph`. The existing email action base URL is the production alias
`https://race-pace-site.vercel.app`; its release endpoint was verified as production.
No provider, Auth, schedule or secret settings were changed.

The lifecycle email schedule is active every minute. Scheduled responses after function
deployment returned HTTP 200 with `claimed=0`, `sent=0`, `skipped=0`, `failed=0` at
23:50, 23:51 and 23:52 UTC on November 17. Expiry and reconciliation schedules are active;
their recent recorded executions succeeded. Existing email jobs have no due pending or
failed pending deliveries. Zero Pay Later grants existed at the verification snapshot.

All five Pay Later template deliveries were verified on staging. Production verification
does not claim a new delivery of each template without real production eligibility events.
No synthetic production rows, check-ins or payments were created.

## Application rollout

Release workflow `44182876135` completed successfully. Both production applications were
promoted from the accepted revision:

| Application | Deployment | Alias verified |
| --- | --- | --- |
| Runner | `dpl_GxFvt99tv611nzmmTrhRXFhoqRLe` | `https://www.racepace.com.ph` |
| Admin | `dpl_Bbu7srB1KQdqyHapDahL6mhnJ5CT` | `https://admin.racepace.com.ph` |

Alias verification completed at 23:52:14 UTC on November 17 (07:52 Philippine time on
November 18). Independent release endpoint checks returned HTTP 200, the exact source
revision and production project identity for both public aliases. Completed deployment
ledger `7869705215` recorded success. Full evidence is retained in the workflow's
`production-evidence-1` artifact.

An independent backend recheck at `2026-11-17T23:54:02.174Z` matched every recorded
migration and function version, JWT setting and bundle digest. All 33 function candidate
source hashes match the accepted staging artifact.

The owner signed in to production through Ego Lite. Read-only browser acceptance confirmed:

- Registrations exposes Pay Later for the selected organization and event.
- Kibalabag's May 22, 2027 event defaults the payment deadline to April 24, 2027.
- The grant form contains runner lookup and deadline controls, without a category allowlist.
- Desktop, 768px tablet and 390px phone rendering passed visual checks. Tablet and phone
  had no horizontal overflow.
- The form was cancelled without selecting a runner, reviewing or submitting a grant.
- Public home, race directory and Kibalabag event details loaded with existing categories,
  normal Join links, and no broken event-page images. No Join link was followed.

The production admin Pay Later page remains open for the owner. No automated grant,
registration, payment, refund or check-in occurred in production. Money movement and ticket
activation acceptance remain the successfully completed staging sandbox tests.
