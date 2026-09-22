# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

Multi-organization trail & ultra-trail event platform (Mindanao, Philippines). One runner
account, many organizations, **strictly isolated data**. Every tenant table carries `org_id`
and every RLS policy keys on it.

| Path | What | Dev port |
| --- | --- | --- |
| `apps/site` | Next 15 App Router — public runner storefront: browse, register, pay, ticket | 3000 |
| `apps/web` | Next 15 App Router — admin console for race directors, marshals, platform staff | 3001 |
| `apps/mobile` | Expo 57 / RN 0.86 runner app (React Native Reusables + NativeWind) | — |
| `packages/shared` | `@race-pace/shared` — framework-agnostic types + Zod validators | — |
| `supabase` | 85+ migrations, RLS, Deno Edge Functions, backend/RLS test suite | 545xx |
| `docs` | PRD, ADRs, per-feature specs + plans. `docs/README.md` is the roadmap ledger | — |

Hosted Supabase project: `whaqarofxdlzxrelbcrq`. Both Next apps deploy as **separate Vercel
projects from the same repo**, distinguished by Root Directory (`docs/deploy-vercel.md`).

The root `README.md` is stale — it predates `apps/site` and still describes `apps/web` as a
Vite SPA. Trust `docs/README.md` and the code.

## Required session startup

Before changing code, configuration, branches, or hosted services:

1. Read this file in full before taking repository actions.
2. Read the nearest nested `AGENTS.md` for every path in scope.
3. Read `docs/operations/release-workflow.md` before any push, merge, backend change, or deploy.
4. Fetch the remotes, inspect `git status`, and compare the working branch with `origin/staging`
   and `origin/main`.
5. Create every feature or fix in a new isolated Git worktree and dedicated branch from current
   `origin/staging`. Never implement new work in the shared checkout or a branch used by another
   task.
6. Preserve unrelated working-tree changes. Never use them as part of a release by accident.

Do not treat an earlier session's deployment evidence as current. Recheck the exact commit,
deployment, migration history, Edge Function bundle, and provider configuration in this session.

## Staging-first release policy

`staging` is the only integration branch. `main` is the production branch.

- Give every feature or fix its own isolated Git worktree and dedicated branch from current
  `origin/staging`. Keep one task per worktree, then open its pull request into `staging`.
- A production pull request must use `staging` as its head and `main` as its base. Do not use a
  parallel production branch, cherry-pick, or direct feature-to-`main` pull request.
- Production may lag staging. Production must never contain application, migration, Edge
  Function, Auth, email, payment, or provider changes that staging has not already validated.
- Run the local CI suite before merging into `staging`. Then deploy the exact staging revision,
  including every required backend change, and complete the hosted staging checks.
- Record the exact Git commit, both Vercel deployment IDs, Supabase migration versions, Edge
  Function versions, provider modes, and end-to-end evidence before opening the production pull
  request.
- Apply production backend changes from the same reviewed revision. Verify production again after
  deployment. Never add synthetic data or trigger a real payment as an automated production test.
- After production verification, merge `main` back into `staging`. Start no new feature until
  `main` is again an ancestor of `staging`.

Hosted environment identities are fixed:

| Environment | Git branch | Supabase project | Vercel environment |
| --- | --- | --- | --- |
| Staging | `staging` | `pepbmqomiailnnvvwupz` | custom `staging` environment |
| Production | `main` | `whaqarofxdlzxrelbcrq` | `production` |

Both `race-pace-site` and `race-pace-web` must use the matching environment. Resend, PayMongo,
Auth URLs, CAPTCHA, webhooks, scheduled workers, and Edge Function secrets follow the same boundary.

## Commands

```bash
# Per app (pnpm workspace filters)
pnpm --filter site dev            # or web / mobile → `pnpm --filter mobile start`
pnpm --filter site test           # Vitest + Testing Library, TZ=America/New_York
pnpm --filter site typecheck      # tsc --noEmit — expect 0 errors, no `as any` escape hatches
pnpm --filter web test:e2e        # Playwright, targets the RUNNING container, workers: 1

# One test file / one case
pnpm --filter site exec vitest run lib/__tests__/payment.test.ts
pnpm --filter site exec vitest run -t "grosses up"

# Backend / RLS suite (root vitest: packages/** + supabase/**)
pnpm exec supabase start
pnpm exec supabase db reset                        # migrations + seed.sql
pnpm exec supabase status -o env > .env.local      # test/env.ts reads this
pnpm test                                          # or: pnpm exec vitest run supabase/tests/fee.test.ts

# Docker dev stack (Traefik at racepace.lan / admin.racepace.lan).
# Needs the shared `traefik` container and the external `dev-net` network already up.
# Three untracked files must exist first — see "Docker" under Conventions that bite:
#   ./.env                 SUPABASE_INTERNAL_URL=          (blank ⇒ hosted Supabase)
#   apps/site/.env.local   copy of apps/site/.env.example      + real anon key
#   apps/web/.env.local    copy of apps/web/.env.local.example + real anon key
docker compose up -d
docker compose logs -f site web    # first boot runs pnpm install; ~2 min to "Ready in"
```

