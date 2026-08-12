# Check-in & Dashboard — state at session close (2026-08-12)

Branch `claude/admin-console-handoff-551147`, 21 commits, HEAD `372c1d1`.
**Not pushed. Not merged. `main` is 271 commits ahead.**

Worktree holding this branch: `.claude/worktrees/event-registration-web-fff722`
(the directory name does not match the branch — that cost real time this session).

## What is done

All eight planned tasks are implemented, reviewed, and committed. Every task went
through a fresh implementer, a spec+quality review, and a scoped re-review of its
fixes. Suites from this worktree:

- `pnpm --filter web test` — **214 passing**
- `pnpm --filter web typecheck` — clean
- `pnpm --filter web build` — clean
- `pnpm exec vitest run supabase/functions packages` — 30 passing
- `pnpm exec vitest run supabase/tests/...` — 12 of 13 passing (see below)

Requires `.env.hosted` in this worktree for the database suites.

## The one failing test is EXPECTED — do not "fix" it against hosted

`admin-dashboard-views.test.ts` expects `pending_count: 1`, gets `2`.

Cause: **`main` has moved past this branch's money model.** Both of this branch's
migrations are already on `main`:

- `20260806150000_checkin_rpcs.sql` — on main
- `20260806161500_admin_dashboard_views.sql` — on main, but a *different* version

`main` then adds `20260807090200_widen_money_aggregates.sql`, which redefines
`pending_count` with `partially_refunded` semantics from a richer three-party
money model that postdates this work. The hosted database runs main's version.

**Re-applying this branch's view definition to hosted would regress main's money
model on the live database. Don't.** The correct resolution is to rebase onto
main, drop this branch's now-superseded view migration, and re-point
`lib/dashboard.ts` at whatever aggregate shape main settled on.

## What is uniquely on this branch and NOT on main

All the frontend. None of these exist on `main`:

- `apps/web/src/lib/keyboardWedge.ts`, `useKeyboardWedge.ts`
- `apps/web/src/lib/checkinQueue.ts`
- `apps/web/src/lib/useCheckInSession.ts`
- `apps/web/src/routes/CheckIn.tsx`, `Dashboard.tsx`
- `apps/web/src/components/QrScanner.tsx`, `CheckInBanner.tsx`,
  `CheckInRoster.tsx`, `CheckInQueueStatus.tsx`
- The marshal role plumbing in `lib/roles.ts`, `App.tsx`, `Sidebar.tsx`

This is the work worth preserving.

## Outstanding before merge

1. **Rebase onto `main`** (271 commits). A dry-run merge showed zero textual
   conflicts, but main touches registrations/payments — the surface these views
   and RPCs read. Semantic reconciliation is required, not just a clean merge.
2. **The final fix-wave re-review never ran.** All nine findings from the
   whole-branch review are fixed and committed in `372c1d1`; the Critical one was
   independently verified load-bearing. The last verification gate is outstanding.
3. **Browser verification of `/check-in` was never done** — it needs a login.
   Check: event picker lists both events with nothing auto-selected; camera
   permission prompts; DevTools → Network → Offline flips the header to
   "Offline — scans are queued".
4. **Three sibling-authored migrations are carried by this branch**
   (`20260806090000`, `20260806140000`, `20260806160000`), copied verbatim because
   `db push` refuses when the remote has migrations the local tree lacks. All
   byte-identical to the sibling's copies. Call this out in the PR.

## Known gaps deliberately left (see the SDD ledger for the full list)

- `canCheckIn()` in `supabase/functions/_shared/authz.ts` does **not** honour
  `user_roles.event_scope`. A scoped marshal is denied a sibling event's roster by
  SQL but would still be allowed to check someone in on it by the Edge Function.
  Out of scope by the spec's non-goals; no `event_scope` rows exist in production.
  **This branch makes `event_scope` meaningful in SQL for the first time**, so
  close this before anyone sets one and assumes it is enforced.
- The check-in `localStorage` store is not scoped to a user. On a shared
  race-morning device, marshal A's unsent queue warns marshal B, and A's roster
  (including every `ticket_token`) persists after logout. Do **not** "fix" this by
  clearing storage on sign-out — that would destroy an unsent queue.
- `QrScanner` has no retry after a denied camera permission; recovery is a page
  reload. ~10 lines, worth doing before race day.
- A marshal can *scan* a locally-pending runner in (the online path is
  server-authoritative since the final fix wave) but cannot *tap* them in from the
  roster, which still renders a "Not paid" badge instead of a button. Decide which
  behaviour is right before race morning.

## Process note worth keeping

Reviews caught **five separate false-confidence tests** on this branch —
assertions that passed against code with the feature entirely absent
(`data ?? []` masking a null error response; jsdom never firing the code path
under test). Every fix on this branch was therefore verified by reverting the fix
and confirming the new test actually fails. That habit is the reason the Critical
scanner bug was caught: the hardware-scanner path was silently dead, and all 200
tests passed against it.
