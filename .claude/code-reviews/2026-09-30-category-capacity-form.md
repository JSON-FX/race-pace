# Category capacity form regression

## Finding and root cause

Hosted acceptance on staging `68bc4d0` reproduced a blocked new open event with two valid 12-slot categories. The form reported “Set total event slots before opening registration.” Its `invalid` memo retained two legacy event-total checks after category capacity became authoritative. The shared validator and server action already validate category slots, so the hidden legacy field must not gate the form.

The fix removes those checks and the now-unused memo dependency. No database, authorization, payment, deadline, or capacity enforcement changes. The server still validates categories and publication requirements; database guards still protect held places.

## Review

Code review passed. No technical issues detected in the two changed application files. Read the complete component and test file, shared capacity validator, server save flow, and database projection/guard migration.

## Validation

- All three new regressions fail against the unchanged staging component and pass with the fix: new open, new almost-full, and coming-soon-to-open with no legacy total.
- Admin: 125 files / 1,007 tests passed. Runner: 70 files / 497 tests passed. Shared UI: 13 tests passed.
- Backend/shared: 821 passed initially; five tests used the default 54522 port instead of the isolated 57522 stack. All five passed after exporting that stack's DB_URL. No application test failure remained.
- Both app typechecks, shared UI typecheck, both isolated optimized builds, and Fieldnotes audit passed.
- Unchanged migration history independently verified: 177 versions, no retired push job or legacy Vault service key. The repository assertion pins port 54522; its identical read-only query was run against explicitly checked local port 57522.
- No schema/function sources changed; the previous clean 177-migration replay remains applicable.
- Hosted retest of this fix remains required after its staging deployment. Full feature acceptance and production promotion remain blocked until all required hosted checks pass.

## Browser tooling observation

In-app Browser's locator fill displayed datetime values without persisting React state. Native `setValue` persisted all dates through rerenders, save, and reload. Opening the browser's native date popup crashed that tab; a fresh tab recovered normally. No application change was made for these automation observations.
