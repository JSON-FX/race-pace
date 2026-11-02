# Runner name casing review

Reviewed 2026-11-02 against base `81e6f46`. Local change only; no pull request or deployment.

## Scope and result

Reviewed the formatter and its Edge mirror, name-source selection, profile banner, additive migration, regression tests and documentation. No remaining in-scope technical findings.

Before this report: 10 tracked files modified, 5 text files added, 5 screenshots added; 354 text lines added and 14 removed. This report and the implementation report are additional documentation.

## Findings addressed

- Initial Unicode capitalization could expand `ß` to `SS` and change again on the second pass. Title casing now lowers the remainder of an expanded initial. Combining marks stay with their letter, and final text is canonically composed. Client/SQL parity and repeatability tests cover these cases.
- PostgreSQL whitespace matching did not remove a byte-order mark that JavaScript treats as whitespace. SQL now includes it explicitly; parity tests include copied names containing that mark and nonbreaking spaces.
- A naive Passport repair would invoke the existing profile bridge and erase legacy-only names or overwrite unrelated profile details. The transactional repair suspends only that bridge and restores it before commit. Tests preserve names, birth dates, bib names, snapshot evidence and provider metadata.

## Boundaries checked

Invoker triggers retain existing row-level permissions. The deterministic formatter reads no private data and has an explicit authenticated/service-role grant. Anonymous execution and direct authenticated trigger execution are revoked. Actual `has_function_privilege` checks and the existing grants suite verify these boundaries.

Registration JSON changes only string-valued first/last/full names. Historical waiver acceptance and audit evidence remain untouched. Existing status, amount, tenant, ownership and payment logic remain unchanged. New acceptance evidence correctly uses the newly normalized participant name.

Google metadata is formatted at its existing display fallback. The change neither mutates provider records nor infers first/last names. Email/username fallback spelling remains intact.

## Existing issues deferred

These reproduce on an archive of unchanged `main` and are outside this task:

- `packages/shared/src/discounts.ts:88`: optional string passed to `BigInt` (`TS2345`).
- `supabase/functions/platform-users/index.ts:265`: mapped status widens to `string` instead of the declared union (`TS2322`).

Required CI commands and additional checks are recorded separately in the [implementation report](../reports/2026-11-02-runner-name-title-case.md). Hosted acceptance and an actual Google authorization round trip remain untested.
