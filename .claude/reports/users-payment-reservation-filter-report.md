# Users participant payments and Reservations category filter

Implemented the verified group payment display correction and dynamic event category filtering. Participant cards display captured allocation gross cents. Account summaries display the full captured transaction. Reservation rows remain complete checkouts and retain their collected totals.

## Validation

2,501 tests passed: runner 548, admin 1043, backend/shared 897, shared UI 13. Relevant typechecks, both isolated Next production builds, Fieldnotes audit (325 modules, 256 audited, no duplicate primitives), 180-migration replay and retirement assertion passed. The new nested payment select succeeded against local PostgREST.

The local validation stack used ports 55121/55122 to avoid another task's containers. The unchanged CI assertion was evaluated with its local port substituted in memory. The root suite initially had six proof-verifier failures because its local verifier URL was absent; all seven proof API cases passed after restoring the normal verifier connection. No source fix or test waiver was needed.

## Release scope

User explicitly requested production first, then staging synchronization. The feature starts at production f2f1b3e662b637d192471bdb44320831dad75fc6 in an isolated worktree. GitHub protection remains enforced. Deploy the reviewed feature revision through Vercel production and only platform-users through Supabase, verify live read-only UI, then integrate through staging/main and synchronize their Git ancestry.

No migration, payment creation, production fixture, provider configuration, credential or unrelated checkout change. Hosted release IDs and Browser evidence will be recorded in docs/operations/launch-progress.md.