`pnpm lint` at the root is a **no-op** — no app defines a `lint` script and there is no ESLint
config anywhere. `typecheck` + the test suites are the gate. GitHub Actions mirrors these checks in
`.github/workflows/ci.yml`, but hosted staging verification remains a separate release gate.

## Architecture

### The database is the boundary, not the app

Reads and ordinary writes go direct from the client through RLS. Anything privileged or
money-touching goes through a Deno Edge Function holding the service-role key
(`supabase/functions/`): `registrations-checkout`, `payment-session`, `payments-webhook`,
`admin-refund`, `check-in`, `ticket-qr`, `org-provision`, `send-push`, `send-ticket-email`.

Multi-step money mutations are single Postgres RPCs so they are atomic and replay-safe —
`confirm_payment_tx`, `refund_registration_tx`, `decrement_slot`, `payout_open_statement`,
`payout_mark_paid`, `expire_stale_registrations`. Authorization helpers `auth_is_super_admin()`
and `auth_can_admin_org()` are `security definer` functions that RLS policies call. A
page-level status check is UX only; the Edge Function re-checks it as the real gate.

### The three-party money ledger

Runner pays → **processor** (PayMongo) takes its cut → **platform** takes commission →
organizer receives `net_to_org`. All amounts are **integer centavos**; no floats anywhere in
the money path.

- `organizations.fee_mode` — `absorb` (organizer bears processing) or `pass_on` (surcharge
  grossed up onto the runner). Super-admin only.
- `organizations.commission_type` — `percent` (`commission_rate`) or `fixed`
  (`commission_flat_cents`). Independent of `fee_mode`; read all three terms, never assume.
- `payments.processor_fee_cents` / `processor_fee_predicted_cents` / `processor_fee_source`
  (`actual` | `predicted` | `historical` | `none`). Invariant
  `net_to_org = amount - processor_fee_cents - platform_fee` holds for `actual`/`predicted`;
  `historical` violates it deliberately and that violation *is* the record.
- Gross-up is not addition — the processor charges its percentage on the *final* amount:
  `total = ceil((base + platformFee + fixed) * 10000 / (10000 - percent_bps))`.

### Code duplicated on purpose — keep these in sync

Different runtimes (Deno edge, Next, Expo) cannot share these, so they are written twice.

| Canonical | Copy | Pinned by |
| --- | --- | --- |
| `packages/shared/src/index.ts` | `supabase/functions/_shared/validation.ts` | manual — edge runtime only mounts `supabase/functions/` |
| `_shared/fee.ts` `computeFee` | `apps/site/lib/payment.ts` `feeOn`, `apps/web/lib/commission-terms.ts` `feeOn` | manual |
| `_shared/processorFee.ts` `passOnBreakdown` | `apps/site/lib/payment.ts` `passOnLines` | `supabase/tests/processor-fee.test.ts` fuzzes both |
| `payment-session/index.ts` `METHOD_MAP` | `apps/site/lib/payment.ts` `PAY_METHODS` / `RATE_METHOD` | manual — Maya is `paymaya` to PayMongo |

Client-side money figures are **display only**. `payment-session` recomputes the authoritative
amount server-side; never send a client-computed total to a provider.

### Auth in the Next apps

`@supabase/ssr` with three clients — `lib/supabase/client.ts` (browser),
`server.ts` (Server Components / Route Handlers, `cookies()` is async so it must be awaited),
and `middleware.ts` (refreshes the session on every request). Server-side clients prefer
`SUPABASE_INTERNAL_URL` when set; that variable exists **only** for the Docker dev stack — and
it is deliberately set to the EMPTY string there so the containers reach hosted Supabase
instead of a local one (see "Conventions that bite").

Use `getUser()` to gate authorization — `getSession()` only decodes the cookie. Route
protection lives as pure functions in `lib/routes.ts` (`isProtectedPath`, `safeNextPath`) so
it is testable without a Next runtime; `middleware.ts` just calls them.

## Conventions that bite

