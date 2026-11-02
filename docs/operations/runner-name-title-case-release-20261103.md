# Runner name Title Case release

Date: 2026-11-03 (Asia/Manila). Status: staging and production verified.

## Source and approval

- Name normalization: [PR #234](https://github.com/JSON-FX/race-pace/pull/234), commit `03948d4`.
- Build compatibility: [PR #235](https://github.com/JSON-FX/race-pace/pull/235), commit `688b248`. The exact-version pnpm patch backports the upstream Google font URL fix; font families and styling are unchanged.
- Deployed source: `7ef0d8948dde675a1e9976bdb200484b2b5297db`; tree `609eaa3ff62678e7ad7fccb7985a27e5a86bb636`.
- [Integrated CI 41480200161](https://github.com/JSON-FX/race-pace/actions/runs/41480200161) passed all six checks. Local verification passed 2,724 tests, both app builds and required typechecks.
- [Release 41481303652](https://github.com/JSON-FX/race-pace/actions/runs/41481303652), attempt 2, completed staging and production successfully. The owner explicitly approved this exact candidate after reviewing staging evidence in Codex. The protected approval comment records the affected-flow results and the Google-login limitation.

Attempt 1 completed the staging backend but timed out on a Vercel API read before any application deployment. All jobs were rerun under the documented recovery procedure. No protection was bypassed. Active Option B uses main as integration and does not require a staging branch push or sync-back. This documentation follow-up does not alter the deployed application source.

## Applications

| Application | Deployment ID | Environment | Source |
| --- | --- | --- | --- |
| Staging runner | dpl_6D1hd4YBDBjHHB7Go5iufkqWvDst | staging | 7ef0d89 |
| Staging admin | dpl_97WWLu7892L4pnbQjZzPQRBdF2ta | staging | 7ef0d89 |
| Production runner | dpl_ALqLqth4FN2JVfBeNDUsBUa2CvFF | production | 7ef0d89 |
| Production admin | dpl_G4NC1UKwFPH9Hb5HEJQKQxs5Zhfq | production | 7ef0d89 |

Both apps are Ready in each environment and own the expected aliases. Production endpoints `https://www.racepace.com.ph/api/release` and `https://admin.racepace.com.ph/api/release` both return the deployed source and production Supabase project `whaqarofxdlzxrelbcrq`. Staging reports project `pepbmqomiailnnvvwupz`. The controller verified project roots, environment fingerprints and live alias ownership.

Durable successful deployment records: [staging 7497671120](https://api.github.com/repos/JSON-FX/race-pace/deployments/7497671120), [production 7498133628](https://api.github.com/repos/JSON-FX/race-pace/deployments/7498133628). Their payloads retain exact configuration, migration and function digests. Workflow artifacts `staging-evidence-2` and `production-evidence-2` retain full JSON readback for 90 days.

## Database repair and preservation

Both environments have all 183 migrations, including `20261102143802_runner_name_title_case.sql` (SHA-256 `a2cd1a876601d64c4174c3e8aff60084b49e7ae7c572185b453bce575c1a6a74`). Applied history was not edited.

The production backfill corrected 109 existing name values:

| Table | Existing rows | Values needing conversion before | Values needing conversion after |
| --- | --- | --- | --- |
| profiles | 125 | 20 | 0 |
| runner_passports | 311 | 36 | 0 |
| registrations | 100 | 47 | 0 |
| event_reservation_places | 87 | 3 | 0 |
| prescreening_applications | 126 | 3 | 0 |

All 902 stored string name values are canonical. The checked non-name content and row counts remained unchanged across all five tables. Canonical hashes exclude only the targeted name fields and update timestamps; registration JSON retains all other keys. The SQL sample `JUAN DELA CRUZ` returns `Juan Dela Cruz`; anonymous formatter execution is denied. No synthetic data, live payment, waiver submission or profile edit was used in production verification.

## Hosted acceptance

Staging Browser saved `JUAN` / `DELA CRUZ` through the real Passport form. Saved fields, profile banner and the admin Users row returned `Juan`, `Dela Cruz` and `Juan Dela Cruz`. The banner has computed `text-transform: none`. Runner and admin passed desktop 1280, tablet 768 and phone 390 checks with no document overflow.

Uppercase Auth metadata rendered in Title Case through the account-list fallback without rewriting provider metadata. An explicit incoming profile write normalized at storage. Auth provisioning creates a blank Passport; profile rows are written when identity details are saved. All disposable staging accounts and their own Passports/profiles were removed with deletion readback.

Production Browser used the existing authenticated admin session for a read-only Users check. A formerly uppercase name from the reported screen now displays in Title Case with Google as its existing sign-up method. The public runner page loads with fonts loaded. The actual Google OAuth handshake was not exercised; the owner approved release with this limitation stated.

[Published source and hosted review](https://github.com/JSON-FX/race-pace/pull/235#issuecomment-6582168602). Local Browser screenshots and aggregate verification JSON remain in the task worktree; no real runner email or profile details are copied into this document.

## Edge Function inventory

All 33 affected function source digests and JWT settings match staging. Hosted bundle digests are retained separately in both successful deployment payloads; source identity is not represented as a remote bundle hash. No provider, Auth URL, CAPTCHA, webhook or schedule configuration changed for this feature.

| Function | Staging version | Production version | Verify JWT |
| --- | --- | --- | --- |
| admin-group-refund | 15 | 19 | true |
| admin-refund | 17 | 36 | true |
| check-in | 16 | 33 | true |
| coming-soon-delivery | 8 | 7 | false |
| coming-soon-subscribe | 7 | 6 | true |
| discount-checkout | 7 | 5 | false |
| expire-coming-soon-reservations | 10 | 9 | false |
| expire-paymongo-checkouts | 19 | 21 | false |
| group-order-cancel | 7 | 6 | true |
| group-payment | 19 | 21 | true |
| group-payment-prepare | 16 | 19 | true |
| group-reservations | 12 | 19 | true |
| group-ticket-delivery | 18 | 20 | false |
| kit-release | 15 | 19 | true |
| org-members | 20 | 36 | true |
| org-provision | 21 | 26 | true |
| organizer-inquiry | 16 | 15 | true |
| payment-session | 28 | 42 | true |
| payment-verify | 27 | 43 | true |
| payments-webhook | 27 | 42 | false |
| platform-users | 11 | 11 | true |
| prescreening-maintenance | 9 | 7 | false |
| prescreening-proof | 8 | 5 | true |
| prescreening-submit | 7 | 5 | true |
| reconcile-payments | 6 | 4 | false |
| registrations-checkout | 28 | 45 | true |
| reprice-event-checkouts | 17 | 13 | true |
| reservation-checkout | 10 | 9 | true |
| reservation-verify | 10 | 9 | true |
| send-lifecycle-email | 15 | 11 | false |
| send-push | 9 | 31 | false |
| send-ticket-email | 17 | 30 | false |
| ticket-qr | 15 | 25 | false |

## Recovery

The controller rechecked accepted staging after approval, applied the compatible production backend, verified production-configured app candidates before moving domains, then promoted both apps and recorded alias readback. Prior production runner: `dpl_D5JrH6v8yPwbPN4zf5qquBbC34x8`; prior admin: `dpl_GqecEmNPk9ob2koicALYcdD4UcVY`. Application rollback uses the protected runbook and explicit owner authorization. Applied database migrations require a forward fix.
