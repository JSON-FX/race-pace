# race-pace

Multi-organization trail & ultra-trail event platform (Mindanao, Philippines).
**One runner account, many organizations, strictly isolated data.**

Runners browse events, register, pay, and carry a QR ticket. Organizers run their events from
an admin console — roster, check-in, payments, settlement. The platform takes a commission and
pays each organizer out.

> **Status:** in development. The runner app, admin console and payments engine are built and
> deployed; race-day check-in, dashboards and super-admin provisioning are in progress. Live
> status per feature: [`docs/README.md`](./docs/README.md).

## Monorepo layout

| Path | What | Dev port |
| --- | --- | --- |
| [`apps/site/`](./apps/site) | Next.js 15 App Router — public runner storefront: browse, register, pay, ticket | 3000 |
| [`apps/web/`](./apps/web) | Next.js 15 App Router — admin console for race directors, marshals, platform staff | 3001 |
| [`apps/mobile/`](./apps/mobile) | Expo 57 / React Native 0.86 — the runner app, iOS + Android | — |
| [`packages/shared/`](./packages/shared) | `@race-pace/shared` — types + Zod validators, framework-agnostic, used by every surface | — |
| [`supabase/`](./supabase) | Postgres migrations, RLS policies, Edge Functions (Deno/TS), backend + RLS tests | 545xx |
| [`docs/`](./docs) | [PRD](./docs/00-product-overview.md), [ADRs](./docs/adr), design specs, task plans, [visual flows](./docs/race-pace-flows.html) | — |

## Stack

Next.js 15 (App Router, React 19) · Expo / React Native (NativeWind + React Native Reusables) ·
Supabase (Postgres · Auth · **RLS** · Storage · Realtime · Edge Functions) · PayMongo ·
Tailwind v4 + shadcn/ui · TanStack Query · Zod. **TypeScript end-to-end**, pnpm workspaces,
Node 20.

Every tenant table carries `org_id` and every RLS policy keys on it — the database, not the
app, is what isolates one organization's data from another's.

Decisions: **[ADR-0001 · tech stack](./docs/adr/0001-cross-platform-tech-stack.md)** ·
**[ADR-0002 · repo structure](./docs/adr/0002-repository-structure.md)**. Both are records of
what was decided in July 2026; the web surface has since moved from Vite to Next.js and the
storefront was split out into its own app.

## Getting started

```bash
pnpm install
```

Point the apps at the hosted Supabase project (`whaqarofxdlzxrelbcrq`) — copy each
`.env.example` to `.env.local` (`.env` for mobile) and fill in the anon key:

```bash
supabase projects api-keys --project-ref whaqarofxdlzxrelbcrq
```

Then run whichever surface you're working on:

```bash
pnpm --filter site dev      # http://localhost:3000
pnpm --filter web dev       # http://localhost:3001
pnpm --filter mobile start  # Expo dev client
```

### Working on the database

Backend and RLS tests run against a **local** Supabase stack, on ports `545xx` so it coexists
with other local projects:

```bash
pnpm exec supabase start
pnpm exec supabase db reset                     # apply migrations + seed.sql
pnpm exec supabase status -o env > .env.local   # credentials the test suite reads
pnpm test                                       # packages/** + supabase/** (Vitest)
```

Seeded admin account: `admin@racepace.test` / `password123`. More in
[`supabase/README.md`](./supabase/README.md).

### Docker (optional)

`docker compose up` serves both Next apps behind the shared Traefik proxy at
**racepace.lan** and **admin.racepace.lan** (dnsmasq resolves `*.lan`, mkcert supplies the
cert). Needed for the Playwright suite, which targets the running container. Setup and hazards:
[`apps/web/README.md`](./apps/web/README.md).

## Checks

```bash
pnpm --filter site typecheck   # tsc --noEmit — expect 0 errors
pnpm --filter site test        # Vitest + Testing Library
pnpm --filter web test:e2e     # Playwright, against the running container
pnpm --filter mobile test      # Jest + Testing Library (React Native)
pnpm test                      # backend + RLS suite, needs the local stack running
```

There is no ESLint config and no CI — the typecheck and test suites are the gate, and you run
them yourself before pushing.

## Deploying

Both Next apps deploy as **two separate Vercel projects from the same repo**, distinguished by
Root Directory. Step-by-step, including the environment variables that fail silently if you
set them late: [`docs/deploy-vercel.md`](./docs/deploy-vercel.md).

## Working in this repo

[`CLAUDE.md`](./CLAUDE.md) covers the architecture that spans files — the money ledger, the
code that is duplicated on purpose across runtimes, and the migration and grant rules that have
bitten this repo before. Worth reading before your first change, whether or not you use an
agent.
