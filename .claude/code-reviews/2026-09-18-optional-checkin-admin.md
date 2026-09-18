# Optional check-in and admin operations review

**Scope:** Organization check-in default, event override, scan enforcement, admin station, registration Team Name display and CSV, and focused isolation tests.

**Review result:** No outstanding issue found in the scoped local diff.

Existing events retain required check-in. New events inherit the organization default unless an authorized admin overrides it. The database trigger, not just the form, rejects a marshal or editor changing the setting. The scan transaction locks the event setting before accepting a check-in. Disabled events hide the station while retaining ticket QR and kit release. The organization-setting and event-setting changes are audited.

Cross-organization tests deny reads of draft events, registrations, admin registration details, emails, check-in and kit rosters, and setting audits. The Team Name column and export read the registration's saved `custom_data.team_name` snapshot. They do not relabel legacy `bib_name` values, and the underlying legacy data stays intact.

**Remaining verification:** Deploy the migration before either Next app because both now select `events.check_in_required`. Staging must then confirm an organizer admin can toggle the setting, a scoped marshal sees the disabled station, a scan returns `check_in_disabled`, and QR kit release still works. The local suite does not prove physical camera scanning or hosted Supabase permission behavior.
