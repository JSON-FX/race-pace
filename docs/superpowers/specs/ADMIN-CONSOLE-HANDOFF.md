# Admin console — handoff prompt for a fresh session

Copy everything below the line into a new Claude Code session started in
`/Users/jsonse/Documents/development/trail-ultra`.

---

I want to build out the Race Pace **admin console** (`apps/web`). Five routes are still
`<Placeholder>` stubs and I want to turn them into real features. Start by reading this brief,
then brainstorm scope with me before writing any code.

## What Race Pace is

A multi-organization trail & ultra event platform for Mindanao, Philippines. One runner account,
many organizations, strictly isolated by row-level security. Three apps in a pnpm monorepo:

| App | Audience | Stack | State |
|---|---|---|---|
| `apps/mobile` | Runners | Expo / React Native + NativeWind | shipped |
| `apps/web` | **Organizers — this is your target** | Vite + React 19 + react-router + shadcn/ui + Tailwind v4 | partly built |
| `apps/site` | Runners (public web) | Next.js 15 App Router | just built, not yet deployed |
| `packages/shared` | all three | plain TS, no build step | — |
| `supabase/` | — | Postgres migrations, RLS, Deno Edge Functions | — |

## What you're building

These five routes in `apps/web/src/App.tsx` render `<Placeholder>`:

- **Dashboard** — registration counts, revenue, recent signups. Cheapest; mostly queries that exist.
- **Check-in** — race-morning QR scanning. The `check-in` Edge Function and `apps/web/src/lib/checkin.ts`
  data layer already exist and are tested; the UI is missing. Needs camera/QR, marshal authorization,
  and an offline path (trailheads have no signal). Hard deadline: race morning.
- **Organizations** — cross-org admin, probably super-admin only.
- **Commission** — depends on payout rollups that do not exist yet.
- **Payouts** — moves real money to organizers. Treat with the same care as the runner money path.

Don't assume all five. Brainstorm with me first: which ones, in what order, and what "done" means.

## Read these first

- `docs/00-product-overview.md` — the PRD.
- `docs/superpowers/specs/2026-08-05-runner-web-registration-design.md` — the most recent spec; its
  §2 lists these five as explicit non-goals, which is why they're stubs.
- `docs/superpowers/plans/2026-08-05-runner-web-registration.md` — a worked example of the plan
  format this project uses.
- `apps/web/src/routes/EventEditor.tsx` and `apps/web/src/components/CategoryEditor.tsx` — the
  most recently built admin surfaces. Match their patterns: controlled inputs, dirty tracking,
  one-Save child reconcile, error surfacing. Don't introduce a new form library or state pattern.

## Conventions that are NOT optional

- **pnpm 9.7.0, Node 20.** Never `npm` or `npx` — use `pnpm` / `pnpm exec` / `pnpm dlx`.
- **The token contract will silently break your CSS.** In `apps/web/src/index.css`,
  `--primary: 21 154 85` is a raw RGB *channel triple*, NOT a color. Only
  `--color-primary: rgb(var(--primary))`, exposed via `@theme inline`, is usable. Every
  `pnpm dlx shadcn@latest add <component>` emits bare `var(--token)` references that produce
  invalid, silently-dropped CSS. **After adding any shadcn component, run
  `grep -rn "var(--" apps/web/src/components/ui/` and rewrite every hit that isn't `var(--color-*)`.**
- **Money is integer centavos everywhere.** Format only at the render edge with `formatPeso` from
  `@race-pace/shared`. Never do floating-point arithmetic on amounts.
- **Types and validators come from `@race-pace/shared`.** Never redefine them locally — the Edge
  Functions validate with the same code, and a local copy drifts.
- **Authorization is RLS, not UI conditionals.** Every tenant table carries `org_id` and every policy
  keys on it. A hidden button is not a permission check. Server-side auth uses `getUser()`, never
  `getSession()` (the latter returns unverified cookie contents).
- **Empty string must persist as `NULL`**, never `""` — the public site branches on null.

## Backend

Hosted Supabase project **`whaqarofxdlzxrelbcrq`**. The old `ytwdrsmclwghwktpupqd` is retired —
never point anything at it. Historical docs still name it as a record of what was true then; don't
rewrite them.

**The CLI must be logged in as the newer Gmail account.** A stale token sees other projects but not
this one, and `supabase link` fails confusingly. Verify with `pnpm exec supabase projects list`
before doing any database work.

Useful: `pnpm exec supabase db query --linked "…"` runs SQL through the Management API — no DB
password needed. `db push` applies migrations. `functions deploy` respects per-function `verify_jwt`
in `config.toml`. Note `db push` does NOT run `seed.sql` against a linked remote.

## Traps that cost real time on the last branch

- **A bare `pnpm exec vitest run` at the repo root fails**, and it isn't your fault — it picks up 8
  RLS/integration files under `supabase/tests/` that need a running local Supabase stack. Use
  `pnpm --filter web test` for the admin, or `pnpm exec vitest run supabase/functions packages`.
- **`localhost` may serve a different app.** Another project holds `[::1]` on common ports and macOS
  resolves IPv6 first. Use `127.0.0.1` explicitly and check the page title before trusting what you see.
- **`apps/web` runs in Docker** at `https://admin.racepace.lan` via a shared Traefik stack
  (`docker compose up -d web` from the repo root). It's a Vite dev server on a bind mount, so source
  edits hot-reload — but a new dependency needs the container restarted.
- **`.lan` hostnames need a cert SAN.** A `*.lan` wildcard cannot cover a second-level name; see
  `~/Documents/development/infra/certs/projects.txt` and `regen.sh`.

## Current data

One organization (Race Pace) and one event (Apo Sky Ultra 2026, `trail`, 4 categories). Zero
registrations, payments, or check-ins. Admin login `admin@racepace.test` / `password123`.
`supabase/seed.sql` restores five orgs and five events if you want more to work with.

## How I want you to work

Use the superpowers workflow, same as the last branch:
**brainstorm → spec → plan → subagent-driven execution with a review after every task.**
Do not start coding from this brief. Brainstorm scope with me first, write a spec I approve, then a
plan, then execute.

Work in a git worktree, not on `main`.

That process caught real bugs on the last branch that would otherwise have shipped — a silent
registration dead-end, an open redirect, a cancelled event that was still payable, and a timezone
bug that rendered every event date a day early on US-region servers. It's worth the overhead.
