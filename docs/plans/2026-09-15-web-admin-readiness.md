# Web and admin readiness audit

Date: 2026-09-15
Status: in progress; not approved for launch
Scope: runner website (`apps/site`), admin console (`apps/web`), and their shared backend. Native mobile is excluded.

## Acceptance journey

1. Platform staff provisions two separate organizations and their admins.
2. Each organizer creates and publishes an event, with distances, prices, capacity, registration inputs, deadlines, and images.
3. A runner signs up, signs in, searches and browses events, and submits valid registration details.
4. The runner pays through the test provider flow. The callback and webhook produce one confirmed registration and ticket.
5. The organizer sees the same registrant, add-ons, amounts, and status in tables and exports.
6. Staff releases a kit once. A scoped marshal checks in a paid runner once. Unauthorized organizations and staff cannot access either operation.
7. Payment, processor fee, platform commission, refunds, settlement, and payout records reconcile in integer centavos.
8. Reports and exports reconcile with those records under filters and pagination.

For every step record inputs, expected result, observed result, and evidence. Test payment success, failure, cancellation, duplicate delivery, and abandoned checkout. Do not treat a mocked test as proof of provider integration.

## Baseline verified

- Local HEAD: `f13f4bb307a4bd544bb23017d110a1b15d8ed082`.
- Existing user edits: `CLAUDE.md`, admin `app/layout.tsx`; existing untracked guidance, scripts, and registration-deadline investigation. Preserve these.
- Runner tests: 32 files, 322 tests pass.
- Admin tests: 90 files, 739 tests pass.
- Both app type checks pass.
- Both production builds pass from an isolated temporary copy of the working tree, preserving the user's local admin theme edit without touching the development `.next` directories.
- Shared and pure commission/processor arithmetic tests: 6 files, 88 tests pass. Total across these and both web suites: 1,149 passing tests. This is NOT a backend integration pass.
- Browser: runner homepage and event listing render. Listing contains one sample event, Pulangi Half Marathon. Homepage says no races open for entry; deadline behavior still needs current verification.
- Browser: admin login renders.
- Browser: exact Supabase project `whaqarofxdlzxrelbcrq` shows Healthy, latest migration `org_management`.
- A different project, `ytwdrsmclwghwktpupqd`, named race-pace, is paused. Do not restore it as a substitute for the configured database.
- Supabase connector denied project access; browser access works after user login.
- Vercel admin project `race-pace-web`: latest production deployment READY (`dpl_7QMVWBd6Ke7u9WDT7UGpkRVJYFaM`). Browser URL: https://race-pace-admin.vercel.app.
- Vercel runner project `race-pace-site`: newest deployment CANCELED at HEAD; previous production deployment READY at `0f520c5` (`dpl_2t47occ2pdmX1m5UXZH1ic327eg8`). Cancellation alone does not prove an outage or missing runner changes. Browser alias renders: https://race-pace-site-jayson-alananos-projects.vercel.app.

## Discrepancy register

