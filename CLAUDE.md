# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

# Docker dev stack (Traefik at racepace.lan / admin.racepace.lan)
docker compose up
```

`pnpm lint` at the root is a **no-op** — no app defines a `lint` script and there is no ESLint
config anywhere. `typecheck` + the test suites are the gate. There is no CI; run them locally.

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
`SUPABASE_INTERNAL_URL` when set; that variable exists **only** for the Docker dev stack.

Use `getUser()` to gate authorization — `getSession()` only decodes the cookie. Route
protection lives as pure functions in `lib/routes.ts` (`isProtectedPath`, `safeNextPath`) so
it is testable without a Next runtime; `middleware.ts` just calls them.

## Conventions that bite

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
- **Docker:** don't run `pnpm build` on the host (it writes through the bind mount into the
  container's live `.next`), and don't let services share a `node_modules` volume.
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
