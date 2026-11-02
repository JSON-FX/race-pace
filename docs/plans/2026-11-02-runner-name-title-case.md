# Runner name casing implementation

Status: implementation and review complete locally. Required CI-equivalent checks pass; two pre-existing supplemental type errors and pending hosted acceptance are recorded in the [report](../../.claude/reports/2026-11-02-runner-name-title-case.md).

Base: `81e6f46` in an isolated worktree. Active Option B mode verified through `OPTION_B_ENABLED=true` and a successful `release:option-b` production record at this source.

1. Add a small formatter to the existing shared Passport module and its byte-for-byte Edge mirror. Transform only first/last name schema fields.
2. Format profile/Google/Passport account-list labels through the same Edge formatter. Keep email fallback unchanged.
3. Add a forward migration with a matching deterministic SQL formatter and invoker triggers on profiles, Passports, registrations, reservation places and screening applications. Explicitly restrict function grants.
4. Repair existing name fields with conditional updates. Suspend only the profile bridge during the transactional repair, then restore it. Preserve unrelated profile fields, JSON and immutable evidence.
5. Remove uppercase styling from the runner banner.
6. Verify JavaScript/SQL parity, repeatability, authenticated writes, existing-data repair, snapshot safety and access controls. Run app/shared/backend suites, typechecks and builds using an isolated local Supabase stack. Review the full diff.
7. Record local results and remaining hosted acceptance. The owner subsequently authorized commit and publication through staging and production; follow the active Option B workflow and its protected production approval.

Commands: `pnpm --filter site test`, `pnpm --filter web test`, `pnpm test`, both app typechecks/builds, shared package typechecks and Fieldnotes checks from CI. Backend tests use this task's local ports, never an existing task stack or hosted data.
