# supabase — database & server logic

Postgres **migrations**, **Row-Level Security** policies, and **Edge Functions**
(Deno/TS) for payment intents, webhooks, QR mint/verify, settlement, and
server-side custom-field validation.

- Schema, RLS, and roles follow [PRD §6 & §8](../docs/00-product-overview.md).
- Multi-tenancy: every tenant table carries `org_id`; every RLS policy keys on it.
- **Validators are vendored** in `functions/_shared/validation.ts` (Deno) because the
  local edge runtime only mounts `supabase/functions/` and can't import
  `packages/shared` — keep the two copies in sync.

## Run locally

```bash
pnpm exec supabase start                # Postgres + Auth + Realtime + Studio + Inbucket
pnpm exec supabase db reset             # apply migrations + seed
pnpm exec supabase status -o env > .env.local
pnpm exec supabase functions serve --no-verify-jwt --env-file supabase/functions/.env
pnpm test                               # unit + RLS + e2e (run in a second terminal)
```

- Ports **545xx** (API `54521` · Studio `54523` · Inbucket `54524`), chosen to coexist
  with other local Supabase projects (`labaan`, `run-with-point`).
- The app reaches the API via `EXPO_PUBLIC_SUPABASE_URL`: `http://<host>.lan:54521`
  from a device, `http://127.0.0.1:54521` from the simulator.
- Payments use `FakePaymentProvider`; confirm one by POSTing
  `{ "registration_id": "<id>" }` to `/functions/v1/payments-webhook`. PayMongo swaps
  in behind the same `PaymentProvider` interface in a later plan.
