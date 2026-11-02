# Runner name casing

Reported 2026-11-02 through chat and an admin user-list screenshot. No GitHub issue was supplied.

## Assessment

| Metric | Value | Reason |
| --- | --- | --- |
| Severity | Low | Inconsistent presentation; identity and payment amounts remain intact. |
| Complexity | Medium | Canonical names, historical labels and Google fallback use different paths. |
| Confidence | High | Input, storage and display paths were traced in current source. |

## Evidence and cause

1. Names appear with inconsistent case because the account list returns stored values unchanged (`supabase/functions/_shared/platformUsers.ts:38-50`).
2. Stored values retain input case because Passport validation only trims text (`packages/shared/src/passport.ts:21,39-40`).
3. Profile-only fixes cannot repair registrations: the roster and ticket prefer registration identity snapshots (`supabase/migrations/20260914213000_registration_identity_snapshots.sql:8,31,54`).
4. Google account labels can bypass profiles through Auth metadata (`platformUsers.ts:40-42`). Password signup itself collects no name (`apps/site/lib/auth.ts:14-21`).
5. Even a corrected profile is visually uppercase because its banner applies `uppercase` (`apps/site/app/profile/PassportPhotos.tsx:217`).

Reproduction is supported by the supplied screenshot and source trace. New regression tests must verify actual database writes and migration repair before completion.

## Fix and risks

Use one explicit casing contract in shared/Edge validation, database write triggers and Google display fallback. Backfill only runner-name fields in profiles, Passports, registration JSON, reservation places and screening applications. Remove the profile name's uppercase styling.

Do not infer split names from a Google full name. Do not mutate provider metadata, bib/team names, emails, waiver acceptance or audit evidence. The existing Passport-to-profile bridge fires on column updates. Suspend only that bridge inside the transactional repair, then restore it before commit, so legacy names and unrelated profile details survive.

See [specification](../specs/2026-11-02-runner-name-title-case.md) and [implementation plan](../plans/2026-11-02-runner-name-title-case.md).
