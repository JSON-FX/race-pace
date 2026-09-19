# Code Review: Bot protection

## Review Scope

- 41 feature, test, migration, operations, and PIV artifact files changed.
- No files deleted.
- 1,569 lines added and 29 lines deleted in the isolated worktree.

## Review Result

Code review passed. No actionable technical issues remain in the bot-protection scope.

The review found one retry defect in both Turnstile loaders and the Google loader. A failed provider script remained in the document, so later retries could wait forever on an event that had already fired. The loaders now remove failed scripts before clearing their shared promise, and the focused tests and typechecks pass after the fix.

## Security Review

- Provider tokens are validated at server boundaries.
- Google assessments require a valid token, expected action, allowed hostname, and minimum score.
- Organizer limits use salted hashes instead of storing raw IP addresses or email addresses.
- The limiter is atomic and executable only by `service_role`.
- Provider secrets remain server-only and are not present in tracked files.
- Supabase CAPTCHA remains disabled until all updated clients are deployed and verified.

## Reliability Review

- One-time Turnstile tokens reset after failed authentication requests.
- Script-load failures are visible to users and can recover on retry.
- The rate-limit table removes records older than seven days during consumption.
- Provider failures fail closed before organizer email delivery.

## Validation Evidence

- Runner site: 450 tests passed and TypeScript passed.
- Admin console: 886 tests passed and TypeScript passed.
- Mobile focused scope: 8 tests passed and TypeScript passed.
- Edge focused scope: 28 tests passed, including function grants.
- Hosted staging read-back confirmed the limiter table and the service-role-only function grant.
- An invalid staging assessment token returned HTTP 403 before email delivery.
- `git diff --check` passed.

The full mobile and backend suites retain unrelated failures documented in the implementation report. They do not exercise the new bot-protection paths.
