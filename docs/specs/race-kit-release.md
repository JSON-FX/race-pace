# Race-kit release — web/admin pilot

Status: implemented and verified locally, 2026-09-16. Hosted rollout pending.

## Agreed behavior

One complete kit per paid registration. Only the runner collects; staff confirm runner presence and the complete contents. Partial kits and proxy collection are outside this pilot. Pending, unknown, submitting or review-required refunds block pickup. Refunded and other unpaid entries cannot collect.

Organizer admins and platform super admins can reverse a mistaken release with a trimmed 3–500 character reason. Editors and Race Kit staff can release, but cannot reverse. Original releases and their frozen contents remain in history. A corrected release creates a new record. Repeated requests never create another active release.

## Authorization and transactions

`kit_releases` has `org_id`, event and registration keys, one unique active row per registration, actor identity, timestamp, recipient name and a frozen shirt/add-on snapshot. Authenticated callers can only read authorized rows; direct mutations and internal RPCs are service-only. Runner access is limited to their own registration. Actor UUIDs survive account removal.

`auth_can_release_kits` checks super-admin status or same-organization admin/editor/claiming roles, including event scope. `kit_release_events` and `kit_release_roster` expose only operational fields. Claiming gains no registration, payment or medical-data grants. Navigation and sign-in home use the new `release_kits` capability. The role picker and Edge role allowlist remain aligned.

The `kit-release` Edge Function verifies the signed-in user, selected event and optional signed ticket. RPCs derive staff permissions from the verified actor. Registration row locking serializes release with refunds and shirt changes. The reviewed kit must still match the server snapshot. Release and reversal append `registration_audit` in the same transaction. Reversal targets an exact release ID; replaying an old reversed release request cannot hand out a new kit.

Collected shirts cannot be edited by the ordinary field-edit RPC, including organizer admins. Reverse first to correct a mistaken handoff; existing time limits still apply. Runner tickets show the collection timestamp and hide shirt changes. Failed collection reads keep changes locked.

## Operator workflow and exports

`/race-kits` provides event selection, runner/bib-name/registration-ID search, kit status filters, 50-row pages, review and confirmation, reversal reasons, and keyboard-scanner/pasted ticket lookup. Signed tickets are verified by the server before release. No camera decoder is implemented in this station.

CSV export uses the same authorization and filters, reads every batch, escapes spreadsheet formulas, and returns an error rather than a successful partial file. Columns include registration ID, runner, bib name, category, frozen shirt/add-ons, status, release UTC timestamp, releasing staff UUID and recipient. The CSV is an active roster; reversals remain in registration history.

## Verification and rollout

See [race-day plan](../plans/2026-09-16-race-day-operations.md) and [readiness checklist](../plans/2026-09-15-web-admin-e2e-checklist.md) for test counts and browser evidence.

Apply `20260915191046_race_kit_release.sql` after the durable-refund migration, then deploy the `kit-release` function and both Next applications. Local migration is applied and recorded. No hosted database, function or Vercel deployment was performed.

Before pilot sign-off: verify the production-domain CSV download, staff invitation delivery/acceptance, intended physical scanner, and hosted deployment parity. Browser sample records and API-created staff accounts do not establish those results.
