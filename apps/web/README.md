# Race Pace — Admin web console

Next.js 15 (App Router) + TypeScript + shadcn/ui + Tailwind v4. Runs in Docker
behind the shared Traefik proxy at **https://admin.racepace.lan** (this Mac).
dnsmasq resolves `*.lan`; Traefik serves it with the mkcert `*.lan` cert —
same convention as the other `.lan` sites. The dev server listens on port
**3001** (`apps/site` already owns 3000).

## First-time setup
1. Bring up the shared infra (Traefik on `dev-net`): in `/Users/jsonse/Documents/development/infra` → `docker compose up -d`. And the Supabase stack: `pnpm exec supabase start`.
2. From this repo root: `docker compose up` (first run installs the workspace in-container — slow once).
3. Open **https://admin.racepace.lan** — no `/etc/hosts` needed (dnsmasq handles `.lan`), cert is locally trusted (mkcert).

## Local dev without Docker
`pnpm --filter web dev` → http://localhost:3001

## Environment variables
Set in `apps/web/.env.local` (see `.env.local.example`) for local dev, or as
real env vars for the Docker container / a hosted deploy (`.env.example`).

- `NEXT_PUBLIC_SUPABASE_URL` — read by both the server and the browser. From
  the host (bare `pnpm dev`) this is Supabase's local URL
  (`http://127.0.0.1:54521`); from inside the `web` container it would be
  wrong, because `127.0.0.1` there is the container itself, not the Mac — see
  `SUPABASE_INTERNAL_URL` below.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the local or hosted anon key.
- `SUPABASE_INTERNAL_URL` (container-only, set in `docker-compose.yml`) —
  Server Components, Server Actions, and `middleware.ts` all run *inside* the
  container now that this is Next instead of a Vite SPA, where only the
  browser ever talked to Supabase. `lib/supabase/server.ts` and
  `lib/supabase/middleware.ts` read this in preference to
  `NEXT_PUBLIC_SUPABASE_URL` when it's set, pointing server-side calls at
  `http://host.docker.internal:54521` instead of the container's own loopback,
  while the browser keeps using `NEXT_PUBLIC_SUPABASE_URL` as before. Don't
  "simplify" this to one URL — the two sides need different addresses for the
  same local Supabase instance.

## Tests
`pnpm --filter web test` — Vitest + Testing Library. Runs everything under
`{app,lib,components}/**/*.test.{ts,tsx}`; `tsconfig.json`'s
`types: ["vitest/globals"]` is what makes `it`/`expect`/`vi` resolve without
importing them in every file (`vitest.config.ts` sets `globals: true`, but
TypeScript needs to be told separately). Test files live next to the code
they cover, not in a separate `__tests__/` tree — anything outside the
`{app,lib,components}` glob silently never runs.

`pnpm --filter web typecheck` — `tsc --noEmit`, no `@ts-nocheck`/`as any`
escape hatches. Should be 0 errors; treat any regression as real.

## E2E (Playwright)
`pnpm --filter web test:e2e` covers the SSR paths RTL cannot reach: the
middleware's unauthenticated redirect, a filter surviving a hard reload, the
browser Back button restoring prior table state, and rows-per-page changing
the range label. It targets the **running Docker container** at
`https://admin.racepace.lan` directly (`playwright.config.ts` has no
`webServer` block on purpose — spawning a second dev server would race the
container for port 3001) and needs:

- The `web` and Supabase containers already up (`docker compose up -d`, from
  first-time setup above).
- `supabase/seed.sql`'s provisioned admin account, `admin@racepace.test` /
  `password123`, present in the local DB (survives `db reset`).
- Chromium installed once: `pnpm --filter web exec playwright install chromium`.

The suite runs with `workers: 1` — the target is a single shared dev server,
not a production build, and running it at higher concurrency has produced a
client-side exception under the extra SSR load. One spec
(`a non-admin lands on /no-access`) is skipped: no non-admin fixture account
exists in `supabase/seed.sql` (only the provisioned admin). Set
`E2E_NONADMIN_EMAIL` / `E2E_NONADMIN_PASSWORD` to exercise it against a
seeded non-admin account.

## Docker hazards
Two things have broken the running container's dev server before — both
worth knowing before you reach for `docker compose` commands or a host build:

- **Don't run `pnpm build` on the host.** The container's `.next` lives on
  the bind-mounted repo; a host build writes through that mount and corrupts
  the container's live dev build mid-session.
- **Don't let services share a `node_modules` volume.** Every service's
  container command starts with `pnpm install`; a shared volume means
  starting or recreating one service rewrites `node_modules` out from under
  another's already-running dev server. `web` and `site` each get their own
  `web_repo_node_modules` / `web_node_modules` volumes for this reason — see
  the comments in `docker-compose.yml`.