### Approved prototypes are implementation contracts

- When the product owner selects a layout proposal or prototype, treat its visual design,
  responsive behavior, interaction states, and demonstrated functionality as the production
  acceptance criteria.
- Reproduce the approved composition, spacing, typography, hierarchy, controls, and breakpoints
  with real application data and working flows. Do not ship only the underlying business logic
  or a rough visual interpretation.
- Validate the implemented screen at desktop, tablet, and mobile sizes. Document every intentional
  deviation from the approved prototype before calling the implementation complete.

- **Never edit a migration already applied to the hosted project.** `db push` skips a version
  it has recorded regardless of content, so an edit silently diverges from what is live. Write
  a follow-up migration instead. Editing in place is acceptable only for a version that has
  only ever run through a local `db reset` — say so in the file header when you do.
- **New columns and functions need explicit grants.** `organizations`' UPDATE grant is
  column-scoped (`20260724140000`). Postgres grants EXECUTE to PUBLIC on every new function by
  built-in default, so a new function needs an explicit revoke/grant pair too — an event trigger
  once enforced this at DDL time (`20260808120200`), but it also fired on `CREATE OR REPLACE` and
  silently stripped grants from existing functions, so it was reversed
  (`20260808130000`) in favor of `supabase/tests/function-grants.test.ts`, which audits every
  `public` function's grants instead. A missing grant has bitten this repo three times. Add the
  grant in the same migration and verify with `has_column_privilege` / `has_function_privilege` —
  inspecting `pg_default_acl` is not proof.
- **`NEXT_PUBLIC_SUPABASE_URL` is read at build time** by both `next.config.ts` files to build
  the allowed image hosts. Missing on the first Vercel build → every Supabase-hosted image 400s
  in production while local dev looks fine, and adding it later needs a **redeploy**. Never set
  `SUPABASE_INTERNAL_URL` on Vercel.
- **Docker: the compose project name is the DIRECTORY name.** Re-cloning the repo to a new path
  therefore starts a SECOND stack while the old one keeps running — its services are
  `restart: unless-stopped` and its Traefik labels still claim `racepace.lan` and
  `admin.racepace.lan`. That is what killed both hosts after a re-clone from
  `development/trail-ultra` to `development/race-pace`: the old containers still owned every
  route while serving a bind mount whose source directory had been deleted. `docker compose
  down` in the NEW directory cannot see them — it only knows its own project. Check
  `docker ps` and `docker rm -f` the strays by name before `docker compose up`.
- **The Docker stack points at HOSTED Supabase, and `./.env` is the switch.**
  `docker-compose.yml` defaults `SUPABASE_INTERNAL_URL` to the local stack via
  `${SUPABASE_INTERNAL_URL-...}`, and `-` (not `:-`) substitutes only when the variable is
  UNSET — so an empty `SUPABASE_INTERNAL_URL=` in `./.env` wins, and `server.ts`'s
  `SUPABASE_INTERNAL_URL || NEXT_PUBLIC_SUPABASE_URL` falls through to the cloud URL. Pointing
  the `.env.local` files at hosted Supabase is **not enough on its own**: server-side calls
  still go to `host.docker.internal` with a cloud anon key, which PostgREST rejects as
  PGRST301 "None of the keys was able to decode the JWT". Delete the line to go back to local.
  Fetch the key with `supabase projects api-keys --project-ref whaqarofxdlzxrelbcrq -o env`.
  Note the hosted project holds almost no data — it was wiped to a bare super admin — so an
  empty race list there is correct, not a broken connection.
- **Docker, the rest:** don't run `pnpm build` on the host (it writes through the bind mount
  into the container's live `.next`), and don't let services share a `node_modules` volume.
- **Test discovery is a glob, and it differs per app.** Both Next apps only run
  `{app,lib,components}/**/*.test.{ts,tsx}` — a file outside it silently never runs. `apps/site`
  puts tests in `__tests__/` directories; `apps/web` colocates them next to the code.
- `apps/mobile` carries its own `AGENTS.md`: read the versioned Expo 57 docs
  (https://docs.expo.dev/versions/v57.0.0/) before writing React Native code.
- Comments here carry the incident that produced the code, not a restatement of it — especially
  in migrations, the money path, and auth. Match that density when you touch those; drop it for
  ordinary UI.
- Commits are `type(scope): imperative lowercase` — `fix(payouts): claw back only refunds that
  land after settlement`.
- Non-trivial features get a design spec in `docs/specs/` and a task plan in `docs/plans/`,
  with status tracked in `docs/README.md`. Check there before designing something that may
  already be decided.
