# Protected production QA implementation

**Plan:** `docs/plans/2026-09-18-protected-production-qa.md`  
**Branch:** `codex/production-cutover-20260918`  
**Status:** complete

The production middleware now permits the exact unique Vercel deployment URL for authenticated internal release testing. Public custom domains and stable Vercel aliases continue to show Coming Soon. Both Vercel projects' existing unique URLs required Vercel sign-in when checked without a session.

Changed `packages/shared/src/launchGate.ts`, its focused tests, and both Next middleware entry points. Added the plan and updated the release ledger with the staging purchase/refund and production backend cutover.

Validation: shared gate tests 3/3, site tests 410/410, admin tests 879/879, and both type checks passed. Root backend suite passed 81 files and 637 tests but had four failures tied to the copied local function environment and an older running local checkout response; exact staging baseline `e423379` CI passed. Production Vercel deployment and protected-URL smoke remain release tasks.

Deviation: the Vercel account-protected deployment URL provides internal access instead of a new application credential or public QA route.