| ID | Finding | Evidence | Next action |
| --- | --- | --- | --- |
| GAP-01 | Race-kit release is not implemented | `apps/web/lib/capabilities.ts` grants no capability to claiming; `team-roles.ts` excludes it from new assignments; runner RaceKitCard describes collection as future work | Design and implement collection records, authorized release, duplicate protection, runner status, and exports |
| GAP-02 | Organizer custom registration-field editor is absent | Event editor has no form_fields editing; runner supports FormFieldRow; roadmap explicitly defers editor | Specify supported field types, validation, editing rules, and export labels, then implement |
| GAP-03 | Public event listing has filter links but no visible text search | Browser `/events`; verify code before implementation | Add or locate search covering event name and location |
| GAP-04 | Public List a race link goes to event browsing | Browser footer links to `/events` | Decide assisted organizer onboarding versus self-service, then give this action a working destination |
| GAP-05 | Roadmap does not reflect implemented admin scope | Dashboard, check-in, organizations, commission, payouts and settlement routes exist despite unchecked roadmap items | Update ledger after behavior is verified |
| CHECK-01 | Production sample super-admin exists with publicly documented seed login | Auth users and repository seed/e2e fixture | Verify access; remove or replace sample access before real launch |
| CHECK-02 | Payment mode, provider callback, webhook delivery, and secrets not verified | Live provider flow not yet exercised | Confirm test mode before attempting payment; reconcile provider and database records |
| CHECK-03 | No hosted backup shown on overview | Supabase overview says No backups | Establish recovery procedure and verify restore before real data launch |
| GAP-06 | Runner signup is blocked by email delivery limits | Clean-browser signup using a Gmail alias returned `email rate limit exceeded`; hosted custom SMTP is disabled and Confirm email is enabled | Configure production email delivery, then verify signup and confirmation end to end |
| GAP-07 | Signup does not distinguish an account awaiting confirmation from an active session | `apps/site/lib/auth.ts` discards signUp data/session; signup page redirects whenever error is absent | Add confirmation-pending UI, resend behavior, and verified callback handling; exercise with hosted settings |
| GAP-08 | Password recovery has no runner route or login action | Route inventory and sign-in UI | Implement request/reset screens and recovery callback, then test expired and reused links |
| GAP-09 | Registration CSV is insufficient for kit and safety operations | Export HEADER has nine fields; no shirt size, custom answers, emergency contact, or check-in/kit status | Add appropriately authorized operational reports and reconcile to registrant details |
| GAP-10 | No dedicated payout/commission export control found | Payout and commission pages plus route inventory; settlement CSV is per event | Specify platform reporting and statement exports separately from event settlement CSV |
| FIX-01 | Auth Site URL was localhost | Hosted URL Configuration showed `http://localhost:3000` | Changed to `https://race-pace-site.vercel.app` through Computer and verified persisted after reload; full email flow still blocked by GAP-06 |
| CHECK-04 | Local backend suite cannot start in its current state | `pnpm exec supabase start` reports already running but `supabase_db_race-pace` is exited | Recover or create an isolated local stack, apply migrations, and run backend/tenant-isolation suite; no hosted test-suite mutations |
| CHECK-05 | Historical local cron targets another hosted project | Existing stopped DB logs and `20260723090700_push_drain_cron.sql` target `ytwdrsmclwghwktpupqd` | Verify current hosted cron targets and isolate local outbound jobs before resuming backend tests |

## Remaining verification and implementation order

1. Finish environment baseline: fresh production builds in isolation, local backend/migration tests, deployed function parity and auth redirects.
2. Exercise organization/admin/event creation through Computer, then tenant isolation with a second organization.
3. Exercise runner account/profile, event discovery, registration inputs, deadlines, capacity, duplicate registration, and ticket access.
4. Exercise payment test mode, refunds, fee modes and commission types. Reconcile ledger before and after payouts and refunds.
5. Implement and verify race-kit release; exercise marshal scoping and duplicate/unpaid check-in.
6. Reconcile registration, payment, settlement, commission and payout reporting. Identify missing operational exports, including kit and check-in reports.
7. Verify responsive screens, error recovery, access boundaries, and deploy exact validated revisions.

## In-progress execution

Admin login succeeded with the existing seed super-admin. Created and published `QA Readiness Road Run 2026` through the admin UI:

- Event ID: `c1e83908-6022-4cc9-9e3b-2a61f0117b98`.
- Organization: Run With Point (`1b042ecf-dff1-4578-adcf-c013cdac581b`).
- Discipline: road; event date 2026-10-25.
- Category: QA 5K (`5K-QA`), 5 km, PHP 1,000, ten slots.
- Registration closes 2026-10-20 18:00 Asia/Manila; kit edits close 2026-10-21 18:00.
- Description explicitly identifies this as a sample, not a real race.
- Admin list shows Open and 0/10 slots. Public homepage shows the event with 5 km, one distance, ten slots after counter animations settle.

Public canonical domain: https://race-pace-site.vercel.app. Verified without a Vercel login in the in-app browser. The account-scoped Vercel alias requires Vercel authentication in a clean browser and should not be advertised as the marketplace URL.

Runner `.test` address was rejected. A Gmail alias signup returned `email rate limit exceeded`; no completed runner signup, registration, payment, ticket, refund, or payout is claimed. Browser extension interference was avoided by moving runner tests to the in-app browser. Production email setup is the next live journey blocker.

Commission page renders current Run With Point terms: 2% commission, absorb processing mode, full refund policy with commission/processing deductions. Payout page renders zero statements. These are UI/read checks with no financial records to reconcile yet.

No application implementation changes, commits, pushes, new deployments, payment transactions, or payout actions were made during this initial audit. One hosted configuration fix and one sample event were saved.

Validation logs: `/tmp/racepace-site-tests.log`, `/tmp/racepace-web-tests.log`, `/tmp/racepace-site-types.log`, `/tmp/racepace-web-types.log`, `/tmp/racepace-site-build.log`, `/tmp/racepace-web-build.log`, `/tmp/racepace-money-unit.log`, `/tmp/racepace-backend-start.log`.

Auth configuration reference: https://supabase.com/docs/guides/auth/redirect-urls.
