# Runner Web — Public Registration Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/site`, a public Next.js app where trail runners browse events, register, pay via PayMongo, and receive a QR ticket — landing in the same Supabase tables the admin console already reads.

**Architecture:** Next.js 15 App Router. Public catalog pages are Server Components using the anon key (fast, indexable, real Open Graph cards); the authenticated flow — wizard, pay, ticket, races, profile — is client components with TanStack Query. Session lives in cookies via `@supabase/ssr` with middleware refresh. The backend is already built: three Edge Functions gain CORS, two new ones are added for ticket email and QR rendering. No schema migration.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind v4, shadcn/ui, `@supabase/ssr`, `@supabase/supabase-js`, TanStack Query v5, Zod 3, `qrcode.react`, Vitest + Testing Library, Deno (Edge Functions), Resend.

**Spec:** [`docs/superpowers/specs/2026-08-05-runner-web-registration-design.md`](../specs/2026-08-05-runner-web-registration-design.md)

## Global Constraints

- **Node 20** (`.nvmrc`). **pnpm 9.7.0** (`packageManager` in root `package.json`). Never use `npm` or `npx` — use `pnpm` and `pnpm dlx`.
- **`apps/site` is a new workspace package.** `pnpm-workspace.yaml` already globs `apps/*` — no config change needed.
- **No new migration files.** Nothing under `supabase/migrations/` is created or edited in this plan. The existing 31 migrations *are* applied to the new hosted project in Task 0 — a deployment step, not a schema change.
- **The hosted Supabase project is `whaqarofxdlzxrelbcrq`** (`https://whaqarofxdlzxrelbcrq.supabase.co`). The old `ytwdrsmclwghwktpupqd` is retired — never point anything at it. Historical documents under `docs/` still name the old ref as a record of what was true then; **do not rewrite them**.
- **No source changes to `apps/mobile` or `apps/web`.** They get one env-configuration line each in Task 0. `apps/mobile/global.css` is *read* as the token source of truth; it is never modified.
- **Token contract (critical).** `--primary: 21 154 85` is a **raw RGB channel triple, not a CSS color**. Only `--color-primary: rgb(var(--primary))` (exposed via `@theme inline`) is a usable color. **Every `pnpm dlx shadcn add <component>` emits bare `var(--token)` references that silently produce invalid, dropped CSS here. After adding any shadcn component, grep it for `var(--` and rewrite every hit that isn't already `var(--color-*)`.** This is documented in `apps/web/src/index.css` and cost real debugging time on the admin migration.
- **Money is integer centavos** everywhere. Format only at the render edge with `formatPeso` from `@race-pace/shared`. Never do floating-point arithmetic on amounts.
- **Validation comes from `@race-pace/shared`.** Never redefine `registrationInputSchema`, `customDataSchema`, `formFieldSchema`, `SHIRT_SIZES`, `BLOOD_TYPES`, or `GENDERS` locally — the Edge Function validates with the same code, and a local copy will drift.
- **Server-side auth uses `getUser()`, never `getSession()`.** `getSession()` returns unverified cookie contents. This rule applies to every Server Component, Route Handler, and middleware path.
- **Payment is never trusted from a redirect.** `/pay/callback` always confirms through `payment-verify`, which re-fetches the session from PayMongo server-side.
- **Commit after every task.** Each task ends green — typecheck and tests pass before the commit.
- **shadcn MCP.** The server resolves `components.json` from its working directory — the worktree root, which has none. So `get_project_registries` returns empty and `search_items_in_registries` finds nothing, while `view_items_in_registries` works regardless. Prefer `view_items_in_registries` to read a component's current source before adding it, rather than writing shadcn from memory. To restore search after Task 2, either re-register the MCP scoped to `apps/site`, or copy `apps/site/components.json` to the worktree root purely for registry resolution — `shadcn add` is still run from inside `apps/site` either way.
- **The primary brand accent is trail-green `#159A55`** (`#2FB56A` in dark). Blue survives only as the `info` status color.

## File Structure

**New — `apps/site/`:**

| Path | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs` | Package + build config |
| `vitest.config.ts`, `vitest.setup.ts` | Test harness (jsdom) |
| `components.json` | shadcn registry config |
| `middleware.ts` | Session refresh + route protection |
| `app/globals.css` | Tokens ported from mobile, `@theme inline` mapping, print stylesheet |
| `app/layout.tsx`, `app/providers.tsx` | Root shell, TanStack Query provider |
| `app/page.tsx`, `app/events/page.tsx`, `app/events/[id]/page.tsx` | Public catalog (Server Components) |
| `app/sign-in/`, `app/sign-up/`, `app/auth/callback/route.ts` | Auth |
| `app/register/[categoryId]/` | The wizard |
| `app/pay/[registrationId]/`, `app/pay/callback/` | Payment |
| `app/ticket/[registrationId]/` | Ticket |
| `app/races/`, `app/profile/` | Runner account |
| `lib/supabase/client.ts`, `server.ts`, `middleware.ts` | Three Supabase client factories |
| `lib/events.ts` | Catalog queries + `mapEvent` — take a client, return typed rows |
| `lib/registration.ts` | Registration queries + Edge Function calls + `mapReg` |
| `lib/draft.ts` | Wizard draft persistence + idempotency key |
| `lib/errors.ts` | Edge Function error code → human copy |
| `lib/profile.ts` | Race Passport read/write |
| `lib/format.ts` | Date formatters used with `formatDateRange` |
| `components/ui/` | shadcn primitives, rethemed |
| `components/` | `DynamicField`, `PillSelect`, `TicketCard`, `EventCard`, `StatusBadge` |

**Modified — `supabase/functions/`:**

| Path | Change |
|---|---|
| `_shared/cors.ts` | **New.** Origin allowlist, preflight, header builder |
| `_shared/confirm.ts` | Add a best-effort ticket-email call |
| `registrations-checkout/index.ts`, `payment-session/index.ts`, `payment-verify/index.ts` | Apply CORS |
| `send-ticket-email/index.ts` | **New.** Resend |
| `ticket-qr/index.ts` | **New.** PNG QR for email embedding |
| `config.toml` | `verify_jwt = false` for `ticket-qr` |

**Deviation from spec §4.1, recorded deliberately:** the spec listed `qrcode` as the browser dependency. This plan uses **`qrcode.react`** in the browser (a declarative React component, no imperative effect to manage) and **`npm:qrcode`** in Deno for PNG generation. Same output, better fit on each side.

---

### Task 0: Migrate the backend to the new hosted Supabase project

The new project `whaqarofxdlzxrelbcrq` is empty. Every later task needs a live backend to verify against, so this comes first. Everything required is already version-controlled — 31 migrations (including three `storage.buckets` inserts), `seed.sql`, and 11 Edge Functions.

**This task requires the user for three steps** (2, 3, and 9) — they need account access and a password. Those steps are marked **[USER]**. Do not attempt to work around them.

**Files:**
- Modify: `.mcp.json`, `apps/mobile/.env.example`, `apps/web/.env.example` *(already done — verify only)*
- Create (gitignored, never committed): `apps/mobile/.env`, `apps/web/.env`

**Interfaces:**
- Consumes: nothing.
- Produces: a live Supabase project at `https://whaqarofxdlzxrelbcrq.supabase.co` with the full schema, seed data, storage buckets, and all Edge Functions deployed; `apps/mobile` and `apps/web` pointing at it.

- [ ] **Step 1: Verify the config changes already applied**

```bash
grep -rn "whaqarofxdlzxrelbcrq" .mcp.json apps/mobile/.env.example apps/web/.env.example
```

Expected: three matches, one per file. Then confirm nothing live still references the retired project:

```bash
grep -rln "ytwdrsmclwghwktpupqd" --include="*.json" --include="*.ts" --include="*.tsx" --include="*.example" . | grep -v node_modules
```

Expected: no output. Matches under `docs/` are historical and must be left alone.

- [ ] **Step 2: [USER] Authenticate the MCP server**

In an **interactive terminal** (not this session, which cannot run an OAuth flow):

```bash
claude /mcp
```

Select `supabase`, then Authenticate. Without this the Supabase MCP tools are unavailable and every database step below must go through the CLI — which is the documented fallback, so this is a convenience, not a hard blocker.

- [ ] **Step 3: [USER] Log in and link the CLI**

```bash
pnpm exec supabase login
```

Then, from the worktree root:

```bash
pnpm exec supabase link --project-ref whaqarofxdlzxrelbcrq
```

This prompts for the new project's **database password** (Dashboard → Project Settings → Database). Expected: `Finished supabase link.`

- [ ] **Step 4: Apply all migrations**

```bash
pnpm exec supabase db push
```

Expected: all 31 migrations listed as pending, then applied in filename order without error, ending at `20260804120000_admin_list_views.sql`.

If it reports the remote database is not empty or migration history conflicts, **stop and report** — do not pass `--force`. An unexpectedly non-empty project means the wrong ref is linked.

- [ ] **Step 5: Verify the schema and storage buckets landed**

```bash
pnpm exec supabase db query --linked "select table_name from information_schema.tables where table_schema='public' order by table_name;"
```

Expected: includes `organizations`, `profiles`, `events`, `categories`, `addons`, `form_fields`, `registrations`, `registration_addons`, `payments`, `user_roles`, `org_members`, `notifications`, `device_tokens`, `checkins`, `psgc_regions`, `psgc_provinces`, `psgc_cities`.

```bash
pnpm exec supabase db query --linked "select id, public from storage.buckets order by id;"
```

Expected: exactly three rows — `event-images`, `org-images`, `profile-images`.

- [ ] **Step 6: Apply the seed data**

`db push` does not run `seed.sql` against a linked remote. Apply it explicitly:

```bash
pnpm exec supabase db query --linked --file supabase/seed.sql
```

Then verify:

```bash
pnpm exec supabase db query --linked "select (select count(*) from organizations) as orgs, (select count(*) from events) as events, (select count(*) from categories) as categories;"
```

Expected: `orgs = 5`, `events = 5`, and a non-zero category count.

> The 20 richer test events from earlier work were inserted directly into the retired project and are **not** in `seed.sql`. They are gone. Five seeded events are enough for development; real event data is entered through the admin console.

- [ ] **Step 7: Deploy the Edge Functions**

```bash
pnpm exec supabase functions deploy
```

Expected: all 11 functions deploy — `admin-refund`, `check-in`, `fake-checkout`, `org-members`, `payment-session`, `payment-verify`, `payments-webhook`, `registrations-checkout`, `send-push`, plus any added by later tasks.

Confirm the `verify_jwt = false` settings from `supabase/config.toml` carried over for `fake-checkout`, `payments-webhook`, and `send-push`:

```bash
pnpm exec supabase functions list
```

- [ ] **Step 8: Set the function secrets**

Generate a fresh ticket-signing secret — it does **not** need to match the retired project's, because the new project has no existing tickets to verify:

```bash
pnpm exec supabase secrets set TICKET_SIGNING_SECRET="$(openssl rand -hex 32)" PUBLIC_FUNCTIONS_URL="https://whaqarofxdlzxrelbcrq.supabase.co/functions/v1" SITE_ORIGINS="http://localhost:3000"
```

`SITE_ORIGINS` is extended with the real Vercel origins in Task 14. `RESEND_API_KEY` is set in Task 12. Then set the PayMongo key:

```bash
pnpm exec supabase secrets set PAYMONGO_SECRET_KEY="sk_test_..."
```

Use the same test-mode key as the retired project — PayMongo keys belong to the PayMongo account, not the Supabase project. Verify:

```bash
pnpm exec supabase secrets list
```

Expected: `TICKET_SIGNING_SECRET`, `PUBLIC_FUNCTIONS_URL`, `SITE_ORIGINS`, `PAYMONGO_SECRET_KEY`.

- [ ] **Step 9: [USER] Re-register the PayMongo webhook**

The existing webhook points at the retired project and will never fire again. In the PayMongo dashboard, create a webhook against:

```
https://whaqarofxdlzxrelbcrq.supabase.co/functions/v1/payments-webhook
```

subscribed to the same events as before. This yields a **new** signing secret. Set it:

```bash
pnpm exec supabase secrets set PAYMONGO_WEBHOOK_SECRET="whsec_..."
```

Without this the webhook backstop in §6.3 of the spec is dead, and an abandoned-tab payment will never confirm.

- [ ] **Step 10: Repoint the mobile and admin apps**

Fetch the new anon key:

```bash
pnpm exec supabase projects api-keys --project-ref whaqarofxdlzxrelbcrq
```

Create `apps/web/.env` (gitignored):

```
VITE_SUPABASE_URL=https://whaqarofxdlzxrelbcrq.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key from above>
```

Create `apps/mobile/.env` (gitignored):

```
EXPO_PUBLIC_SUPABASE_URL=https://whaqarofxdlzxrelbcrq.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key from above>
EXPO_PUBLIC_PAYMONGO_PUBLIC_KEY=pk_test_...
```

**Never commit either file** — `.gitignore` already covers `.env` and `.env.*` except `.env.example`.

- [ ] **Step 11: Create an admin user and verify the admin console**

The seed defines organizations but auth users are not seeded. Create one through the dashboard (Authentication → Users → Add user), then grant it admin on the Race Pace org:

```bash
pnpm exec supabase db query --linked "insert into user_roles (user_id, org_id, role) values ('<new-user-uuid>', '00000000-0000-0000-0000-0000000000a1', 'admin');"
```

Then run the admin console and confirm it reads the new backend:

```bash
pnpm --filter web dev
```

Sign in as the new user. Expected: Events lists the 5 seeded events. This is the smoke test proving the migration did not break `apps/web`.

- [ ] **Step 12: Verify the existing test suite still passes**

```bash
pnpm exec vitest run
```

Expected: PASS. These are unit tests over `packages/shared` and `supabase/functions/_shared` with no network dependency, so they should be unaffected — this confirms nothing was disturbed.

- [ ] **Step 13: Commit**

Only the three config files are committed; the `.env` files are gitignored.

```bash
git add .mcp.json apps/mobile/.env.example apps/web/.env.example
git commit -m "chore: repoint backend at the new hosted Supabase project

New project whaqarofxdlzxrelbcrq replaces ytwdrsmclwghwktpupqd as the
single source of truth for mobile, admin web, and the new public site.
Schema, seed, storage buckets, and edge functions are reapplied from
version control; secrets and the PayMongo webhook are recreated by hand.

Historical docs still name the old ref deliberately — they record what
was true at the time.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 1: CORS for browser-facing Edge Functions

Nothing in the browser can call Supabase Edge Functions until this lands — every request fails preflight. It ships first so every later task is testable.

**Six functions, not three.** Three are the new site's; three are the **admin console's**, which already call Edge Functions cross-origin (`apps/web/src/lib/team.ts:32`, `apps/web/src/lib/registrations.ts:106`, `apps/web/src/lib/checkin.ts`) with no CORS handling anywhere and none at the gateway. Moving the console to Vercel (spec §9.2) makes this mandatory for them too.

`payments-webhook` is deliberately excluded — PayMongo calls it server-to-server, where CORS does not apply.

**Files:**
- Create: `supabase/functions/_shared/cors.ts`
- Test: `supabase/functions/_shared/cors.test.ts`
- Modify: `supabase/functions/registrations-checkout/index.ts`, `supabase/functions/payment-session/index.ts`, `supabase/functions/payment-verify/index.ts`, `supabase/functions/org-members/index.ts`, `supabase/functions/admin-refund/index.ts`, `supabase/functions/check-in/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `isOriginAllowed(origin: string | null, allowed: string[]): boolean`, `buildCorsHeaders(origin: string | null, allowed: string[]): Record<string, string>`, `allowedOrigins(): string[]`, `corsHeaders(origin: string | null): Record<string, string>`, `preflight(req: Request): Response | null`.

The pure functions take the allowlist as an argument so tests never touch the `Deno` global — Vitest runs these files (root `vitest.config.ts` includes `supabase/**/*.test.ts`) and has no `Deno` object. Only `allowedOrigins()` reads `Deno.env`, and tests never call it.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/cors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isOriginAllowed, buildCorsHeaders } from "./cors";

describe("isOriginAllowed", () => {
  const allowed = ["http://localhost:3000", "https://racepace.ph", "*.vercel.app"];

  it("accepts an exact match", () => {
    expect(isOriginAllowed("https://racepace.ph", allowed)).toBe(true);
    expect(isOriginAllowed("http://localhost:3000", allowed)).toBe(true);
  });

  it("rejects an origin that is not listed", () => {
    expect(isOriginAllowed("https://evil.example", allowed)).toBe(false);
  });

  it("rejects a null origin", () => {
    expect(isOriginAllowed(null, allowed)).toBe(false);
  });

  // Vercel preview deploys get a fresh subdomain per branch, so an exact
  // allowlist can never cover them.
  it("accepts a subdomain via a *. wildcard entry", () => {
    expect(isOriginAllowed("https://site-git-abc-jayson.vercel.app", allowed)).toBe(true);
  });

  it("does not let a wildcard match a lookalike suffix", () => {
    expect(isOriginAllowed("https://notvercel.app", allowed)).toBe(false);
    expect(isOriginAllowed("https://evil-vercel.app", allowed)).toBe(false);
  });

  // "*.vercel.app" must not authorize the bare apex.
  it("does not let a wildcard match the apex domain", () => {
    expect(isOriginAllowed("https://vercel.app", allowed)).toBe(false);
  });
});

describe("buildCorsHeaders", () => {
  const allowed = ["https://racepace.ph"];

  it("echoes an allowed origin and always varies on Origin", () => {
    const h = buildCorsHeaders("https://racepace.ph", allowed);
    expect(h["Access-Control-Allow-Origin"]).toBe("https://racepace.ph");
    expect(h["Vary"]).toBe("Origin");
  });

  it("omits the allow-origin header entirely for a disallowed origin", () => {
    const h = buildCorsHeaders("https://evil.example", allowed);
    expect(h["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("allows the headers supabase-js actually sends", () => {
    const h = buildCorsHeaders("https://racepace.ph", allowed);
    expect(h["Access-Control-Allow-Headers"]).toContain("authorization");
    expect(h["Access-Control-Allow-Headers"]).toContain("apikey");
    expect(h["Access-Control-Allow-Headers"]).toContain("content-type");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run supabase/functions/_shared/cors.test.ts
```

Expected: FAIL — `Failed to resolve import "./cors"`.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/cors.ts`:

```ts
// Browser-facing Edge Functions need CORS; the mobile app never did. The pure
// helpers take the allowlist as an argument so they are testable under Vitest,
// which has no `Deno` global — only allowedOrigins() touches Deno.env.

const DEFAULT_ORIGINS = ["http://localhost:3000"];

/** An entry may be an exact origin, or "*.example.com" matching any subdomain
 *  (but never the apex, and never a lookalike suffix like "evil-example.com"). */
export function isOriginAllowed(origin: string | null, allowed: string[]): boolean {
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return allowed.some((entry) => {
    if (entry.startsWith("*.")) {
      const suffix = entry.slice(1); // "*.vercel.app" -> ".vercel.app"
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return entry === origin;
  });
}

export function buildCorsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    // Responses differ per origin — without this a shared cache can serve one
    // origin's allow-header to another.
    "Vary": "Origin",
  };
  if (isOriginAllowed(origin, allowed)) headers["Access-Control-Allow-Origin"] = origin!;
  return headers;
}

/** Comma-separated SITE_ORIGINS secret; falls back to local dev. */
export function allowedOrigins(): string[] {
  const parsed = (Deno.env.get("SITE_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parsed.length ? parsed : DEFAULT_ORIGINS;
}

export function corsHeaders(origin: string | null): Record<string, string> {
  return buildCorsHeaders(origin, allowedOrigins());
}

/** Returns a 204 preflight response for OPTIONS, or null to continue. */
export function preflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("Origin")) });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run supabase/functions/_shared/cors.test.ts
```

Expected: PASS — 9 tests.

- [ ] **Step 5: Apply CORS to `registrations-checkout`**

In `supabase/functions/registrations-checkout/index.ts`, add the import beneath the existing ones:

```ts
import { preflight, corsHeaders } from "../_shared/cors.ts";
```

Delete the module-level `json` helper:

```ts
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
```

Then replace the handler's opening line so `json` is defined per-request with the caller's CORS headers. Change:

```ts
Deno.serve(async (req) => {
  try {
```

to:

```ts
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const cors = corsHeaders(req.headers.get("Origin"));
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors } });

  try {
```

Every existing `json(...)` call inside the handler — including the one in the closing `catch` — resolves to this new closure unchanged. No other edits to this file.

- [ ] **Step 6: Apply the identical change to the other five functions**

Repeat Step 5 verbatim for each of:
- `supabase/functions/payment-session/index.ts`
- `supabase/functions/payment-verify/index.ts`
- `supabase/functions/org-members/index.ts`
- `supabase/functions/admin-refund/index.ts`
- `supabase/functions/check-in/index.ts`

All five have been verified to carry the same module-level `json` helper and the same `Deno.serve(async (req) => {` / `  try {` opening, so the edit is mechanical and identical in each.

- [ ] **Step 7: Verify no function still has a module-level `json`**

```bash
grep -n "^function json" supabase/functions/{registrations-checkout,payment-session,payment-verify,org-members,admin-refund,check-in}/index.ts
```

Expected: no output (exit 1). Then confirm all six import the helper:

```bash
grep -c "_shared/cors.ts" supabase/functions/{registrations-checkout,payment-session,payment-verify,org-members,admin-refund,check-in}/index.ts
```

Expected: `1` for each of the six.

- [ ] **Step 8: Run the full existing test suite**

```bash
pnpm exec vitest run
```

Expected: PASS — no regressions in `_shared` or `packages/shared`.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/_shared/cors.ts supabase/functions/_shared/cors.test.ts supabase/functions/{registrations-checkout,payment-session,payment-verify,org-members,admin-refund,check-in}/index.ts
git commit -m "feat(functions): add CORS to browser-facing edge functions

The mobile app never needed CORS; a browser on a Vercel origin fails
preflight on every call. Allowlist comes from a SITE_ORIGINS secret and
supports *.vercel.app wildcards, since preview deploys get a fresh
subdomain per branch.

Covers the admin console's three functions too (org-members,
admin-refund, check-in) — they already run cross-origin and become
Vercel-hosted, so correct preflight handling is mandatory for them.
payments-webhook is excluded: PayMongo calls it server-to-server.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 10: Redeploy the affected functions**

```bash
pnpm exec supabase functions deploy registrations-checkout payment-session payment-verify org-members admin-refund check-in
```

Expected: six successful deploys. CORS has no effect until the functions are redeployed — a later task failing its browser call almost always traces back to a skipped deploy here.

---

### Task 2: Scaffold `apps/site`

**Files:**
- Create: `apps/site/package.json`, `apps/site/tsconfig.json`, `apps/site/next.config.ts`, `apps/site/postcss.config.mjs`, `apps/site/components.json`, `apps/site/vitest.config.ts`, `apps/site/vitest.setup.ts`, `apps/site/.env.example`, `apps/site/app/globals.css`, `apps/site/app/layout.tsx`, `apps/site/app/page.tsx`, `apps/site/lib/utils.ts`
- Test: `apps/site/lib/__tests__/utils.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the `apps/site` package with `pnpm --filter site {dev,build,test,typecheck}`; `cn(...inputs: ClassValue[]): string` from `@/lib/utils`; the full token set as Tailwind color utilities (`bg-primary`, `text-forest`, `border-divider`, …).

- [ ] **Step 1: Create the package manifest**

Create `apps/site/package.json`:

```json
{
  "name": "site",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@race-pace/shared": "workspace:*",
    "@supabase/ssr": "^0.5.2",
    "@supabase/supabase-js": "^2.110.7",
    "@tanstack/react-query": "^5.101.2",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^1.28.0",
    "next": "^15.1.0",
    "qrcode.react": "^4.2.0",
    "radix-ui": "^1.6.7",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "tailwind-merge": "^3.6.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.6.3",
    "@types/node": "^22",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "tailwindcss": "^4",
    "typescript": "^6.0.3",
    "vite-tsconfig-paths": "^5.1.4",
    "vitest": "^4.1.10"
  }
}
```

Versions for `react`, `zod`, `@tanstack/react-query`, and `typescript` are pinned to match `apps/web` — a workspace-wide version split on React or Zod causes duplicate-instance bugs that are miserable to diagnose.

- [ ] **Step 2: Create the TypeScript and build config**

Create `apps/site/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Create `apps/site/next.config.ts`:

```ts
import type { NextConfig } from "next";

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
  : "";

const nextConfig: NextConfig = {
  // Event hero images and org logos are served from Supabase Storage.
  images: supabaseHost
    ? { remotePatterns: [{ protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }] }
    : {},
};

export default nextConfig;
```

Create `apps/site/postcss.config.mjs`:

```js
// Tailwind v4 under Next uses the PostCSS plugin, not the Vite plugin
// that apps/web uses.
export default { plugins: { "@tailwindcss/postcss": {} } };
```

Create `apps/site/.env.example`:

```
NEXT_PUBLIC_SUPABASE_URL=https://whaqarofxdlzxrelbcrq.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

- [ ] **Step 3: Create the test harness**

Create `apps/site/vitest.config.ts`:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["{app,lib,components}/**/*.test.{ts,tsx}"],
  },
});
```

Create `apps/site/vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";

// Next's router is unavailable under jsdom; components under test that
// navigate get a stub they can assert against.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  redirect: vi.fn(),
}));
```

- [ ] **Step 4: Create the token stylesheet**

Create `apps/site/app/globals.css`. The `:root` and `.dark` blocks are copied **verbatim** from `apps/web/src/index.css` lines 5–84 minus the eight `--sidebar-*` tokens (this app has no sidebar), and the `@theme inline` block likewise minus its `--color-sidebar-*` entries:

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

:root {
  --background: 255 255 255;
  --foreground: 29 29 31;
  --card: 255 255 255;
  --card-foreground: 29 29 31;
  --popover: 255 255 255;
  --popover-foreground: 29 29 31;
  --muted: 245 245 247;
  --muted-foreground: 122 122 122;
  --secondary: 234 243 238;
  --secondary-foreground: 15 122 66;
  --accent: 234 243 238;
  --accent-foreground: 15 122 66;
  --primary: 21 154 85;
  --primary-foreground: 255 255 255;
  --primary-focus: 15 122 66;
  --border: 224 224 224;
  --divider: 239 239 241;
  --input: 224 224 224;
  --ring: 21 154 85;
  --destructive: 255 59 48;
  --destructive-foreground: 255 255 255;
  --destructive-tint: 253 236 234;
  --forest: 15 42 32;
  --paid: 15 122 66;      --paid-tint: 234 243 238;
  --info: 0 102 204;      --info-tint: 232 240 251;
  --amber: 180 83 9;      --amber-tint: 251 239 227;

  --radius: 0.6875rem;
  --radius-card: 1rem;
  --radius-pill: 9999px;
}

.dark {
  --background: 11 15 13;
  --foreground: 245 245 247;
  --card: 20 25 22;
  --card-foreground: 245 245 247;
  --popover: 20 25 22;
  --popover-foreground: 245 245 247;
  --muted: 27 33 29;
  --muted-foreground: 161 161 166;
  --secondary: 19 37 28;
  --secondary-foreground: 127 224 166;
  --accent: 19 37 28;
  --accent-foreground: 127 224 166;
  --primary: 47 181 106;
  --primary-foreground: 6 18 11;
  --primary-focus: 30 158 92;
  --border: 38 43 40;
  --divider: 38 43 40;
  --input: 38 43 40;
  --ring: 47 181 106;
  --destructive: 255 69 58;
  --destructive-foreground: 255 255 255;
  --destructive-tint: 42 20 20;
  --forest: 15 42 32;
  --paid: 53 192 110;   --paid-tint: 19 37 28;
  --info: 10 132 255;   --info-tint: 16 35 58;
  --amber: 224 163 69;  --amber-tint: 42 33 19;
}

/*
 * Token contract: `--x` above is a raw RGB channel triple, e.g.
 * `--primary: 21 154 85` — NOT a usable CSS color on its own. `--color-x`
 * below wraps it as `rgb(var(--x))`, which IS usable, and is what
 * @theme inline exposes to Tailwind utilities (bg-primary, etc.).
 *
 * shadcn's generated components assume `--x` is itself a color (its upstream
 * convention), so every `pnpm dlx shadcn add <component>` emits bare
 * `var(--token)` references that silently produce invalid, dropped CSS here.
 * After adding a component, grep it for `var(--` and rewrite any hit that
 * isn't already `var(--color-*)`.
 */
@theme inline {
  --color-background: rgb(var(--background));
  --color-foreground: rgb(var(--foreground));
  --color-card: rgb(var(--card));
  --color-card-foreground: rgb(var(--card-foreground));
  --color-popover: rgb(var(--popover));
  --color-popover-foreground: rgb(var(--popover-foreground));
  --color-muted: rgb(var(--muted));
  --color-muted-foreground: rgb(var(--muted-foreground));
  --color-secondary: rgb(var(--secondary));
  --color-secondary-foreground: rgb(var(--secondary-foreground));
  --color-accent: rgb(var(--accent));
  --color-accent-foreground: rgb(var(--accent-foreground));
  --color-primary: rgb(var(--primary));
  --color-primary-foreground: rgb(var(--primary-foreground));
  --color-primary-focus: rgb(var(--primary-focus));
  --color-border: rgb(var(--border));
  --color-divider: rgb(var(--divider));
  --color-input: rgb(var(--input));
  --color-ring: rgb(var(--ring));
  --color-destructive: rgb(var(--destructive));
  --color-destructive-foreground: rgb(var(--destructive-foreground));
  --color-destructive-tint: rgb(var(--destructive-tint));
  --color-forest: rgb(var(--forest));
  --color-paid: rgb(var(--paid));
  --color-paid-tint: rgb(var(--paid-tint));
  --color-info: rgb(var(--info));
  --color-info-tint: rgb(var(--info-tint));
  --color-amber: rgb(var(--amber));
  --color-amber-tint: rgb(var(--amber-tint));
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: var(--radius-card);
  --radius-pill: var(--radius-pill);
}

@layer base {
  * { box-sizing: border-box; }
  html { -webkit-font-smoothing: antialiased; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Inter, system-ui, sans-serif;
    color: rgb(var(--foreground));
    background: rgb(var(--background));
  }
}

/* Ticket printing — Task 10 marks the page chrome with .no-print. */
@media print {
  .no-print { display: none !important; }
  body { background: #fff; }
  @page { margin: 12mm; }
}
```

- [ ] **Step 5: Create the shadcn config, root layout, and placeholder home**

Create `apps/site/components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

Note `"rsc": true` — unlike `apps/web`, this app has Server Components, so generated components must not get a spurious `"use client"`.

Create `apps/site/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Create `apps/site/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Race Pace", template: "%s · Race Pace" },
  description: "Trail and ultra-trail races in Mindanao, Philippines.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

Create `apps/site/app/page.tsx` (replaced with the real home in Task 6):

```tsx
export default function Home() {
  return <main className="p-8 text-foreground">Race Pace</main>;
}
```

- [ ] **Step 6: Write the failing test**

Create `apps/site/lib/__tests__/utils.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cn } from "../utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });

  it("lets a later conflicting utility win", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("drops falsy values", () => {
    expect(cn("px-2", false && "hidden", undefined)).toBe("px-2");
  });
});
```

- [ ] **Step 7: Install and run the test to verify it fails**

```bash
pnpm install
```

Then:

```bash
pnpm --filter site test
```

Expected: FAIL — `Cannot find module '../utils'` if Step 5 was skipped. If Step 5 was done, this passes; that is fine — the test's purpose is to prove the harness, path alias, and jsdom environment all work.

- [ ] **Step 8: Verify the app builds and typechecks**

```bash
pnpm --filter site typecheck
```

Expected: no errors.

```bash
pnpm --filter site build
```

Expected: a successful production build. If it fails on a missing `NEXT_PUBLIC_SUPABASE_URL`, create `apps/site/.env.local` from `.env.example` with the real anon key first.

- [ ] **Step 9: Commit**

```bash
git add apps/site pnpm-lock.yaml
git commit -m "feat(site): scaffold the public runner web app

Next.js 15 App Router, Tailwind v4 via PostCSS, tokens ported from
apps/mobile's global.css with the same channel-triple contract the admin
console uses. Vitest + jsdom harness.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Supabase clients, session middleware, route protection

**Files:**
- Create: `apps/site/lib/supabase/client.ts`, `apps/site/lib/supabase/server.ts`, `apps/site/lib/supabase/middleware.ts`, `apps/site/lib/routes.ts`, `apps/site/middleware.ts`
- Test: `apps/site/lib/__tests__/routes.test.ts`

**Interfaces:**
- Consumes: `cn` (Task 2).
- Produces:
  - `createClient(): SupabaseClient` from `@/lib/supabase/client` — **browser**, synchronous.
  - `createClient(): Promise<SupabaseClient>` from `@/lib/supabase/server` — **server**, async. Same export name in a different module, matching Supabase's own convention; the import path is what distinguishes them.
  - `updateSession(request: NextRequest): Promise<NextResponse>` from `@/lib/supabase/middleware`.
  - `PROTECTED_PREFIXES: string[]`, `isProtectedPath(pathname: string): boolean`, `signInRedirectPath(pathname: string, search: string): string` from `@/lib/routes`.

The routing decision is extracted into `lib/routes.ts` as pure functions so it is unit-testable without a Next runtime — middleware itself cannot be meaningfully tested under jsdom.

- [ ] **Step 1: Write the failing test**

Create `apps/site/lib/__tests__/routes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isProtectedPath, signInRedirectPath } from "../routes";

describe("isProtectedPath", () => {
  it("protects the authenticated flow", () => {
    expect(isProtectedPath("/register/abc")).toBe(true);
    expect(isProtectedPath("/pay/abc")).toBe(true);
    expect(isProtectedPath("/ticket/abc")).toBe(true);
    expect(isProtectedPath("/races")).toBe(true);
    expect(isProtectedPath("/profile")).toBe(true);
  });

  it("leaves the public catalog open", () => {
    expect(isProtectedPath("/")).toBe(false);
    expect(isProtectedPath("/events")).toBe(false);
    expect(isProtectedPath("/events/abc")).toBe(false);
    expect(isProtectedPath("/sign-in")).toBe(false);
    expect(isProtectedPath("/sign-up")).toBe(false);
  });

  // /pay/callback is protected like the rest of /pay — it verifies a payment
  // for the signed-in runner and must not be reachable anonymously.
  it("protects the pay callback", () => {
    expect(isProtectedPath("/pay/callback")).toBe(true);
  });

  // A public route must not be protected just because a protected name
  // appears later in the path.
  it("matches on prefix only, not substring", () => {
    expect(isProtectedPath("/events/register-info")).toBe(false);
    expect(isProtectedPath("/about/profile")).toBe(false);
  });

  // "/racesomething" must not match the "/races" prefix.
  it("requires a segment boundary", () => {
    expect(isProtectedPath("/racesomething")).toBe(false);
    expect(isProtectedPath("/profiles")).toBe(false);
  });
});

describe("signInRedirectPath", () => {
  it("round-trips the target path so the runner resumes where they landed", () => {
    expect(signInRedirectPath("/register/abc", "")).toBe("/sign-in?next=%2Fregister%2Fabc");
  });

  it("preserves the query string in the encoded target", () => {
    expect(signInRedirectPath("/pay/callback", "?rid=r1&status=paid")).toBe(
      "/sign-in?next=%2Fpay%2Fcallback%3Frid%3Dr1%26status%3Dpaid",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter site test routes
```

Expected: FAIL — cannot resolve `../routes`.

- [ ] **Step 3: Write `lib/routes.ts`**

```ts
/** Route prefixes that require a signed-in runner. Kept pure and separate from
 *  middleware.ts so the decision is unit-testable without a Next runtime. */
export const PROTECTED_PREFIXES = ["/register", "/pay", "/ticket", "/races", "/profile"];

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    // Segment boundary required: "/races" and "/races/..." match, "/racesomething" does not.
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

/** Bounce to sign-in carrying the full target (path + query) so the runner
 *  resumes exactly where they landed — not the homepage. */
export function signInRedirectPath(pathname: string, search: string): string {
  return `/sign-in?next=${encodeURIComponent(pathname + search)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter site test routes
```

Expected: PASS — 7 tests.

- [ ] **Step 5: Write the browser client**

Create `apps/site/lib/supabase/client.ts`:

```ts
import { createBrowserClient } from "@supabase/ssr";

/** Browser-side Supabase client. Reads the session from cookies written by
 *  middleware, so it stays in sync with server components. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 6: Write the server client**

Create `apps/site/lib/supabase/server.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Server-side Supabase client for Server Components and Route Handlers.
 *  `cookies()` is async in Next 15 — this function must be awaited. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Components cannot set cookies. Middleware refreshes the
            // session on every request, so this is safe to swallow.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 7: Write the middleware session helper**

Create `apps/site/lib/supabase/middleware.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isProtectedPath, signInRedirectPath } from "@/lib/routes";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() revalidates the token against the auth server. getSession() only
  // decodes the cookie and must never gate authorization.
  const { data: { user } } = await supabase.auth.getUser();

  if (!user && isProtectedPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    const target = signInRedirectPath(request.nextUrl.pathname, request.nextUrl.search);
    url.pathname = "/sign-in";
    url.search = target.slice(target.indexOf("?"));
    return NextResponse.redirect(url);
  }

  // Return `supabaseResponse` as-is. Constructing a fresh NextResponse here
  // without copying its cookies silently desyncs the session and logs the
  // runner out at random.
  return supabaseResponse;
}
```

- [ ] **Step 8: Write the root middleware**

Create `apps/site/middleware.ts`:

```ts
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static assets and image files — those never need a
    // session refresh and running middleware on them wastes an auth call.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4)$).*)",
  ],
};
```

- [ ] **Step 9: Verify it typechecks and builds**

```bash
pnpm --filter site typecheck && pnpm --filter site build
```

Expected: both succeed.

- [ ] **Step 10: Commit**

```bash
git add apps/site/lib apps/site/middleware.ts
git commit -m "feat(site): supabase ssr clients, session middleware, route guard

Cookie-based session shared between server and client via @supabase/ssr.
Authorization always uses getUser(), never getSession(). The protected-path
decision lives in lib/routes.ts as pure functions so it is testable without
a Next runtime.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Authentication

**Files:**
- Create: `apps/site/lib/auth.ts`, `apps/site/app/sign-in/page.tsx`, `apps/site/app/sign-up/page.tsx`, `apps/site/app/auth/callback/route.ts`, `apps/site/components/GoogleButton.tsx`
- Test: `apps/site/app/sign-in/__tests__/sign-in.test.tsx`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/client` and `@/lib/supabase/server` (Task 3).
- Produces: `signInWithPassword(email: string, password: string): Promise<{ error?: string }>`, `signUpWithPassword(email: string, password: string): Promise<{ error?: string }>`, `signInWithGoogle(next: string): Promise<{ error?: string }>`, `signOut(): Promise<void>` from `@/lib/auth`.

- [ ] **Step 1: Add the shadcn primitives this task needs**

```bash
cd apps/site && pnpm dlx shadcn@latest add button input label
```

Then **immediately** apply the token fix from Global Constraints:

```bash
grep -rn "var(--" apps/site/components/ui/
```

Rewrite every hit that is not already `var(--color-*)`. For example `bg-[var(--primary)]` becomes `bg-[var(--color-primary)]`; a bare `border-input` utility is fine because `@theme inline` defines `--color-input`. Skipping this produces components that render with invisible or default colors and no CSS error.

- [ ] **Step 1b: [USER] Enable the Google provider**

Google sign-in built in this task fails at runtime until the provider exists. In Google Cloud Console → APIs & Services → Credentials, create an **OAuth 2.0 Client ID** (Web application) with this authorized redirect URI:

```
https://whaqarofxdlzxrelbcrq.supabase.co/auth/v1/callback
```

Then paste the client ID and secret into Supabase Dashboard → Authentication → Providers → Google, and enable it.

Note this is the **new** project's callback — the old `ytwdrsmclwghwktpupqd` URI will not work. Email/password sign-in works without this, so the rest of the task is not blocked; only the Google button is.

- [ ] **Step 2: Write `lib/auth.ts`**

```ts
import { createClient } from "@/lib/supabase/client";

export async function signInWithPassword(email: string, password: string): Promise<{ error?: string }> {
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  return error ? { error: error.message } : {};
}

export async function signUpWithPassword(email: string, password: string): Promise<{ error?: string }> {
  const supabase = createClient();
  const { error } = await supabase.auth.signUp({ email: email.trim(), password });
  return error ? { error: error.message } : {};
}

/** OAuth round-trips through Supabase, which redirects back to our callback
 *  Route Handler with a code to exchange. `next` rides along so the runner
 *  lands back on the page they started from. */
export async function signInWithGoogle(next: string): Promise<{ error?: string }> {
  const supabase = createClient();
  const callback = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callback },
  });
  return error ? { error: error.message } : {};
}

export async function signOut(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.signOut();
}
```

- [ ] **Step 3: Write the OAuth callback Route Handler**

Create `apps/site/app/auth/callback/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  // Only same-site relative targets — an absolute `next` would turn this into
  // an open redirect that phishing can point anywhere.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${safeNext}`);
  }

  return NextResponse.redirect(`${origin}/sign-in?error=oauth`);
}
```

- [ ] **Step 4: Write the Google button**

Create `apps/site/components/GoogleButton.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { signInWithGoogle } from "@/lib/auth";

/** Google's brand button: white surface, four-color mark, dark label —
 *  mirroring apps/mobile's sign-in screen. */
export function GoogleButton({ next }: { next: string }) {
  return (
    <Button
      type="button"
      onClick={() => signInWithGoogle(next)}
      className="h-auto w-full gap-2.5 rounded-pill bg-white py-4 text-[16px] font-semibold text-[#1F1F1F] shadow-sm hover:bg-white/90"
    >
      <svg width="19" height="19" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
      Continue with Google
    </Button>
  );
}
```

- [ ] **Step 5: Write the failing test**

Create `apps/site/app/sign-in/__tests__/sign-in.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SignIn from "../page";

const signInWithPassword = vi.fn();
vi.mock("@/lib/auth", () => ({
  signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
  signInWithGoogle: vi.fn(),
}));

beforeEach(() => {
  signInWithPassword.mockReset();
  signInWithPassword.mockResolvedValue({});
});

describe("SignIn", () => {
  it("submits the trimmed email and password", async () => {
    render(<SignIn />);
    await userEvent.type(screen.getByLabelText("Email"), "runner@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "hunter2hunter2");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(signInWithPassword).toHaveBeenCalledWith("runner@example.com", "hunter2hunter2");
  });

  it("shows the server's error message and does not navigate", async () => {
    signInWithPassword.mockResolvedValue({ error: "Invalid login credentials" });
    render(<SignIn />);
    await userEvent.type(screen.getByLabelText("Email"), "runner@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid login credentials")).toBeInTheDocument();
  });

  it("offers Google as an alternative", () => {
    render(<SignIn />);
    expect(screen.getByRole("button", { name: /Continue with Google/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
pnpm --filter site test sign-in
```

Expected: FAIL — cannot resolve `../page`.

- [ ] **Step 7: Write the sign-in page**

Create `apps/site/app/sign-in/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleButton } from "@/components/GoogleButton";
import { signInWithPassword } from "@/lib/auth";

export default function SignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signInWithPassword(email, password);
    setBusy(false);
    if (error) setError(error);
    else router.replace(next);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-[34px] font-semibold tracking-[-0.6px] text-foreground">Sign in</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">Enter races and carry your ticket to the start line.</p>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error ? <p className="text-[14px] text-destructive">{error}</p> : null}
        <Button type="submit" disabled={busy} className="h-auto rounded-pill py-4 text-[16px] font-semibold">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-divider" />
        <span className="text-[13px] text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-divider" />
      </div>

      <GoogleButton next={next} />

      <p className="mt-8 text-center text-[14px] text-muted-foreground">
        New here?{" "}
        <Link href={`/sign-up?next=${encodeURIComponent(next)}`} className="font-semibold text-primary">
          Create an account
        </Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 8: Run the test to verify it passes**

```bash
pnpm --filter site test sign-in
```

Expected: PASS — 3 tests.

- [ ] **Step 9: Write the sign-up page**

Create `apps/site/app/sign-up/page.tsx`. Same structure as sign-in, with three differences: `signUpWithPassword`, a minimum-length hint on the password field, and a link back to sign-in.

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleButton } from "@/components/GoogleButton";
import { signUpWithPassword } from "@/lib/auth";

export default function SignUp() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signUpWithPassword(email, password);
    setBusy(false);
    if (error) setError(error);
    else router.replace(next);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-[34px] font-semibold tracking-[-0.6px] text-foreground">Create account</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">One account for every race on Race Pace.</p>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="new-password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
          <p className="text-[13px] text-muted-foreground">At least 6 characters.</p>
        </div>
        {error ? <p className="text-[14px] text-destructive">{error}</p> : null}
        <Button type="submit" disabled={busy} className="h-auto rounded-pill py-4 text-[16px] font-semibold">
          {busy ? "Creating…" : "Create account"}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-divider" />
        <span className="text-[13px] text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-divider" />
      </div>

      <GoogleButton next={next} />

      <p className="mt-8 text-center text-[14px] text-muted-foreground">
        Already have an account?{" "}
        <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className="font-semibold text-primary">
          Sign in
        </Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 10: Verify build and full test run**

```bash
pnpm --filter site typecheck && pnpm --filter site test && pnpm --filter site build
```

Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add apps/site
git commit -m "feat(site): email/password and Google authentication

Sign-in, sign-up, and the OAuth callback Route Handler. The callback only
honours same-site relative \`next\` targets — an absolute one would make it
an open redirect.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Catalog data layer

Query functions take a `SupabaseClient` as their first argument, so the same function serves a Server Component (server client) and a client hook (browser client). Shapes mirror `apps/mobile/lib/events.ts` exactly, so a future query change is visibly needed in both places.

**Files:**
- Create: `apps/site/lib/format.ts`, `apps/site/lib/events.ts`
- Test: `apps/site/lib/__tests__/events.test.ts`, `apps/site/lib/__tests__/format.test.ts`

**Interfaces:**
- Consumes: `createClient` from both Supabase modules (Task 3).
- Produces, from `@/lib/events`:
  - Types `EventRow`, `OrgRow`, `CategoryRow`, `AddonRow`, `FormFieldRow` — field-for-field identical to `apps/mobile/lib/events.ts`.
  - `mapEvent(r: any): EventRow`
  - `fetchMarketplaceEvents(db: SupabaseClient): Promise<EventRow[]>`
  - `fetchEvent(db: SupabaseClient, eventId: string): Promise<EventRow | null>`
  - `fetchCategories(db: SupabaseClient, eventId: string): Promise<CategoryRow[]>`
  - `fetchCategory(db: SupabaseClient, categoryId: string): Promise<CategoryRow | null>`
  - `fetchAddons(db: SupabaseClient, eventId: string): Promise<AddonRow[]>`
  - `fetchFormFields(db: SupabaseClient, eventId: string): Promise<FormFieldRow[]>`
- Produces, from `@/lib/format`: `longDate(iso: string): string`, `shortDate(iso: string): string`.

- [ ] **Step 1: Write the failing tests**

Create `apps/site/lib/__tests__/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { longDate, shortDate } from "../format";

describe("date formatters", () => {
  it("formats a long date", () => {
    expect(longDate("2026-11-14")).toBe("14 November 2026");
  });

  it("formats a short date", () => {
    expect(shortDate("2026-11-14")).toBe("14 Nov 2026");
  });

  // Parsing "2026-11-14" as UTC and rendering in a UTC+8 locale must not
  // shift the date. Philippine events would otherwise show the day before.
  it("does not shift the day across timezones", () => {
    expect(longDate("2026-01-01")).toBe("1 January 2026");
  });
});
```

Create `apps/site/lib/__tests__/events.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapEvent } from "../events";

const raw = {
  id: "e1",
  org_id: "a1",
  name: "Apo Sky Ultra 2026",
  event_date: "2026-11-14",
  status: "open",
  hero_image_url: null,
  gallery: null,
  categories: [
    { slots_taken: 12, distance_km: 100 },
    { slots_taken: 30, distance_km: 50 },
    { slots_taken: 5, distance_km: null },
  ],
  organizations: { name: "Race Pace", brand_color: "#159A55", logo_url: null },
};

describe("mapEvent", () => {
  it("sums slots_taken across categories into joined_count", () => {
    expect(mapEvent(raw).joined_count).toBe(47);
  });

  it("collects distances and drops null ones", () => {
    expect(mapEvent(raw).distances).toEqual([100, 50]);
  });

  it("lifts the embedded organization onto flat fields", () => {
    const e = mapEvent(raw);
    expect(e.org_name).toBe("Race Pace");
    expect(e.org_color).toBe("#159A55");
  });

  it("defaults a null gallery to an empty array", () => {
    expect(mapEvent(raw).gallery).toEqual([]);
  });

  it("survives an event with no categories", () => {
    const e = mapEvent({ ...raw, categories: [] });
    expect(e.joined_count).toBe(0);
    expect(e.distances).toEqual([]);
  });

  // organizations is absent when the query does not embed it (fetchEventsByOrg).
  it("survives a missing organizations embed", () => {
    const { organizations, ...withoutOrg } = raw;
    expect(mapEvent(withoutOrg).org_name).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter site test -- events format
```

Expected: FAIL — cannot resolve `../events` or `../format`.

- [ ] **Step 3: Write `lib/format.ts`**

```ts
/** Dates from Postgres `date` columns arrive as "YYYY-MM-DD". Appending
 *  T00:00:00Z and formatting in UTC keeps the calendar day stable — parsing
 *  bare "2026-11-14" as local time renders the previous day in UTC+8. */
function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function longDate(iso: string): string {
  return utcDate(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

export function shortDate(iso: string): string {
  return utcDate(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}
```

- [ ] **Step 4: Write `lib/events.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type EventRow = {
  id: string; org_id: string; name: string; place: string | null; region: string | null;
  event_date: string | null; end_date: string | null; elevation_gain_m: number | null;
  cutoff_hours: number | null; flag_off?: string | null;
  status: string; hero_image_url: string | null; description: string | null;
  gallery: string[]; original_date: string | null; status_note: string | null;
  city_psgc_code: string | null; region_name: string | null; province_name: string | null;
  city_name: string | null; venue: string | null; inclusions?: string[] | null;
  joined_count: number; distances: number[];
  org_name?: string; org_color?: string | null; org_logo_url?: string | null;
};

export type OrgRow = {
  id: string; name: string; slug: string;
  logo_url: string | null; banner_url: string | null;
  description: string | null; brand_color: string | null;
};

export type CategoryRow = {
  id: string; event_id: string; org_id: string; code: string; label: string;
  distance_km: number | null; base_price: number; slots_total: number; slots_taken: number;
};

export type AddonRow = { id: string; name: string; price: number };

export type FormFieldRow = {
  id: string; key: string; label: string;
  type: "text" | "number" | "select" | "checkbox" | "date" | "file";
  required: boolean; options: string[] | null; sort_order: number;
};

// Column lists mirror apps/mobile/lib/events.ts. Keep them in step.
const EVENT_COLS =
  "id,org_id,name,place,region,event_date,end_date,elevation_gain_m,cutoff_hours,flag_off,status,hero_image_url,description,gallery,original_date,status_note,city_psgc_code,region_name,province_name,city_name,venue,inclusions,categories(slots_taken,distance_km)";
const CAT_COLS = "id,event_id,org_id,code,label,distance_km,base_price,slots_total,slots_taken";

export function mapEvent(r: any): EventRow {
  const categories = (r.categories ?? []) as { slots_taken: number; distance_km: number | null }[];
  return {
    ...r,
    gallery: r.gallery ?? [],
    joined_count: categories.reduce((sum, c) => sum + c.slots_taken, 0),
    distances: categories.map((c) => c.distance_km).filter((d): d is number => d != null),
    org_name: r.organizations?.name,
    org_color: r.organizations?.brand_color,
    org_logo_url: r.organizations?.logo_url,
  };
}

/** Every org's non-draft events — RLS enforces the non-draft filter. */
export async function fetchMarketplaceEvents(db: SupabaseClient): Promise<EventRow[]> {
  const { data, error } = await db
    .from("events")
    .select(`${EVENT_COLS},organizations(name,brand_color,logo_url)`)
    .order("event_date");
  if (error) throw error;
  return (data ?? []).map(mapEvent);
}

export async function fetchEvent(db: SupabaseClient, eventId: string): Promise<EventRow | null> {
  const { data, error } = await db
    .from("events")
    .select(`${EVENT_COLS},organizations(name,brand_color,logo_url)`)
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapEvent(data) : null;
}

export async function fetchCategories(db: SupabaseClient, eventId: string): Promise<CategoryRow[]> {
  const { data, error } = await db
    .from("categories").select(CAT_COLS).eq("event_id", eventId)
    .order("base_price", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CategoryRow[];
}

export async function fetchCategory(db: SupabaseClient, categoryId: string): Promise<CategoryRow | null> {
  const { data, error } = await db.from("categories").select(CAT_COLS).eq("id", categoryId).maybeSingle();
  if (error) throw error;
  return (data ?? null) as CategoryRow | null;
}

export async function fetchAddons(db: SupabaseClient, eventId: string): Promise<AddonRow[]> {
  const { data, error } = await db.from("addons").select("id,name,price").eq("event_id", eventId).order("price");
  if (error) throw error;
  return (data ?? []) as AddonRow[];
}

export async function fetchFormFields(db: SupabaseClient, eventId: string): Promise<FormFieldRow[]> {
  const { data, error } = await db
    .from("form_fields").select("id,key,label,type,required,options,sort_order")
    .eq("event_id", eventId).eq("is_active", true).order("sort_order");
  if (error) throw error;
  return (data ?? []) as FormFieldRow[];
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter site test -- events format
```

Expected: PASS — 9 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/site/lib
git commit -m "feat(site): catalog data layer

Query functions take a SupabaseClient so one implementation serves both
server components and client hooks. Types and column lists mirror
apps/mobile/lib/events.ts so a future query change is visibly needed in
both places.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Public catalog pages

Server Components with the anon key. This is where the editorial direction lands — **invoke the `frontend-design` skill before writing the JSX below**, and treat the markup here as the structural contract (data, semantics, metadata) rather than the final visual design.

**Files:**
- Create: `apps/site/components/EventCard.tsx`, `apps/site/components/SiteHeader.tsx`, `apps/site/app/events/page.tsx`, `apps/site/app/events/[id]/page.tsx`
- Modify: `apps/site/app/page.tsx` (replacing the Task 2 placeholder)
- Test: `apps/site/components/__tests__/event-card.test.tsx`

**Interfaces:**
- Consumes: `EventRow`, `fetchMarketplaceEvents`, `fetchEvent`, `fetchCategories` (Task 5); `longDate`, `shortDate` (Task 5); `createClient` from `@/lib/supabase/server` (Task 3); `formatPeso`, `formatDateRange`, `formatAddress` from `@race-pace/shared`.
- Produces: `EventCard({ event }: { event: EventRow })`, `SiteHeader()`.

- [ ] **Step 1: Add the shadcn primitives this task needs**

```bash
cd apps/site && pnpm dlx shadcn@latest add card badge separator
```

Then apply the token fix — `grep -rn "var(--" apps/site/components/ui/` and rewrite any hit that is not `var(--color-*)`.

- [ ] **Step 2: Write the failing test**

Create `apps/site/components/__tests__/event-card.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventCard } from "../EventCard";
import type { EventRow } from "@/lib/events";

const event: EventRow = {
  id: "e1", org_id: "a1", name: "Apo Sky Ultra 2026", place: "Mt Apo", region: "Davao",
  event_date: "2026-11-14", end_date: null, elevation_gain_m: 4200, cutoff_hours: 20,
  status: "open", hero_image_url: null, description: "The flagship 100K.",
  gallery: [], original_date: null, status_note: null,
  city_psgc_code: null, region_name: "Davao Region", province_name: "Davao Del Sur",
  city_name: "City of Digos", venue: "Kapatagan Base Camp",
  joined_count: 47, distances: [100, 50], org_name: "Race Pace", org_color: "#159A55", org_logo_url: null,
};

describe("EventCard", () => {
  it("shows the event name and organizer", () => {
    render(<EventCard event={event} />);
    expect(screen.getByText("Apo Sky Ultra 2026")).toBeInTheDocument();
    expect(screen.getByText("Race Pace")).toBeInTheDocument();
  });

  it("shows every distance as a chip", () => {
    render(<EventCard event={event} />);
    expect(screen.getByText("100K")).toBeInTheDocument();
    expect(screen.getByText("50K")).toBeInTheDocument();
  });

  it("shows the formatted date and location", () => {
    render(<EventCard event={event} />);
    expect(screen.getByText("14 Nov 2026")).toBeInTheDocument();
    expect(screen.getByText("City of Digos, Davao Del Sur")).toBeInTheDocument();
  });

  it("links to the event page", () => {
    render(<EventCard event={event} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/events/e1");
  });

  it("flags a cancelled event so it cannot be mistaken for open", () => {
    render(<EventCard event={{ ...event, status: "cancelled" }} />);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });

  it("renders an event with no date or location without crashing", () => {
    render(<EventCard event={{ ...event, event_date: null, city_name: null, province_name: null }} />);
    expect(screen.getByText("Apo Sky Ultra 2026")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm --filter site test event-card
```

Expected: FAIL — cannot resolve `../EventCard`.

- [ ] **Step 4: Write `components/EventCard.tsx`**

```tsx
import Link from "next/link";
import Image from "next/image";
import { formatDateRange, formatAddress } from "@race-pace/shared";
import { shortDate } from "@/lib/format";
import type { EventRow } from "@/lib/events";
import { cn } from "@/lib/utils";

export function EventCard({ event }: { event: EventRow }) {
  const date = event.event_date ? formatDateRange(event.event_date, event.end_date, shortDate) : null;
  const location = formatAddress({ city_name: event.city_name, province_name: event.province_name });

  return (
    <Link
      href={`/events/${event.id}`}
      className="group block overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-lg"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-muted">
        {event.hero_image_url ? (
          <Image
            src={event.hero_image_url}
            alt=""
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : null}
        {event.status !== "open" ? (
          <span
            className={cn(
              "absolute left-3 top-3 rounded-pill px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
              event.status === "cancelled"
                ? "bg-destructive text-destructive-foreground"
                : "bg-amber text-white",
            )}
          >
            {event.status === "cancelled" ? "Cancelled" : event.status}
          </span>
        ) : null}
      </div>

      <div className="p-5">
        {event.org_name ? (
          <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-primary">{event.org_name}</p>
        ) : null}
        <h3 className="mt-1.5 text-[20px] font-semibold tracking-[-0.4px] text-foreground">{event.name}</h3>

        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          {date ? <span>{date}</span> : null}
          {location ? <span>{location}</span> : null}
        </div>

        {event.distances.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {event.distances.map((d) => (
              <span key={d} className="rounded-pill bg-secondary px-2.5 py-1 text-[12px] font-semibold text-secondary-foreground">
                {d}K
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter site test event-card
```

Expected: PASS — 6 tests.

- [ ] **Step 6: Write the site header**

Create `apps/site/components/SiteHeader.tsx`:

```tsx
import Link from "next/link";
import Image from "next/image";

export function SiteHeader() {
  return (
    <header className="no-print sticky top-0 z-40 border-b border-divider bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" aria-label="Race Pace home">
          {/* Served from public/ by path, not a static import — width and height
              are explicit so there is no layout shift. Source is 700x372. */}
          <Image src="/topnav-logo.png" alt="Race Pace" width={60} height={32} priority />
        </Link>
        <nav className="flex items-center gap-6 text-[14px] font-medium">
          <Link href="/events" className="text-foreground hover:text-primary">Races</Link>
          <Link href="/races" className="text-foreground hover:text-primary">My Races</Link>
          <Link href="/profile" className="text-foreground hover:text-primary">Profile</Link>
        </nav>
      </div>
    </header>
  );
}
```

Copy the logo asset in:

```bash
mkdir -p apps/site/public && cp apps/web/src/assets/topnav-logo.png apps/site/public/topnav-logo.png
```

- [ ] **Step 7: Write the events index**

Create `apps/site/app/events/page.tsx`:

```tsx
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { fetchMarketplaceEvents } from "@/lib/events";
import { EventCard } from "@/components/EventCard";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Races",
  description: "Every trail and ultra-trail race on Race Pace.",
};

// Slot counts must never be stale — a sold-out distance showing as available
// is a race-week support incident.
export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const db = await createClient();
  const events = await fetchMarketplaceEvents(db);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-6 py-12">
        <h1 className="text-[40px] font-semibold tracking-[-1px] text-foreground">Races</h1>
        <p className="mt-2 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
          Trail and ultra-trail races across Mindanao. Pick a distance and claim your slot.
        </p>

        {events.length === 0 ? (
          <p className="mt-12 text-muted-foreground">No races are open right now. Check back soon.</p>
        ) : (
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((e) => <EventCard key={e.id} event={e} />)}
          </div>
        )}
      </main>
    </>
  );
}
```

- [ ] **Step 8: Write the home page**

Replace `apps/site/app/page.tsx`:

```tsx
import Link from "next/link";
import Image from "next/image";
import { formatDateRange, formatAddress } from "@race-pace/shared";
import { createClient } from "@/lib/supabase/server";
import { fetchMarketplaceEvents } from "@/lib/events";
import { EventCard } from "@/components/EventCard";
import { SiteHeader } from "@/components/SiteHeader";
import { longDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = await createClient();
  const events = await fetchMarketplaceEvents(db);

  // Hero the nearest upcoming open event; everything else fills the grid.
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events.filter((e) => e.status === "open" && (e.event_date ?? "") >= today);
  const hero = upcoming[0] ?? null;
  const rest = events.filter((e) => e.id !== hero?.id);

  return (
    <>
      <SiteHeader />
      <main>
        {hero ? (
          <section className="relative isolate flex min-h-[70vh] items-end overflow-hidden">
            {hero.hero_image_url ? (
              <Image src={hero.hero_image_url} alt="" fill priority sizes="100vw" className="object-cover" />
            ) : (
              <div className="absolute inset-0 bg-forest" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />
            <div className="relative mx-auto w-full max-w-6xl px-6 pb-16">
              {hero.org_name ? (
                <p className="text-[12px] font-semibold uppercase tracking-[1.5px] text-white/75">{hero.org_name}</p>
              ) : null}
              <h1 className="mt-3 max-w-3xl text-[clamp(2.5rem,7vw,4.5rem)] font-semibold leading-[1.03] tracking-[-1.5px] text-white">
                {hero.name}
              </h1>
              <p className="mt-4 text-[17px] text-white/85">
                {[
                  hero.event_date ? formatDateRange(hero.event_date, hero.end_date, longDate) : null,
                  formatAddress({ city_name: hero.city_name, province_name: hero.province_name }) || null,
                ].filter(Boolean).join(" · ")}
              </p>
              <Link
                href={`/events/${hero.id}`}
                className="mt-8 inline-flex rounded-pill bg-primary px-8 py-4 text-[16px] font-semibold text-primary-foreground hover:bg-primary-focus"
              >
                View race
              </Link>
            </div>
          </section>
        ) : null}

        <section className="mx-auto w-full max-w-6xl px-6 py-16">
          <h2 className="text-[28px] font-semibold tracking-[-0.6px] text-foreground">All races</h2>
          {rest.length === 0 ? (
            <p className="mt-6 text-muted-foreground">No other races are listed right now.</p>
          ) : (
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {rest.map((e) => <EventCard key={e.id} event={e} />)}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
```

- [ ] **Step 9: Write the event detail page with Open Graph metadata**

Create `apps/site/app/events/[id]/page.tsx`:

```tsx
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPeso, formatDateRange, formatAddress } from "@race-pace/shared";
import { createClient } from "@/lib/supabase/server";
import { fetchEvent, fetchCategories } from "@/lib/events";
import { SiteHeader } from "@/components/SiteHeader";
import { longDate } from "@/lib/format";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// This is the whole point of server rendering: an organizer pasting the link
// into a Facebook group gets a real preview card.
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const db = await createClient();
  const event = await fetchEvent(db, id);
  if (!event) return { title: "Race not found" };

  const date = event.event_date ? formatDateRange(event.event_date, event.end_date, longDate) : "";
  const distances = event.distances.length ? `${event.distances.map((d) => `${d}K`).join(" · ")}. ` : "";
  const description = `${distances}${date}${event.city_name ? ` · ${event.city_name}` : ""}`.trim();

  return {
    title: event.name,
    description: description || undefined,
    openGraph: {
      title: event.name,
      description: description || undefined,
      type: "website",
      images: event.hero_image_url ? [{ url: event.hero_image_url }] : undefined,
    },
  };
}

export default async function EventPage({ params }: Params) {
  const { id } = await params;
  const db = await createClient();
  const event = await fetchEvent(db, id);
  if (!event) notFound();

  const categories = await fetchCategories(db, id);
  const date = event.event_date ? formatDateRange(event.event_date, event.end_date, longDate) : null;
  const location = formatAddress({ city_name: event.city_name, province_name: event.province_name });
  const closed = event.status !== "open";

  return (
    <>
      <SiteHeader />
      <main>
        <section className="relative isolate flex min-h-[55vh] items-end overflow-hidden">
          {event.hero_image_url ? (
            <Image src={event.hero_image_url} alt="" fill priority sizes="100vw" className="object-cover" />
          ) : (
            <div className="absolute inset-0 bg-forest" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
          <div className="relative mx-auto w-full max-w-5xl px-6 pb-12">
            {event.org_name ? (
              <p className="text-[12px] font-semibold uppercase tracking-[1.5px] text-white/75">{event.org_name}</p>
            ) : null}
            <h1 className="mt-3 text-[clamp(2rem,5.5vw,3.5rem)] font-semibold leading-[1.05] tracking-[-1.2px] text-white">
              {event.name}
            </h1>
            <p className="mt-4 text-[16px] text-white/85">
              {[date, location, event.venue].filter(Boolean).join(" · ")}
            </p>
          </div>
        </section>

        <div className="mx-auto w-full max-w-5xl px-6 py-14">
          {event.status_note ? (
            <p className="mb-10 rounded-xl border border-amber bg-amber-tint px-5 py-4 text-[15px] text-foreground">
              {event.status_note}
            </p>
          ) : null}

          {event.description ? (
            <p className="max-w-2xl text-[19px] leading-relaxed text-foreground">{event.description}</p>
          ) : null}

          <dl className="mt-10 grid grid-cols-2 gap-6 border-y border-divider py-8 sm:grid-cols-4">
            <Stat label="Elevation" value={event.elevation_gain_m ? `${event.elevation_gain_m.toLocaleString()} m` : "—"} />
            <Stat label="Cut-off" value={event.cutoff_hours ? `${event.cutoff_hours} h` : "—"} />
            <Stat label="Distances" value={event.distances.length ? event.distances.map((d) => `${d}K`).join(" · ") : "—"} />
            <Stat label="Registered" value={String(event.joined_count)} />
          </dl>

          <h2 className="mt-14 text-[28px] font-semibold tracking-[-0.6px] text-foreground">Choose your distance</h2>
          <div className="mt-6 flex flex-col gap-4">
            {categories.map((c) => {
              const soldOut = c.slots_taken >= c.slots_total;
              const remaining = Math.max(0, c.slots_total - c.slots_taken);
              return (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-6">
                  <div>
                    <h3 className="text-[20px] font-semibold text-foreground">{c.label}</h3>
                    <p className="mt-1 text-[14px] text-muted-foreground">
                      {soldOut ? "Sold out" : `${remaining} of ${c.slots_total} slots left`}
                    </p>
                  </div>
                  <div className="flex items-center gap-5">
                    <span className="text-[22px] font-semibold tabular-nums text-foreground">{formatPeso(c.base_price)}</span>
                    {soldOut || closed ? (
                      <span className="rounded-pill bg-muted px-6 py-3 text-[15px] font-semibold text-muted-foreground">
                        {closed ? "Closed" : "Sold out"}
                      </span>
                    ) : (
                      <Link
                        href={`/register/${c.id}`}
                        className="rounded-pill bg-primary px-7 py-3 text-[15px] font-semibold text-primary-foreground hover:bg-primary-focus"
                      >
                        Register
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
            {categories.length === 0 ? (
              <p className="text-muted-foreground">Distances haven&apos;t been published yet.</p>
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[1px] text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 text-[18px] font-semibold text-foreground">{value}</dd>
    </div>
  );
}
```

- [ ] **Step 10: Verify against the live backend**

```bash
pnpm --filter site dev
```

Visit `http://localhost:3000`. Expected: the hero shows the nearest upcoming seeded event, the grid shows the rest, and `/events/<id>` lists distances with prices from Task 0's seed. Confirm the Open Graph tags render:

```bash
curl -s http://localhost:3000/events/00000000-0000-0000-0000-0000000000e1 | grep -o '<meta property="og:[^>]*>'
```

Expected: `og:title` carrying the event name, and `og:description`.

- [ ] **Step 11: Full verification**

```bash
pnpm --filter site typecheck && pnpm --filter site test && pnpm --filter site build
```

Expected: all pass.

- [ ] **Step 12: Commit**

```bash
git add apps/site
git commit -m "feat(site): public catalog — home, events index, event detail

Server Components on the anon key, force-dynamic so slot counts are never
stale. generateMetadata gives event pages real Open Graph cards, which is
the acquisition channel for a near-term race.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Draft persistence, error mapping, profile, registration client

Pure logic and data access for the wizard, split out so Task 8 is purely UI. The idempotency-key rule here is the single most important detail in the plan: get it wrong and runners create duplicate paid registrations.

**Files:**
- Create: `apps/site/lib/draft.ts`, `apps/site/lib/errors.ts`, `apps/site/lib/profile.ts`, `apps/site/lib/registration.ts`
- Test: `apps/site/lib/__tests__/draft.test.ts`, `apps/site/lib/__tests__/errors.test.ts`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/client` (Task 3); `RegistrationInput` from `@race-pace/shared`.
- Produces, from `@/lib/draft`:
  - `type RegistrationDraft = { idempotencyKey: string; step: number; details: Record<string, string>; kit: Record<string, string>; firstUltra: boolean; values: Record<string, unknown>; addonIds: string[]; waiver: boolean; saveBack: boolean }`
  - `newDraft(categoryId: string): RegistrationDraft`
  - `loadDraft(categoryId: string): RegistrationDraft | null`
  - `saveDraft(categoryId: string, draft: RegistrationDraft): void`
  - `clearDraft(categoryId: string): void`
- Produces, from `@/lib/errors`: `checkoutErrorMessage(code: string): string`, `parseFunctionError(error: unknown): Promise<string>`.
- Produces, from `@/lib/profile`: `type Profile`, `getProfile(userId: string): Promise<Profile | null>`, `upsertProfile(row: Partial<Profile> & { id: string }): Promise<{ error?: string }>`.
- Produces, from `@/lib/registration`: `type RegistrationRow`, `type RegistrationPayment`, `mapReg(r: any): RegistrationRow`, `startCheckout(input: RegistrationInput): Promise<{ registration_id: string; checkout_url: string }>`, `verifyPayment(rid: string): Promise<{ status: string }>`, `createMethodCheckout(rid: string, method: string): Promise<string | null>`, `fetchRegistration(rid: string): Promise<RegistrationRow | null>`, `useRegistration(rid: string, opts?: { poll?: boolean; enabled?: boolean })` — skipped when `rid` is empty, `fetchMyRegistrations(): Promise<RegistrationRow[]>`, `useMyRegistrations()`, `cancelRegistration(rid: string): Promise<void>`.

- [ ] **Step 1: Write the failing draft test**

Create `apps/site/lib/__tests__/draft.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { newDraft, loadDraft, saveDraft, clearDraft } from "../draft";

beforeEach(() => sessionStorage.clear());

describe("draft persistence", () => {
  it("returns null when nothing is stored", () => {
    expect(loadDraft("cat1")).toBeNull();
  });

  it("round-trips a draft", () => {
    const d = newDraft("cat1");
    d.step = 2;
    d.details.bib_name = "JUAN";
    d.addonIds = ["a1", "a2"];
    saveDraft("cat1", d);

    const loaded = loadDraft("cat1");
    expect(loaded?.step).toBe(2);
    expect(loaded?.details.bib_name).toBe("JUAN");
    expect(loaded?.addonIds).toEqual(["a1", "a2"]);
  });

  it("scopes drafts per category", () => {
    saveDraft("cat1", { ...newDraft("cat1"), step: 3 });
    expect(loadDraft("cat2")).toBeNull();
  });

  it("clears a draft", () => {
    saveDraft("cat1", newDraft("cat1"));
    clearDraft("cat1");
    expect(loadDraft("cat1")).toBeNull();
  });

  // THE critical guarantee. apps/mobile generates its key with
  // useState(() => `${categoryId}:${Date.now()}`), which on the web mints a
  // NEW key on every refresh — and the server's
  // onConflict:"user_id,idempotency_key" upsert then creates a SECOND
  // pending registration instead of reusing the first.
  it("keeps the idempotency key stable across a reload", () => {
    const first = newDraft("cat1");
    saveDraft("cat1", first);

    const afterReload = loadDraft("cat1");
    expect(afterReload!.idempotencyKey).toBe(first.idempotencyKey);
  });

  it("generates a distinct key per new draft", () => {
    expect(newDraft("cat1").idempotencyKey).not.toBe(newDraft("cat1").idempotencyKey);
  });

  it("generates a key long enough for the server schema", () => {
    // registrationInputSchema requires idempotency_key.min(8).
    expect(newDraft("cat1").idempotencyKey.length).toBeGreaterThanOrEqual(8);
  });

  it("returns null rather than throwing on corrupted storage", () => {
    sessionStorage.setItem("rp:draft:cat1", "{not json");
    expect(loadDraft("cat1")).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing error-mapping test**

Create `apps/site/lib/__tests__/errors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checkoutErrorMessage } from "../errors";

describe("checkoutErrorMessage", () => {
  it("explains a sold-out distance", () => {
    expect(checkoutErrorMessage("sold_out")).toBe("This distance just sold out. Try another distance for this race.");
  });

  it("points an already-paid runner at their ticket", () => {
    expect(checkoutErrorMessage("not_pending")).toBe("You've already paid for this registration. Check My Races for your ticket.");
  });

  it("covers every error code the edge functions return", () => {
    for (const code of [
      "sold_out", "not_pending", "waiver_required", "invalid_custom_data",
      "invalid_input", "unauthorized", "category_not_found",
      "registration_not_found", "registration_failed", "server_error",
    ]) {
      expect(checkoutErrorMessage(code)).not.toBe("");
      expect(checkoutErrorMessage(code)).not.toContain("_");
    }
  });

  it("falls back to readable copy for an unknown code", () => {
    expect(checkoutErrorMessage("something_new")).toBe("Something went wrong. Please try again.");
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

```bash
pnpm --filter site test -- draft errors
```

Expected: FAIL — cannot resolve `../draft` or `../errors`.

- [ ] **Step 4: Write `lib/draft.ts`**

```ts
export type RegistrationDraft = {
  /** Generated ONCE per draft and persisted with it. See the note below. */
  idempotencyKey: string;
  step: number;
  /** Step 1 — profile-key fields: bib_name, date_of_birth, gender, emergency_contact, full_name. */
  details: Record<string, string>;
  /** Step 2 — kit pills: shirt_size, blood_type. */
  kit: Record<string, string>;
  firstUltra: boolean;
  /** Step 2 — the organizer's own form_fields, keyed by field.key. */
  values: Record<string, unknown>;
  addonIds: string[];
  waiver: boolean;
  saveBack: boolean;
};

const key = (categoryId: string) => `rp:draft:${categoryId}`;

/** The idempotency key is minted here and then persisted, NEVER regenerated on
 *  load. apps/mobile can get away with `useState(() => Date.now())` because a
 *  native screen is not reloaded mid-flow; a browser tab is. Regenerating on
 *  refresh defeats the server's onConflict:"user_id,idempotency_key" upsert and
 *  produces a second pending registration. */
export function newDraft(categoryId: string): RegistrationDraft {
  return {
    idempotencyKey: `${categoryId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
    step: 1,
    details: {},
    kit: {},
    firstUltra: false,
    values: {},
    addonIds: [],
    waiver: false,
    saveBack: false,
  };
}

export function loadDraft(categoryId: string): RegistrationDraft | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(key(categoryId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RegistrationDraft;
  } catch {
    // Corrupted storage must never block a runner from registering.
    return null;
  }
}

export function saveDraft(categoryId: string, draft: RegistrationDraft): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key(categoryId), JSON.stringify(draft));
  } catch {
    // Private-mode quota errors are not worth failing the flow over.
  }
}

export function clearDraft(categoryId: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(key(categoryId));
}
```

**Why `sessionStorage` and not `localStorage`:** a registration takes minutes, and a stale draft should not survive on a shared machine. The trade-off — closing the tab loses the draft — is acceptable and deliberate.

- [ ] **Step 5: Write `lib/errors.ts`**

```ts
import { FunctionsHttpError } from "@supabase/supabase-js";

const MESSAGES: Record<string, string> = {
  sold_out: "This distance just sold out. Try another distance for this race.",
  not_pending: "You've already paid for this registration. Check My Races for your ticket.",
  waiver_required: "Please accept the event waiver before registering.",
  invalid_custom_data: "Some answers need fixing. Check the highlighted fields.",
  invalid_input: "Some details are missing or invalid. Check the form and try again.",
  unauthorized: "Your session expired. Please sign in again.",
  category_not_found: "This distance is no longer available.",
  registration_not_found: "We couldn't find that registration.",
  registration_failed: "We couldn't save your registration. Please try again.",
  server_error: "Something went wrong on our end. Please try again.",
};

export function checkoutErrorMessage(code: string): string {
  return MESSAGES[code] ?? "Something went wrong. Please try again.";
}

/** Edge Functions return their error code in the response BODY, not the
 *  message — supabase-js only surfaces "Edge Function returned a non-2xx
 *  status code" without this. Mirrors apps/mobile/lib/registration.ts. */
export async function parseFunctionError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body?.error) return checkoutErrorMessage(String(body.error));
    } catch {
      // Fall through to the generic message.
    }
  }
  return checkoutErrorMessage("server_error");
}
```

- [ ] **Step 6: Run both tests to verify they pass**

```bash
pnpm --filter site test -- draft errors
```

Expected: PASS — 12 tests.

- [ ] **Step 7: Write `lib/profile.ts`**

Mirrors `apps/mobile/lib/profile.ts`, using the browser client.

```ts
import { createClient } from "@/lib/supabase/client";

export type Profile = {
  id: string;
  full_name: string | null;
  bib_name: string | null;
  city: string | null;
  emergency_contact?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  shirt_size?: string | null;
  blood_type?: string | null;
  city_psgc_code?: string | null;
  city_name?: string | null;
  province_name?: string | null;
  avatar_url?: string | null;
  cover_url?: string | null;
};

const PROFILE_COLS =
  "id,full_name,bib_name,city,emergency_contact,date_of_birth,gender,shirt_size,blood_type,city_psgc_code,city_name,province_name,avatar_url,cover_url";

export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = createClient();
  const { data } = await supabase.from("profiles").select(PROFILE_COLS).eq("id", userId).maybeSingle();
  return data as Profile | null;
}

/** Partial upsert: PostgREST merge-duplicates updates only the provided columns. */
export async function upsertProfile(row: Partial<Profile> & { id: string }): Promise<{ error?: string }> {
  const supabase = createClient();
  const { error } = await supabase.from("profiles").upsert(row);
  return error ? { error: error.message } : {};
}
```

- [ ] **Step 8: Write `lib/registration.ts`**

Mirrors `apps/mobile/lib/registration.ts`, with the return URL pointing at the web callback instead of the `racepace://` deep link.

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import type { RegistrationInput } from "@race-pace/shared";
import { createClient } from "@/lib/supabase/client";
import { parseFunctionError } from "@/lib/errors";

export type CheckoutResult = { registration_id: string; checkout_url: string };

/** Where PayMongo sends the runner after pay/cancel. Mobile uses a
 *  racepace:// deep link; the web equivalent is a real route. */
export function payReturnUrl(registrationId: string): string {
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
  return `${origin}/pay/callback?rid=${encodeURIComponent(registrationId)}`;
}

export async function startCheckout(input: RegistrationInput): Promise<CheckoutResult> {
  const supabase = createClient();
  // The registration id isn't known yet, so the return URL carries no rid here;
  // /pay/callback falls back to the rid the pay page stored. The per-method
  // session created in createMethodCheckout does include it.
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
  const body = { ...input, return_url: `${origin}/pay/callback` };
  const { data, error } = await supabase.functions.invoke("registrations-checkout", { body });
  if (error) throw new Error(await parseFunctionError(error));
  return data as CheckoutResult;
}

/** Confirm server-side by re-fetching the PayMongo session — the redirect is
 *  never trusted. Best-effort: on any error, polling drives the outcome. */
export async function verifyPayment(registrationId: string): Promise<{ status: string }> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.functions.invoke("payment-verify", {
      body: { registration_id: registrationId },
    });
    if (error) return { status: "pending" };
    return (data as { status: string }) ?? { status: "pending" };
  } catch {
    return { status: "pending" };
  }
}

/** Recreate the checkout scoped to the chosen method so PayMongo opens straight
 *  to it. Returns null on any error; the pay page falls back to the all-methods
 *  session created at registration. */
export async function createMethodCheckout(registrationId: string, method: string): Promise<string | null> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.functions.invoke("payment-session", {
      body: { registration_id: registrationId, method, return_url: payReturnUrl(registrationId) },
    });
    if (error) return null;
    return (data as { checkout_url?: string })?.checkout_url ?? null;
  } catch {
    return null;
  }
}

export type RegistrationPayment = {
  createdAt: string | null; method: string | null; amount: number | null;
  platformFee: number | null; netToOrg: number | null; provider: string | null;
  providerRef: string | null; status: string | null;
};

export type RegistrationRow = {
  id: string; status: string; total_amount: number; ticket_token: string | null; org_id: string;
  eventName: string; categoryLabel: string; categoryDistance: number | null; checkoutUrl: string | null;
  eventStatus: string | null; eventDate: string | null; originalDate: string | null; statusNote: string | null;
  orgName: string | null; eventHeroUrl: string | null; basePrice: number | null; inclusions: string[] | null;
  payment: RegistrationPayment | null;
};

const REG_SELECT =
  "id,status,total_amount,ticket_token,org_id,organizations(name),events(name,status,event_date,original_date,status_note,hero_image_url,inclusions),categories(label,distance_km,base_price),payments(checkout_url,created_at,method,amount,platform_fee,net_to_org,provider,provider_ref,status)";

export function mapReg(r: any): RegistrationRow {
  const payment = Array.isArray(r.payments) ? r.payments[0] : r.payments;
  return {
    id: r.id, status: r.status, total_amount: r.total_amount,
    ticket_token: r.ticket_token ?? null, org_id: r.org_id,
    eventName: r.events?.name ?? "Event",
    categoryLabel: r.categories?.label ?? "",
    categoryDistance: r.categories?.distance_km ?? null,
    orgName: r.organizations?.name ?? null,
    eventHeroUrl: r.events?.hero_image_url ?? null,
    basePrice: r.categories?.base_price ?? null,
    inclusions: r.events?.inclusions ?? null,
    checkoutUrl: payment?.checkout_url ?? null,
    eventStatus: r.events?.status ?? null,
    eventDate: r.events?.event_date ?? null,
    originalDate: r.events?.original_date ?? null,
    statusNote: r.events?.status_note ?? null,
    payment: payment
      ? {
          createdAt: payment.created_at ?? null, method: payment.method ?? null,
          amount: payment.amount ?? null, platformFee: payment.platform_fee ?? null,
          netToOrg: payment.net_to_org ?? null, provider: payment.provider ?? null,
          providerRef: payment.provider_ref ?? null, status: payment.status ?? null,
        }
      : null,
  };
}

export async function fetchRegistration(rid: string): Promise<RegistrationRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase.from("registrations").select(REG_SELECT).eq("id", rid).maybeSingle();
  if (error) throw error;
  return data ? mapReg(data) : null;
}

/** `enabled` matters on /pay/callback, where the rid is recovered inside an
 *  effect and is briefly "". Querying `.eq("id", "")` against a uuid column is
 *  a Postgres error, so the query must not run until the rid is known. */
export function useRegistration(rid: string, opts?: { poll?: boolean; enabled?: boolean }) {
  return useQuery({
    queryKey: ["registration", rid],
    queryFn: () => fetchRegistration(rid),
    enabled: (opts?.enabled ?? true) && !!rid,
    refetchInterval: opts?.poll
      ? (query) => (query.state.data?.status === "paid" ? false : 3000)
      : false,
  });
}

/** RLS `registrations_read_own` restricts rows to the signed-in user. */
export async function fetchMyRegistrations(): Promise<RegistrationRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("registrations").select(REG_SELECT).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapReg);
}

export function useMyRegistrations() {
  return useQuery({ queryKey: ["my-registrations"], queryFn: fetchMyRegistrations });
}

/** Delete an unpaid registration. RLS `registrations_delete_own_pending`
 *  restricts this to the owner's own pending rows. A zero-row delete means RLS
 *  blocked it, which must surface as an error rather than a silent success. */
export async function cancelRegistration(rid: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.from("registrations").delete().eq("id", rid).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("not_cancellable");
}
```

- [ ] **Step 9: Add the TanStack Query provider**

Create `apps/site/app/providers.tsx`:

```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  // One client per browser session, created lazily so it is never shared
  // across requests on the server.
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
  }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

Wrap the app in `apps/site/app/layout.tsx` — change the body line to:

```tsx
      <body><Providers>{children}</Providers></body>
```

and add the import:

```tsx
import { Providers } from "./providers";
```

- [ ] **Step 10: Full verification**

```bash
pnpm --filter site typecheck && pnpm --filter site test && pnpm --filter site build
```

Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add apps/site
git commit -m "feat(site): draft persistence, error mapping, registration client

The idempotency key is minted once and persisted with the draft rather
than regenerated on load — mobile's Date.now() pattern would mint a new
key on every browser refresh and defeat the server's
onConflict:user_id,idempotency_key upsert, creating duplicate pending
registrations.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: The registration wizard

Three in-form steps then the pay page, shown as a four-dot rail. The largest single task. **Invoke the `frontend-design` skill before writing the step components.**

**Files:**
- Create: `apps/site/components/PillSelect.tsx`, `apps/site/components/DynamicField.tsx`, `apps/site/components/StepRail.tsx`, `apps/site/components/TicketStub.tsx`, `apps/site/lib/wizard.ts`, `apps/site/app/register/[categoryId]/page.tsx`, `apps/site/app/register/[categoryId]/RegisterWizard.tsx`
- Test: `apps/site/lib/__tests__/wizard.test.ts`, `apps/site/app/register/__tests__/wizard.test.tsx`

**Interfaces:**
- Consumes: everything from Task 7; `fetchCategory`, `fetchEvent`, `fetchAddons`, `fetchFormFields`, `FormFieldRow`, `CategoryRow`, `AddonRow` (Task 5); `customDataSchema`, `isProfileKey`, `SHIRT_SIZES`, `BLOOD_TYPES`, `GENDERS`, `formatPeso`, `type FormField` from `@race-pace/shared`.
- Produces, from `@/lib/wizard`:
  - `totalAmount(basePrice: number, addons: AddonRow[], selectedIds: string[]): number`
  - `stepOneErrors(details: Record<string, string>, requiredKeys: string[]): Record<string, string>`
  - `showSaveBack(profile: Profile | null, kit: Record<string, string>): boolean`
  - `WAIVER_TEXT: string`
- Produces components `PillSelect`, `DynamicField`, `StepRail`, `TicketStub`.

- [ ] **Step 1: Add the shadcn primitives this task needs**

```bash
cd apps/site && pnpm dlx shadcn@latest add checkbox switch dialog toggle-group
```

Then apply the token fix — `grep -rn "var(--" apps/site/components/ui/` and rewrite any hit that is not `var(--color-*)`.

- [ ] **Step 2: Write the failing wizard-logic test**

Create `apps/site/lib/__tests__/wizard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { totalAmount, stepOneErrors, showSaveBack } from "../wizard";
import type { Profile } from "../profile";

const addons = [
  { id: "a1", name: "Finisher shirt", price: 45000 },
  { id: "a2", name: "Drop bag", price: 15000 },
];

describe("totalAmount", () => {
  it("returns the base price when nothing is selected", () => {
    expect(totalAmount(250000, addons, [])).toBe(250000);
  });

  it("adds every selected add-on", () => {
    expect(totalAmount(250000, addons, ["a1", "a2"])).toBe(310000);
  });

  it("ignores an id that is not a real add-on", () => {
    expect(totalAmount(250000, addons, ["ghost"])).toBe(250000);
  });

  // Money is integer centavos end to end — a float here would reach PayMongo.
  it("stays an integer", () => {
    expect(Number.isInteger(totalAmount(250000, addons, ["a1"]))).toBe(true);
  });
});

describe("stepOneErrors", () => {
  it("is empty when every required field is filled", () => {
    expect(stepOneErrors({ bib_name: "JUAN", date_of_birth: "1990-01-01" }, ["bib_name", "date_of_birth"])).toEqual({});
  });

  it("flags a missing required field", () => {
    expect(stepOneErrors({ bib_name: "" }, ["bib_name"])).toEqual({ bib_name: "This is required." });
  });

  it("treats whitespace as missing", () => {
    expect(stepOneErrors({ bib_name: "   " }, ["bib_name"])).toEqual({ bib_name: "This is required." });
  });

  it("ignores fields the organizer did not request", () => {
    expect(stepOneErrors({ bib_name: "JUAN" }, ["bib_name"])).toEqual({});
  });
});

describe("showSaveBack", () => {
  const empty: Profile = { id: "u1", full_name: null, bib_name: null, city: null };

  it("offers save-back when the profile was empty and the runner filled a field", () => {
    expect(showSaveBack(empty, { shirt_size: "M" })).toBe(true);
  });

  it("offers save-back when the runner changed an existing value", () => {
    expect(showSaveBack({ ...empty, shirt_size: "S" }, { shirt_size: "M" })).toBe(true);
  });

  it("stays hidden when nothing changed", () => {
    expect(showSaveBack({ ...empty, shirt_size: "M" }, { shirt_size: "M" })).toBe(false);
  });

  it("stays hidden when the runner cleared a field rather than setting one", () => {
    expect(showSaveBack({ ...empty, shirt_size: "M" }, { shirt_size: "" })).toBe(false);
  });

  it("handles a null profile for a brand-new account", () => {
    expect(showSaveBack(null, { shirt_size: "M" })).toBe(true);
  });

  // gender lives in draft.details, not draft.kit — the wizard passes a merged
  // object, so this key must be honoured too.
  it("offers save-back for gender", () => {
    expect(showSaveBack(empty, { gender: "Male" })).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm --filter site test -- wizard
```

Expected: FAIL — cannot resolve `../wizard`.

- [ ] **Step 4: Write `lib/wizard.ts`**

```ts
import type { AddonRow } from "@/lib/events";
import type { Profile } from "@/lib/profile";

/** Kit fields the wizard can write back to the Race Passport. */
const SAVE_BACK_KEYS = ["gender", "shirt_size", "blood_type"] as const;

export const WAIVER_TEXT =
  "I understand that trail and ultra running is an inherently dangerous activity, held over remote and technical terrain, in variable weather, and often far from immediate medical care. I confirm that I am medically fit to take part and have trained appropriately for this distance.\n\n" +
  "I accept full responsibility for my own safety and assume all risks associated with the event — including injury, illness, and in extreme cases death. I agree to follow all race rules, marshal instructions, and mandatory-gear requirements, and to retire from the course if instructed or if I cannot continue safely.\n\n" +
  "To the fullest extent permitted by law, I release the organizer, its staff, volunteers, sponsors, and landowners from liability for any loss, injury, or damage arising from my participation, and I consent to receive first aid or emergency medical treatment if needed.";

/** Integer centavos throughout — never introduce a float here. */
export function totalAmount(basePrice: number, addons: AddonRow[], selectedIds: string[]): number {
  const selected = new Set(selectedIds);
  return addons.reduce((sum, a) => (selected.has(a.id) ? sum + a.price : sum), basePrice);
}

export function stepOneErrors(
  details: Record<string, string>,
  requiredKeys: string[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const k of requiredKeys) {
    if (!(details[k] ?? "").trim()) errors[k] = "This is required.";
  }
  return errors;
}

/** Mirrors apps/mobile's filledFromEmpty || editedExisting logic: offer to save
 *  when the runner supplied something the passport lacked, or changed something
 *  it had. Clearing a field is not an edit worth persisting. */
export function showSaveBack(profile: Profile | null, kit: Record<string, string>): boolean {
  return SAVE_BACK_KEYS.some((k) => {
    const existing = ((profile?.[k] as string | null) ?? "").trim();
    const next = (kit[k] ?? "").trim();
    if (!next) return false;
    return existing === "" || existing !== next;
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter site test -- wizard
```

Expected: PASS — 14 tests.

- [ ] **Step 6: Write `components/PillSelect.tsx`**

```tsx
"use client";

import { cn } from "@/lib/utils";

export function PillSelect({ label, value, options, onChange, error }: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <fieldset className="mt-6">
      <legend className="text-[11px] font-semibold uppercase tracking-[0.6px] text-muted-foreground">{label}</legend>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = value === opt;
          return (
            <button
              key={opt}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(opt)}
              className={cn(
                "rounded-pill border px-4 py-2 text-[14px] transition-colors",
                active
                  ? "border-primary bg-primary font-semibold text-primary-foreground"
                  : "border-border text-foreground hover:border-primary",
              )}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}
    </fieldset>
  );
}
```

- [ ] **Step 7: Write `components/DynamicField.tsx`**

Renders one organizer-configured `form_fields` row. Mirrors `apps/mobile/components/DynamicField.tsx`.

```tsx
"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { PillSelect } from "@/components/PillSelect";
import type { FormFieldRow } from "@/lib/events";

export function DynamicField({ field, value, onChange, error }: {
  field: FormFieldRow;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
}) {
  const label = `${field.label}${field.required ? " *" : ""}`;

  if (field.type === "select") {
    return (
      <PillSelect
        label={label}
        value={(value as string) ?? ""}
        options={field.options ?? []}
        onChange={onChange}
        error={error}
      />
    );
  }

  if (field.type === "checkbox") {
    return (
      <div className="mt-6 flex items-center gap-3 rounded-lg border border-border p-4">
        <Checkbox id={field.key} checked={!!value} onCheckedChange={(c) => onChange(c === true)} />
        <Label htmlFor={field.key} className="text-[14px]">{label}</Label>
      </div>
    );
  }

  if (field.type === "file") {
    return (
      <p className="mt-6 text-[14px] italic text-muted-foreground">
        {field.label}: file uploads aren&apos;t supported on the web yet.
      </p>
    );
  }

  const inputType = field.type === "number" ? "number" : field.type === "date" ? "date" : "text";

  return (
    <div className="mt-6 flex flex-col gap-2">
      <Label htmlFor={field.key}>{label}</Label>
      <Input
        id={field.key}
        type={inputType}
        value={value != null ? String(value) : ""}
        onChange={(e) => {
          const raw = e.target.value;
          // A number field must yield a number (or undefined), never a string —
          // customDataSchema types it as z.number().
          onChange(field.type === "number" ? (raw === "" ? undefined : Number(raw)) : raw);
        }}
        aria-invalid={!!error}
      />
      {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
    </div>
  );
}
```

- [ ] **Step 8: Write `components/StepRail.tsx` and `components/TicketStub.tsx`**

```tsx
import { cn } from "@/lib/utils";

const STEPS = ["Your details", "Kit & extras", "Review", "Pay"];

export function StepRail({ current }: { current: number }) {
  return (
    <ol className="no-print flex items-center gap-2" aria-label="Registration progress">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "current" : "todo";
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold",
                state === "todo" && "bg-muted text-muted-foreground",
                state === "current" && "bg-primary text-primary-foreground",
                state === "done" && "bg-secondary text-secondary-foreground",
              )}
            >
              {n}
            </span>
            <span className={cn("hidden text-[13px] sm:inline", state === "current" ? "font-semibold text-foreground" : "text-muted-foreground")}>
              {label}
            </span>
            {n < STEPS.length ? <span className="h-px flex-1 bg-divider" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
```

```tsx
import { formatPeso } from "@race-pace/shared";

/** The ticket-stub summary that appears on register, pay, and the ticket —
 *  a forest panel with a dashed perforation and notched edges. */
export function TicketStub({ eventName, categoryLabel, meta, amountLabel, amount }: {
  eventName: string;
  categoryLabel: string;
  meta?: string;
  amountLabel: string;
  amount: number;
}) {
  return (
    <div className="overflow-hidden rounded-xl bg-forest">
      <div className="px-5 pt-5">
        <p className="text-[10.5px] font-semibold uppercase tracking-[1.2px] text-[#7FE0A6]">{eventName}</p>
        <p className="mt-1 text-[19px] font-bold tracking-[-0.3px] text-white">{categoryLabel}</p>
        {meta ? <p className="mt-1.5 text-[12px] text-white/70">{meta}</p> : null}
      </div>
      <div className="relative my-1 h-4">
        <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-white/30" />
        <div className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-background" />
        <div className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-background" />
      </div>
      <div className="flex items-center justify-between px-5 pb-4">
        <span className="text-[10px] font-semibold uppercase tracking-[1px] text-white/60">{amountLabel}</span>
        <span className="text-[18px] font-bold tabular-nums text-white">{formatPeso(amount)}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Write the failing wizard component test**

Create `apps/site/app/register/__tests__/wizard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RegisterWizard } from "../[categoryId]/RegisterWizard";
import type { CategoryRow, AddonRow, FormFieldRow, EventRow } from "@/lib/events";

const category: CategoryRow = {
  id: "c1", event_id: "e1", org_id: "a1", code: "100k", label: "100K",
  distance_km: 100, base_price: 250000, slots_total: 100, slots_taken: 10,
};

const event = { id: "e1", name: "Apo Sky Ultra 2026", event_date: "2026-11-14", end_date: null, org_name: "Race Pace" } as EventRow;
const addons: AddonRow[] = [{ id: "ad1", name: "Finisher shirt", price: 45000 }];
const fields: FormFieldRow[] = [
  { id: "f1", key: "shirt_size", label: "Shirt size", type: "select", required: true, options: ["S", "M", "L"], sort_order: 1 },
  { id: "f2", key: "club", label: "Running club", type: "text", required: false, options: null, sort_order: 2 },
];

const startCheckout = vi.fn();
vi.mock("@/lib/registration", () => ({
  startCheckout: (...a: unknown[]) => startCheckout(...a),
}));
vi.mock("@/lib/profile", () => ({
  getProfile: vi.fn().mockResolvedValue(null),
  upsertProfile: vi.fn().mockResolvedValue({}),
}));

beforeEach(() => {
  sessionStorage.clear();
  startCheckout.mockReset();
  startCheckout.mockResolvedValue({ registration_id: "r1", checkout_url: "https://checkout.paymongo.com/x" });
});

function renderWizard() {
  return render(
    <RegisterWizard userId="u1" category={category} event={event} addons={addons} formFields={fields} />,
  );
}

describe("RegisterWizard", () => {
  it("starts on step 1 with the entry fee shown", () => {
    renderWizard();
    expect(screen.getByText("Your details")).toBeInTheDocument();
    expect(screen.getByText("₱2,500.00")).toBeInTheDocument();
  });

  it("blocks advancing past step 1 while a required detail is empty", async () => {
    renderWizard();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findAllByText("This is required.")).not.toHaveLength(0);
    expect(screen.getByText("Your details")).toBeInTheDocument();
  });

  it("adds a selected add-on to the total", async () => {
    renderWizard();
    await userEvent.type(screen.getByLabelText(/Bib name/), "JUAN");
    await userEvent.type(screen.getByLabelText(/Date of birth/), "1990-01-01");
    await userEvent.type(screen.getByLabelText(/Emergency contact/), "Maria 09171234567");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    await userEvent.click(screen.getByRole("button", { name: "Finisher shirt" }));
    expect(screen.getByText("₱2,950.00")).toBeInTheDocument();
  });

  it("refuses to submit without the waiver accepted", async () => {
    renderWizard();
    await userEvent.type(screen.getByLabelText(/Bib name/), "JUAN");
    await userEvent.type(screen.getByLabelText(/Date of birth/), "1990-01-01");
    await userEvent.type(screen.getByLabelText(/Emergency contact/), "Maria 09171234567");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByRole("button", { name: "M" }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    await userEvent.click(screen.getByRole("button", { name: /Register/ }));
    expect(startCheckout).not.toHaveBeenCalled();
  });

  it("persists the draft so a remount resumes the same step", async () => {
    const { unmount } = renderWizard();
    await userEvent.type(screen.getByLabelText(/Bib name/), "JUAN");
    await userEvent.type(screen.getByLabelText(/Date of birth/), "1990-01-01");
    await userEvent.type(screen.getByLabelText(/Emergency contact/), "Maria 09171234567");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    unmount();

    renderWizard();
    expect(await screen.findByText("Kit & extras")).toBeInTheDocument();
  });

  // Guards the duplicate-registration bug from Task 7.
  it("reuses the persisted idempotency key after a remount", async () => {
    const { unmount } = renderWizard();
    await userEvent.type(screen.getByLabelText(/Bib name/), "JUAN");
    const keyBefore = JSON.parse(sessionStorage.getItem("rp:draft:c1")!).idempotencyKey;
    unmount();

    renderWizard();
    const keyAfter = JSON.parse(sessionStorage.getItem("rp:draft:c1")!).idempotencyKey;
    expect(keyAfter).toBe(keyBefore);
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

```bash
pnpm --filter site test -- register
```

Expected: FAIL — cannot resolve `../[categoryId]/RegisterWizard`.

- [ ] **Step 11: Write the wizard client component**

Create `apps/site/app/register/[categoryId]/RegisterWizard.tsx`. It owns all wizard state, persists on every change, and submits on step 3.

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  customDataSchema, isProfileKey, formatPeso, formatDateRange,
  SHIRT_SIZES, BLOOD_TYPES, GENDERS, type FormField,
} from "@race-pace/shared";
import type { CategoryRow, AddonRow, FormFieldRow, EventRow } from "@/lib/events";
import { loadDraft, newDraft, saveDraft, clearDraft, type RegistrationDraft } from "@/lib/draft";
import { totalAmount, stepOneErrors, showSaveBack, WAIVER_TEXT } from "@/lib/wizard";
import { getProfile, upsertProfile, type Profile } from "@/lib/profile";
import { startCheckout } from "@/lib/registration";
import { longDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PillSelect } from "@/components/PillSelect";
import { DynamicField } from "@/components/DynamicField";
import { StepRail } from "@/components/StepRail";
import { TicketStub } from "@/components/TicketStub";
import { cn } from "@/lib/utils";

export function RegisterWizard({ userId, category, event, addons, formFields }: {
  userId: string;
  category: CategoryRow;
  event: EventRow;
  addons: AddonRow[];
  formFields: FormFieldRow[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<RegistrationDraft>(() => loadDraft(category.id) ?? newDraft(category.id));
  const [profile, setProfile] = useState<Profile | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [waiverOpen, setWaiverOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const prefilled = useRef(false);

  // Persist on every change — a refresh mid-flow must not lose progress, and
  // must not mint a new idempotency key.
  useEffect(() => { saveDraft(category.id, draft); }, [category.id, draft]);

  // Prefill from the Race Passport once, and never over a value the runner
  // already typed (a resumed draft wins).
  useEffect(() => {
    if (prefilled.current) return;
    prefilled.current = true;
    getProfile(userId).then((p) => {
      if (!p) return;
      setProfile(p);
      setDraft((d) => ({
        ...d,
        details: {
          full_name: d.details.full_name || (p.full_name ?? ""),
          bib_name: d.details.bib_name || (p.bib_name ?? ""),
          date_of_birth: d.details.date_of_birth || (p.date_of_birth ?? ""),
          gender: d.details.gender || (p.gender ?? ""),
          emergency_contact: d.details.emergency_contact || (p.emergency_contact ?? ""),
        },
        kit: {
          shirt_size: d.kit.shirt_size || (p.shirt_size ?? ""),
          blood_type: d.kit.blood_type || (p.blood_type ?? ""),
        },
      }));
    });
  }, [userId]);

  const eventQuestions = useMemo(() => formFields.filter((f) => !isProfileKey(f.key)), [formFields]);
  const requestedProfileKeys = useMemo(
    () => new Set(formFields.filter((f) => isProfileKey(f.key)).map((f) => f.key)),
    [formFields],
  );
  const total = totalAmount(category.base_price, addons, draft.addonIds);
  const dateLabel = event.event_date ? formatDateRange(event.event_date, event.end_date, longDate) : null;
  const stubMeta = [dateLabel, event.org_name].filter(Boolean).join(" · ");

  const patch = (p: Partial<RegistrationDraft>) => setDraft((d) => ({ ...d, ...p }));
  const setDetail = (k: string, v: string) => setDraft((d) => ({ ...d, details: { ...d.details, [k]: v } }));
  const setKit = (k: string, v: string) => setDraft((d) => ({ ...d, kit: { ...d.kit, [k]: v } }));
  const setValue = (k: string, v: unknown) => setDraft((d) => ({ ...d, values: { ...d.values, [k]: v } }));

  // bib_name, date_of_birth and emergency_contact are always required on the
  // web — mobile can rely on the passport, a first-time web signup cannot.
  const REQUIRED_DETAILS = ["bib_name", "date_of_birth", "emergency_contact"];

  function next() {
    setFormError(null);
    if (draft.step === 1) {
      const errs = stepOneErrors(draft.details, REQUIRED_DETAILS);
      setErrors(errs);
      if (Object.keys(errs).length) return;
    }
    if (draft.step === 2) {
      const eventFields: FormField[] = eventQuestions.map((f) => ({
        key: f.key, label: f.label, type: f.type, required: f.required, options: f.options ?? undefined,
      }));
      const parsed = customDataSchema(eventFields).safeParse(draft.values);
      if (!parsed.success) {
        const fieldErrors = parsed.error.flatten().fieldErrors;
        setErrors(Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, v?.[0] ?? "Invalid"])));
        return;
      }
      // A required profile-key field must be present; the server enforces this
      // too, so skipping it here just produces a worse error later.
      // `||` not `??`: a key present-but-empty in `details` must still fall
      // through to `kit`, and `??` only falls through on null/undefined.
      const missing = formFields
        .filter((f) => isProfileKey(f.key) && f.required)
        .map((f) => f.key)
        .filter((k) => !(draft.details[k] || draft.kit[k] || "").trim());
      if (missing.length) {
        setErrors(Object.fromEntries(missing.map((k) => [k, "This is required."])));
        return;
      }
      setErrors({});
    }
    patch({ step: draft.step + 1 });
  }

  async function submit() {
    if (!draft.waiver) { setFormError("Please accept the waiver to continue."); return; }
    setBusy(true);
    setFormError(null);
    try {
      if (draft.saveBack) {
        // Best-effort — a passport write must never block a registration.
        try {
          await upsertProfile({
            id: userId,
            gender: draft.details.gender || null,
            shirt_size: draft.kit.shirt_size || null,
            blood_type: draft.kit.blood_type || null,
          });
        } catch { /* ignore */ }
      }

      const res = await startCheckout({
        event_id: category.event_id,
        category_id: category.id,
        addon_ids: draft.addonIds,
        custom_data: {
          bib_name: draft.details.bib_name,
          date_of_birth: draft.details.date_of_birth,
          gender: draft.details.gender,
          shirt_size: draft.kit.shirt_size,
          blood_type: draft.kit.blood_type,
          emergency_contact: draft.details.emergency_contact,
          first_ultra: draft.firstUltra,
          ...draft.values,
        },
        waiver_accepted: true,
        idempotency_key: draft.idempotencyKey,
      });

      clearDraft(category.id);
      router.replace(`/pay/${res.registration_id}`);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Registration failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <StepRail current={draft.step} />

      <div className="mt-8">
        <TicketStub
          eventName={event.name}
          categoryLabel={category.label}
          meta={stubMeta || undefined}
          amountLabel={draft.addonIds.length ? "Total" : "Entry fee"}
          amount={total}
        />
      </div>

      {draft.step === 1 ? (
        <section className="mt-8">
          <h2 className="text-[24px] font-semibold tracking-[-0.5px] text-foreground">Your details</h2>
          <div className="mt-6 flex flex-col gap-2">
            <Label htmlFor="full_name">Full name</Label>
            <Input id="full_name" value={draft.details.full_name ?? ""} onChange={(e) => setDetail("full_name", e.target.value)} />
          </div>
          <div className="mt-6 flex flex-col gap-2">
            <Label htmlFor="bib_name">Bib name *</Label>
            <Input id="bib_name" value={draft.details.bib_name ?? ""} onChange={(e) => setDetail("bib_name", e.target.value)} aria-invalid={!!errors.bib_name} />
            <p className="text-[13px] text-muted-foreground">Printed on your race bib.</p>
            {errors.bib_name ? <p className="text-[13px] text-destructive">{errors.bib_name}</p> : null}
          </div>
          <div className="mt-6 flex flex-col gap-2">
            <Label htmlFor="date_of_birth">Date of birth *</Label>
            <Input id="date_of_birth" type="date" value={draft.details.date_of_birth ?? ""} onChange={(e) => setDetail("date_of_birth", e.target.value)} aria-invalid={!!errors.date_of_birth} />
            {errors.date_of_birth ? <p className="text-[13px] text-destructive">{errors.date_of_birth}</p> : null}
          </div>
          <div className="mt-6 flex flex-col gap-2">
            <Label htmlFor="emergency_contact">Emergency contact *</Label>
            <Input id="emergency_contact" value={draft.details.emergency_contact ?? ""} onChange={(e) => setDetail("emergency_contact", e.target.value)} placeholder="Name and mobile number" aria-invalid={!!errors.emergency_contact} />
            {errors.emergency_contact ? <p className="text-[13px] text-destructive">{errors.emergency_contact}</p> : null}
          </div>
          {requestedProfileKeys.has("gender") ? (
            <PillSelect label="GENDER" value={draft.details.gender ?? ""} options={GENDERS} onChange={(v) => setDetail("gender", v)} error={errors.gender} />
          ) : null}
        </section>
      ) : null}

      {draft.step === 2 ? (
        <section className="mt-8">
          <h2 className="text-[24px] font-semibold tracking-[-0.5px] text-foreground">Kit &amp; extras</h2>
          <PillSelect label="SHIRT SIZE" value={draft.kit.shirt_size ?? ""} options={SHIRT_SIZES} onChange={(v) => setKit("shirt_size", v)} error={errors.shirt_size} />
          {requestedProfileKeys.has("blood_type") ? (
            <PillSelect label="BLOOD TYPE" value={draft.kit.blood_type ?? ""} options={BLOOD_TYPES} onChange={(v) => setKit("blood_type", v)} error={errors.blood_type} />
          ) : null}

          <div className="mt-6 flex items-center gap-3 rounded-lg border border-border p-4">
            <Checkbox id="first_ultra" checked={draft.firstUltra} onCheckedChange={(c) => patch({ firstUltra: c === true })} />
            <Label htmlFor="first_ultra" className="text-[14px]">First ultra at this distance?</Label>
          </div>

          {eventQuestions.map((f) => (
            <DynamicField key={f.id} field={f} value={draft.values[f.key]} onChange={(v) => setValue(f.key, v)} error={errors[f.key]} />
          ))}

          {addons.length > 0 ? (
            <>
              <h3 className="mt-10 text-[15px] font-semibold text-foreground">Add-ons</h3>
              <div className="mt-3 flex flex-col gap-3">
                {addons.map((a) => {
                  const on = draft.addonIds.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => patch({ addonIds: on ? draft.addonIds.filter((id) => id !== a.id) : [...draft.addonIds, a.id] })}
                      className={cn(
                        "flex items-center justify-between rounded-lg border p-4 text-left transition-colors",
                        on ? "border-primary bg-secondary" : "border-border hover:border-primary",
                      )}
                    >
                      <span className="text-[14px] font-medium text-foreground">{a.name}</span>
                      <span className="text-[14px] font-semibold text-primary">+{formatPeso(a.price)}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          {/* Merged: gender lives in `details`, shirt/blood in `kit`, and all
              three are what submit() writes back to the passport. */}
          {showSaveBack(profile, { ...draft.details, ...draft.kit }) ? (
            <div className="mt-6 flex items-center gap-3 rounded-lg border border-border p-4">
              <Checkbox id="save_back" checked={draft.saveBack} onCheckedChange={(c) => patch({ saveBack: c === true })} />
              <Label htmlFor="save_back" className="text-[14px]">Save these details to my profile</Label>
            </div>
          ) : null}
        </section>
      ) : null}

      {draft.step === 3 ? (
        <section className="mt-8">
          <h2 className="text-[24px] font-semibold tracking-[-0.5px] text-foreground">Review</h2>
          <dl className="mt-6 divide-y divide-divider rounded-xl border border-border">
            <Row label="Bib name" value={draft.details.bib_name} />
            <Row label="Date of birth" value={draft.details.date_of_birth} />
            <Row label="Emergency contact" value={draft.details.emergency_contact} />
            {draft.kit.shirt_size ? <Row label="Shirt size" value={draft.kit.shirt_size} /> : null}
            {draft.kit.blood_type ? <Row label="Blood type" value={draft.kit.blood_type} /> : null}
            <Row label="Entry fee" value={formatPeso(category.base_price)} />
            {draft.addonIds.length ? (
              <Row label="Add-ons" value={`+${formatPeso(total - category.base_price)}`} />
            ) : null}
            <Row label="Total" value={formatPeso(total)} strong />
          </dl>

          <div className="mt-6 flex items-start gap-3 rounded-lg border border-border p-4">
            <Checkbox id="waiver" checked={draft.waiver} onCheckedChange={(c) => patch({ waiver: c === true })} />
            <Label htmlFor="waiver" className="text-[13px] leading-relaxed">
              I accept the event{" "}
              <button type="button" className="font-semibold text-primary underline" onClick={() => setWaiverOpen(true)}>
                waiver
              </button>{" "}
              and confirm I&apos;m medically fit to take part.
            </Label>
          </div>
        </section>
      ) : null}

      {formError ? <p className="mt-6 text-[14px] text-destructive">{formError}</p> : null}

      <div className="mt-10 flex items-center gap-3">
        {draft.step > 1 ? (
          <Button type="button" variant="outline" className="h-auto rounded-pill px-6 py-4" onClick={() => patch({ step: draft.step - 1 })}>
            Back
          </Button>
        ) : null}
        {draft.step < 3 ? (
          <Button type="button" className="h-auto flex-1 rounded-pill py-4 text-[16px] font-semibold" onClick={next}>
            Continue
          </Button>
        ) : (
          <Button type="button" disabled={busy} className="h-auto flex-1 rounded-pill py-4 text-[16px] font-semibold" onClick={submit}>
            {busy ? "Submitting…" : `Register · ${formatPeso(total)}`}
          </Button>
        )}
      </div>

      <Dialog open={waiverOpen} onOpenChange={setWaiverOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Event waiver</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto whitespace-pre-line text-[14px] leading-relaxed text-foreground">
            {WAIVER_TEXT}
          </div>
          <Button type="button" className="mt-4 h-auto rounded-pill py-3" onClick={() => { patch({ waiver: true }); setWaiverOpen(false); }}>
            I accept
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5">
      <dt className="text-[14px] text-muted-foreground">{label}</dt>
      <dd className={cn("text-[14px] text-foreground", strong && "text-[16px] font-semibold")}>{value}</dd>
    </div>
  );
}
```

- [ ] **Step 12: Write the wizard page (Server Component)**

Create `apps/site/app/register/[categoryId]/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchCategory, fetchEvent, fetchAddons, fetchFormFields } from "@/lib/events";
import { SiteHeader } from "@/components/SiteHeader";
import { RegisterWizard } from "./RegisterWizard";

export const dynamic = "force-dynamic";

export default async function RegisterPage({ params }: { params: Promise<{ categoryId: string }> }) {
  const { categoryId } = await params;
  const db = await createClient();

  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/register/${categoryId}`)}`);

  const category = await fetchCategory(db, categoryId);
  if (!category) notFound();

  const [event, addons, formFields] = await Promise.all([
    fetchEvent(db, category.event_id),
    fetchAddons(db, category.event_id),
    fetchFormFields(db, category.event_id),
  ]);
  if (!event) notFound();

  // Slot state is authoritative on the server at submit time, but there is no
  // reason to walk a runner through three steps just to reject them.
  if (category.slots_taken >= category.slots_total) {
    redirect(`/events/${category.event_id}?soldout=${categoryId}`);
  }

  return (
    <>
      <SiteHeader />
      <main>
        <RegisterWizard
          userId={user.id}
          category={category}
          event={event}
          addons={addons}
          formFields={formFields}
        />
      </main>
    </>
  );
}
```

- [ ] **Step 13: Run the test to verify it passes**

```bash
pnpm --filter site test -- register
```

Expected: PASS — 6 tests.

- [ ] **Step 14: Full verification**

```bash
pnpm --filter site typecheck && pnpm --filter site test && pnpm --filter site build
```

Expected: all pass.

- [ ] **Step 15: Commit**

```bash
git add apps/site
git commit -m "feat(site): registration wizard

Three in-form steps then pay, with the draft persisted to sessionStorage
on every change so a refresh resumes rather than restarts. Validation
runs against the same @race-pace/shared schemas the edge function uses,
so the browser cannot accept input the server will reject.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Payment and callback

Web redirects fully off-site to PayMongo and back, so unlike mobile there is no in-memory state to preserve — `/pay/callback` is the resume point.

**Files:**
- Create: `apps/site/lib/payment.ts`, `apps/site/app/pay/[registrationId]/page.tsx`, `apps/site/app/pay/[registrationId]/PayPanel.tsx`, `apps/site/app/pay/callback/page.tsx`, `apps/site/app/pay/callback/CallbackPanel.tsx`
- Test: `apps/site/lib/__tests__/payment.test.ts`

**Interfaces:**
- Consumes: `useRegistration`, `verifyPayment`, `createMethodCheckout`, `RegistrationRow` (Task 7); `TicketStub` (Task 8); `formatPeso` from `@race-pace/shared`.
- Produces, from `@/lib/payment`: `PAY_METHODS: { key: string; label: string }[]`, `breakdown(total: number, basePrice: number | null): { entry: number; addons: number }`, `POLL_MS: 3000`, `TIMEOUT_MS: 90_000`.

- [ ] **Step 1: Write the failing test**

Create `apps/site/lib/__tests__/payment.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { breakdown, PAY_METHODS } from "../payment";

describe("breakdown", () => {
  it("splits a total into entry fee and add-ons", () => {
    expect(breakdown(310000, 250000)).toEqual({ entry: 250000, addons: 60000 });
  });

  it("reports zero add-ons when the total equals the base price", () => {
    expect(breakdown(250000, 250000)).toEqual({ entry: 250000, addons: 0 });
  });

  // basePrice is null when the category embed is missing; the whole total is
  // then the entry fee rather than a negative add-on line.
  it("treats the whole total as entry fee when base price is unknown", () => {
    expect(breakdown(250000, null)).toEqual({ entry: 250000, addons: 0 });
  });

  // A category price cut after registration must never render as negative.
  it("never reports a negative add-on total", () => {
    expect(breakdown(200000, 250000).addons).toBe(0);
  });
});

describe("PAY_METHODS", () => {
  it("offers the three methods the payment-session function accepts", () => {
    expect(PAY_METHODS.map((m) => m.key)).toEqual(["card", "gcash", "maya"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter site test -- payment
```

Expected: FAIL — cannot resolve `../payment`.

- [ ] **Step 3: Write `lib/payment.ts`**

```ts
/** Keys must match METHOD_MAP in supabase/functions/payment-session/index.ts —
 *  it rejects anything else. Maya is "paymaya" to PayMongo; the function maps it. */
export const PAY_METHODS = [
  { key: "card", label: "Card" },
  { key: "gcash", label: "GCash" },
  { key: "maya", label: "Maya" },
];

export const POLL_MS = 3000;
export const TIMEOUT_MS = 90_000;

export function breakdown(total: number, basePrice: number | null): { entry: number; addons: number } {
  const entry = basePrice ?? total;
  return { entry, addons: Math.max(0, total - entry) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter site test -- payment
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Write the pay panel**

Create `apps/site/app/pay/[registrationId]/PayPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { formatPeso } from "@race-pace/shared";
import { useRegistration, createMethodCheckout } from "@/lib/registration";
import { PAY_METHODS, breakdown } from "@/lib/payment";
import { TicketStub } from "@/components/TicketStub";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PayPanel({ registrationId }: { registrationId: string }) {
  const reg = useRegistration(registrationId);
  const [method, setMethod] = useState("gcash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (reg.isLoading) return <p className="py-20 text-center text-muted-foreground">Loading…</p>;
  if (!reg.data) return <p className="py-20 text-center text-muted-foreground">We couldn&apos;t find that registration.</p>;

  const total = reg.data.total_amount;
  const { entry, addons } = breakdown(total, reg.data.basePrice);
  const inclusions = reg.data.inclusions ?? [];

  async function pay() {
    setBusy(true);
    setError(null);
    // Remember which registration is in flight, so /pay/callback can recover
    // it if PayMongo drops the rid from the return URL.
    sessionStorage.setItem("rp:paying", registrationId);

    const scoped = await createMethodCheckout(registrationId, method);
    const url = scoped ?? reg.data!.checkoutUrl;
    if (!url) {
      setBusy(false);
      setError("No checkout link is available. Go back and try registering again.");
      return;
    }
    // Full-page redirect off-site; /pay/callback resumes when PayMongo returns.
    window.location.assign(url);
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="text-[28px] font-semibold tracking-[-0.6px] text-foreground">Payment</h1>

      <div className="mt-6">
        <TicketStub
          eventName={reg.data.eventName}
          categoryLabel={reg.data.categoryLabel}
          amountLabel="Total due"
          amount={total}
        />
      </div>

      <dl className="mt-5 divide-y divide-divider overflow-hidden rounded-xl border border-border">
        <div className="flex justify-between px-5 py-3.5">
          <dt className="text-[14px] text-muted-foreground">Entry fee</dt>
          <dd className="text-[14px] font-semibold tabular-nums text-foreground">{formatPeso(entry)}</dd>
        </div>
        {addons > 0 ? (
          <div className="flex justify-between px-5 py-3.5">
            <dt className="text-[14px] text-muted-foreground">Add-ons</dt>
            <dd className="text-[14px] font-semibold tabular-nums text-foreground">+{formatPeso(addons)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between px-5 py-3.5">
          <dt className="text-[14px] text-muted-foreground">Booking fee</dt>
          <dd className="text-[14px] font-semibold text-primary">Free</dd>
        </div>
      </dl>

      {inclusions.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-[15px] font-semibold text-foreground">What&apos;s included</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {inclusions.map((item, i) => (
              <li key={i} className="flex items-center gap-2.5 text-[14px] text-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {item}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <h2 className="mt-8 text-[11px] font-semibold uppercase tracking-[0.6px] text-muted-foreground">Pay with</h2>
      <div className="mt-3 flex flex-col gap-3">
        {PAY_METHODS.map((m) => (
          <button
            key={m.key}
            type="button"
            aria-pressed={method === m.key}
            onClick={() => setMethod(m.key)}
            className={cn(
              "flex items-center justify-between rounded-lg border-[1.5px] p-4 text-left transition-colors",
              method === m.key ? "border-primary bg-secondary" : "border-border hover:border-primary",
            )}
          >
            <span className="text-[15px] font-semibold text-foreground">{m.label}</span>
            <span className={cn("h-5 w-5 rounded-full border-[1.5px]", method === m.key ? "border-primary bg-primary" : "border-border")} />
          </button>
        ))}
      </div>

      {error ? <p className="mt-5 text-[14px] text-destructive">{error}</p> : null}

      <Button type="button" disabled={busy} onClick={pay} className="mt-8 h-auto w-full rounded-pill py-4 text-[16px] font-semibold">
        {busy ? "Opening…" : `Pay ${formatPeso(total)}`}
      </Button>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-[13px] text-muted-foreground">
        <Lock size={13} /> Encrypted and secured by PayMongo
      </p>
    </div>
  );
}
```

- [ ] **Step 6: Write the pay page**

Create `apps/site/app/pay/[registrationId]/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/SiteHeader";
import { PayPanel } from "./PayPanel";

export const dynamic = "force-dynamic";

export default async function PayPage({ params }: { params: Promise<{ registrationId: string }> }) {
  const { registrationId } = await params;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/pay/${registrationId}`)}`);

  // An already-paid registration has nothing to pay — send them to the ticket.
  const { data: reg } = await db.from("registrations").select("status").eq("id", registrationId).maybeSingle();
  if (reg?.status === "paid") redirect(`/ticket/${registrationId}`);

  return (
    <>
      <SiteHeader />
      <main><PayPanel registrationId={registrationId} /></main>
    </>
  );
}
```

- [ ] **Step 7: Write the callback panel**

Create `apps/site/app/pay/callback/CallbackPanel.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { verifyPayment, useRegistration } from "@/lib/registration";
import { POLL_MS, TIMEOUT_MS } from "@/lib/payment";
import { Button } from "@/components/ui/button";

export function CallbackPanel() {
  const router = useRouter();
  const params = useSearchParams();
  const [rid, setRid] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const cancelled = params.get("status") === "cancel";

  // PayMongo returns with our rid, but recover from sessionStorage if it is
  // missing — the runner has already paid at that point and must not be stranded.
  useEffect(() => {
    const fromQuery = params.get("rid");
    setRid(fromQuery ?? sessionStorage.getItem("rp:paying"));
  }, [params]);

  const reg = useRegistration(rid ?? "", { poll: !!rid && !cancelled });
  const verified = useRef(false);

  // Confirm server-side. The redirect itself is never trusted — payment-verify
  // re-fetches the session from PayMongo.
  useEffect(() => {
    if (!rid || cancelled || verified.current) return;
    verified.current = true;
    verifyPayment(rid).then(() => reg.refetch());
  }, [rid, cancelled, reg]);

  useEffect(() => {
    if (!rid || cancelled) return;
    const t = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [rid, cancelled]);

  useEffect(() => {
    if (reg.data?.status === "paid" && rid) {
      sessionStorage.removeItem("rp:paying");
      router.replace(`/ticket/${rid}`);
    }
  }, [reg.data?.status, rid, router]);

  if (cancelled && rid) {
    return (
      <Panel title="Payment cancelled" body="No payment was taken. Your slot is still held — you can try again.">
        <Button asChild className="h-auto rounded-pill px-8 py-4 text-[16px] font-semibold">
          <Link href={`/pay/${rid}`}>Back to payment</Link>
        </Button>
      </Panel>
    );
  }

  if (!rid) {
    return (
      <Panel title="We lost track of that payment" body="If you completed a payment, it will still be confirmed. Check My Races in a moment.">
        <Button asChild className="h-auto rounded-pill px-8 py-4 text-[16px] font-semibold">
          <Link href="/races">Go to My Races</Link>
        </Button>
      </Panel>
    );
  }

  return (
    <Panel
      title="Confirming your payment…"
      body={
        timedOut
          ? "Still processing. If you completed payment, it will confirm shortly — you can also check again."
          : "This usually takes a few seconds."
      }
    >
      <Button
        type="button"
        onClick={() => verifyPayment(rid).then(() => reg.refetch())}
        className="h-auto rounded-pill px-8 py-4 text-[16px] font-semibold"
      >
        Check again
      </Button>
    </Panel>
  );
}

function Panel({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-[26px] font-semibold tracking-[-0.5px] text-foreground">{title}</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{body}</p>
      <div className="mt-8">{children}</div>
    </div>
  );
}
```

- [ ] **Step 8: Write the callback page**

`useSearchParams` requires a Suspense boundary in an App Router page.

Create `apps/site/app/pay/callback/page.tsx`:

```tsx
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/SiteHeader";
import { CallbackPanel } from "./CallbackPanel";

export const dynamic = "force-dynamic";

export default async function PayCallbackPage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/sign-in?next=%2Fraces");

  return (
    <>
      <SiteHeader />
      <main>
        <Suspense fallback={<p className="py-20 text-center text-muted-foreground">Loading…</p>}>
          <CallbackPanel />
        </Suspense>
      </main>
    </>
  );
}
```

- [ ] **Step 9: Full verification**

```bash
pnpm --filter site typecheck && pnpm --filter site test && pnpm --filter site build
```

Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add apps/site
git commit -m "feat(site): payment method selection and PayMongo callback

Full-page redirect off-site and back, so /pay/callback is the resume
point rather than in-memory state. Payment is always confirmed through
payment-verify, which re-fetches the session server-side — the redirect
is never trusted. The rid is stashed in sessionStorage so a return
without it does not strand a runner who has already paid.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Ticket page

**Files:**
- Create: `apps/site/components/TicketCard.tsx`, `apps/site/app/ticket/[registrationId]/page.tsx`, `apps/site/app/ticket/[registrationId]/TicketPanel.tsx`
- Test: `apps/site/components/__tests__/ticket-card.test.tsx`

**Interfaces:**
- Consumes: `useRegistration`, `RegistrationRow` (Task 7); `getProfile` (Task 7); `longDate` (Task 5).
- Produces: `TicketCard({ token, eventName, categoryLabel, eventDate, reference, runnerName, bibName, distanceKm })`.

- [ ] **Step 1: Write the failing test**

Create `apps/site/components/__tests__/ticket-card.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TicketCard } from "../TicketCard";

const props = {
  token: "signed.ticket.token",
  eventName: "Apo Sky Ultra 2026",
  categoryLabel: "100K",
  eventDate: "2026-11-14",
  reference: "A1B2C3D4",
  runnerName: "Juan Dela Cruz",
  bibName: "JUAN",
  distanceKm: 100,
};

describe("TicketCard", () => {
  it("shows the event, category, and date", () => {
    render(<TicketCard {...props} />);
    expect(screen.getByText("Apo Sky Ultra 2026")).toBeInTheDocument();
    expect(screen.getByText(/100K/)).toBeInTheDocument();
    expect(screen.getByText("14 November 2026")).toBeInTheDocument();
  });

  it("renders a scannable QR carrying the signed token", () => {
    const { container } = render(<TicketCard {...props} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("shows the reference code and runner details", () => {
    render(<TicketCard {...props} />);
    expect(screen.getByText("A1B2C3D4")).toBeInTheDocument();
    expect(screen.getByText("Juan Dela Cruz")).toBeInTheDocument();
    expect(screen.getByText("JUAN")).toBeInTheDocument();
  });

  it("falls back to the reference when there is no bib name", () => {
    render(<TicketCard {...props} bibName={null} />);
    expect(screen.getAllByText("A1B2C3D4").length).toBeGreaterThanOrEqual(1);
  });

  it("renders without a distance", () => {
    render(<TicketCard {...props} distanceKm={null} />);
    expect(screen.getByText("Apo Sky Ultra 2026")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter site test ticket-card
```

Expected: FAIL — cannot resolve `../TicketCard`.

- [ ] **Step 3: Write `components/TicketCard.tsx`**

```tsx
"use client";

import { QRCodeSVG } from "qrcode.react";
import { longDate } from "@/lib/format";

export function TicketCard({
  token, eventName, categoryLabel, eventDate, reference, runnerName, bibName, distanceKm,
}: {
  token: string;
  eventName: string;
  categoryLabel: string;
  eventDate: string | null;
  reference: string;
  runnerName: string | null;
  bibName: string | null;
  distanceKm: number | null;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="bg-forest p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.5px] text-white/60">
          Race pass · {categoryLabel}
        </p>
        <h1 className="mt-2 text-[22px] font-bold tracking-[-0.3px] text-white">{eventName}</h1>
        {eventDate ? <p className="mt-1.5 text-[13px] text-white/75">{longDate(eventDate)}</p> : null}
      </div>

      <div className="flex flex-col items-center border-t border-dashed border-border p-7">
        {/* White quiet zone is required — scanners fail against a dark surface. */}
        <div className="rounded-xl border border-border bg-white p-3.5">
          <QRCodeSVG value={token} size={168} level="M" />
        </div>
        <p className="mt-3.5 font-mono text-[13px] tracking-[1px] text-muted-foreground">{reference}</p>
        <p className="mt-1.5 text-center text-[13px] text-foreground">Show this QR at check-in.</p>
      </div>

      <dl className="grid grid-cols-2 gap-px border-t border-border bg-border">
        <Cell label="Runner" value={runnerName || "—"} />
        <Cell label="Bib" value={bibName || reference} />
        <Cell label="Category" value={categoryLabel} />
        <Cell label="Distance" value={distanceKm ? `${distanceKm} KM` : "—"} />
      </dl>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-4">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.5px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-[14px] font-semibold text-foreground">{value}</dd>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter site test ticket-card
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Write the ticket panel**

Create `apps/site/app/ticket/[registrationId]/TicketPanel.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Printer } from "lucide-react";
import { useRegistration } from "@/lib/registration";
import { getProfile } from "@/lib/profile";
import { TicketCard } from "@/components/TicketCard";
import { Button } from "@/components/ui/button";

export function TicketPanel({ registrationId, userId }: { registrationId: string; userId: string }) {
  const reg = useRegistration(registrationId);
  const [profile, setProfile] = useState<{ full_name: string | null; bib_name: string | null } | null>(null);

  useEffect(() => { getProfile(userId).then((p) => p && setProfile(p)); }, [userId]);

  const reference = registrationId.slice(0, 8).toUpperCase();

  if (reg.isLoading) return <p className="py-20 text-center text-muted-foreground">Loading…</p>;
  if (!reg.data) return <p className="py-20 text-center text-muted-foreground">We couldn&apos;t find that registration.</p>;

  if (!reg.data.ticket_token) {
    return (
      <div className="mx-auto w-full max-w-md px-6 py-20 text-center">
        <h1 className="text-[24px] font-semibold text-foreground">No ticket yet</h1>
        <p className="mt-3 text-[15px] text-muted-foreground">Complete payment to get your race pass.</p>
        <Button asChild className="mt-8 h-auto rounded-pill px-8 py-4 text-[16px] font-semibold">
          <Link href={`/pay/${registrationId}`}>Complete payment</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-6 py-10">
      {reg.data.statusNote ? (
        <p className="no-print mb-6 rounded-xl border border-amber bg-amber-tint px-4 py-3 text-[14px] text-foreground">
          {reg.data.statusNote}
        </p>
      ) : null}

      <TicketCard
        token={reg.data.ticket_token}
        eventName={reg.data.eventName}
        categoryLabel={reg.data.categoryLabel}
        eventDate={reg.data.eventDate}
        reference={reference}
        runnerName={profile?.full_name ?? null}
        bibName={profile?.bib_name ?? null}
        distanceKm={reg.data.categoryDistance}
      />

      <div className="no-print mt-6 flex flex-col gap-3">
        <Button type="button" onClick={() => window.print()} className="h-auto gap-2 rounded-pill py-4 text-[16px] font-semibold">
          <Printer size={17} /> Save as PDF / Print
        </Button>
        <p className="text-center text-[13px] text-muted-foreground">
          We&apos;ve also emailed this ticket to you. Save it offline — trailheads rarely have signal.
        </p>
        <Button asChild variant="outline" className="h-auto rounded-pill py-4 text-[15px] font-semibold">
          <Link href="/races">Back to My Races</Link>
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Write the ticket page**

Create `apps/site/app/ticket/[registrationId]/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/SiteHeader";
import { TicketPanel } from "./TicketPanel";

export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ registrationId: string }> }) {
  const { registrationId } = await params;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/ticket/${registrationId}`)}`);

  return (
    <>
      <SiteHeader />
      <main><TicketPanel registrationId={registrationId} userId={user.id} /></main>
    </>
  );
}
```

- [ ] **Step 7: Verify printing manually**

```bash
pnpm --filter site dev
```

Open a paid registration's ticket, press Cmd+P. Expected: the header, the action buttons, and the status note are hidden (`.no-print` from Task 2's stylesheet); the ticket card and QR fill one clean page.

- [ ] **Step 8: Full verification**

```bash
pnpm --filter site typecheck && pnpm --filter site test && pnpm --filter site build
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add apps/site
git commit -m "feat(site): ticket page with QR and print stylesheet

QR renders from the same signed ticket_token the mobile app and check-in
use. No PDF library: the print stylesheet plus window.print() produces a
real PDF through the OS dialog on desktop, iOS, and Android, and avoids a
second rendering path to keep in sync with the ticket design.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: `ticket-qr` Edge Function

A public PNG endpoint so the ticket email can embed the QR as a real image — Gmail and most clients strip `data:` URIs.

**Files:**
- Create: `supabase/functions/ticket-qr/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `preflight`, `corsHeaders` from `_shared/cors.ts` (Task 1).
- Produces: `GET /functions/v1/ticket-qr?token=<ticket_token>` → `image/png`.

**Security note.** This endpoint is unauthenticated by design. It renders a QR of a token the caller already holds, so it discloses nothing new; and `check-in` independently gates on `status = 'paid'` plus staff authorization for the event's org, so possession of a token alone does nothing.

- [ ] **Step 1: Add the QR dependency to the Deno import map**

Edit `supabase/functions/deno.json`:

```json
{
  "imports": {
    "zod": "npm:zod@3.23.8",
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2",
    "qrcode": "npm:qrcode@1.5.4"
  }
}
```

`qrcode`'s `toBuffer` encodes PNG in pure JS via `pngjs` — no native canvas, which would not survive the Edge runtime.

- [ ] **Step 2: Write the function**

Create `supabase/functions/ticket-qr/index.ts`:

```ts
import QRCode from "qrcode";
import { preflight, corsHeaders } from "../_shared/cors.ts";

// Renders a ticket token as a PNG QR so the confirmation email can embed it
// with a plain <img src>. Unauthenticated by design: it only re-encodes a token
// the caller already has. Authorization for check-in lives in the check-in
// function, which requires status='paid' and a staff role for the event's org.
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const cors = corsHeaders(req.headers.get("Origin"));

  const token = new URL(req.url).searchParams.get("token");
  if (!token) {
    return new Response(JSON.stringify({ error: "token_required" }), {
      status: 400,
      headers: { "content-type": "application/json", ...cors },
    });
  }

  try {
    const png: Uint8Array = await QRCode.toBuffer(token, {
      type: "png",
      width: 512,
      margin: 2,
      errorCorrectionLevel: "M",
    });

    return new Response(png, {
      status: 200,
      headers: {
        "content-type": "image/png",
        // A token's QR never changes, and email clients re-fetch aggressively.
        "cache-control": "public, max-age=31536000, immutable",
        ...cors,
      },
    });
  } catch (e) {
    console.error("[ticket-qr] render failed", e);
    return new Response(JSON.stringify({ error: "render_failed" }), {
      status: 500,
      headers: { "content-type": "application/json", ...cors },
    });
  }
});
```

- [ ] **Step 3: Allow unauthenticated access**

Append to `supabase/config.toml`, alongside the existing `verify_jwt = false` blocks:

```toml
[functions.ticket-qr]
verify_jwt = false
```

Without this the platform rejects the request before the handler runs, and the email's `<img>` renders broken.

- [ ] **Step 4: Deploy and verify it returns a real PNG**

```bash
pnpm exec supabase functions deploy ticket-qr
```

Then:

```bash
curl -s -o /tmp/qr.png -w "%{http_code} %{content_type}\n" "https://whaqarofxdlzxrelbcrq.supabase.co/functions/v1/ticket-qr?token=test-token-abc"
```

Expected: `200 image/png`. Confirm the bytes are a valid PNG:

```bash
file /tmp/qr.png
```

Expected: `PNG image data, 512 x 512`.

Then confirm the missing-token path:

```bash
curl -s -w "\n%{http_code}\n" "https://whaqarofxdlzxrelbcrq.supabase.co/functions/v1/ticket-qr"
```

Expected: `{"error":"token_required"}` and `400`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ticket-qr supabase/functions/deno.json supabase/config.toml
git commit -m "feat(functions): ticket-qr PNG endpoint for the ticket email

Gmail strips data: URIs, so the confirmation email needs a real image URL.
Unauthenticated by design — it re-encodes a token the caller already holds,
and check-in still gates on status=paid plus a staff role.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Ticket confirmation email

Sent from `confirmPayment()` — the single choke point both `payment-verify` and `payments-webhook` funnel through — so the email fires exactly once per payment regardless of which path confirms it. Mobile registrations gain ticket emails as a side effect.

**Files:**
- Create: `supabase/functions/_shared/email.ts`, `supabase/functions/_shared/email.test.ts`, `supabase/functions/send-ticket-email/index.ts`
- Modify: `supabase/functions/_shared/confirm.ts`, `supabase/config.toml`

**Interfaces:**
- Consumes: `serviceClient` from `_shared/supabase.ts`.
- Produces, from `_shared/email.ts`:
  - `renderTicketEmail(input: TicketEmailInput): { subject: string; html: string }`
  - `type TicketEmailInput = { eventName: string; categoryLabel: string; eventDate: string | null; venue: string | null; reference: string; ticketUrl: string; qrUrl: string; total: number }`
  - `sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }>`

`renderTicketEmail` is pure so it is testable under Vitest without a `Deno` global or a network call; only `sendEmail` touches `Deno.env` and Resend.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/email.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderTicketEmail } from "./email";

const input = {
  eventName: "Apo Sky Ultra 2026",
  categoryLabel: "100K",
  eventDate: "2026-11-14",
  venue: "Kapatagan Base Camp",
  reference: "A1B2C3D4",
  ticketUrl: "https://race-pace.vercel.app/ticket/r1",
  qrUrl: "https://x.supabase.co/functions/v1/ticket-qr?token=abc",
  total: 250000,
};

describe("renderTicketEmail", () => {
  it("names the event and category in the subject", () => {
    const { subject } = renderTicketEmail(input);
    expect(subject).toContain("Apo Sky Ultra 2026");
    expect(subject).toContain("100K");
  });

  it("embeds the QR as a real image URL, not a data URI", () => {
    const { html } = renderTicketEmail(input);
    expect(html).toContain(`src="${input.qrUrl}"`);
    expect(html).not.toContain("data:image");
  });

  it("links to the ticket page", () => {
    expect(renderTicketEmail(input).html).toContain(input.ticketUrl);
  });

  it("shows the reference, venue, and formatted total", () => {
    const { html } = renderTicketEmail(input);
    expect(html).toContain("A1B2C3D4");
    expect(html).toContain("Kapatagan Base Camp");
    expect(html).toContain("2,500.00");
  });

  it("renders without a date or venue", () => {
    const { html } = renderTicketEmail({ ...input, eventDate: null, venue: null });
    expect(html).toContain("Apo Sky Ultra 2026");
  });

  // An organizer-supplied event name reaches this template; unescaped it would
  // let stored HTML through into the runner's inbox.
  it("escapes HTML in the event name", () => {
    const { html } = renderTicketEmail({ ...input, eventName: '<script>alert(1)</script>' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run supabase/functions/_shared/email.test.ts
```

Expected: FAIL — cannot resolve `./email`.

- [ ] **Step 3: Write `_shared/email.ts`**

```ts
export type TicketEmailInput = {
  eventName: string;
  categoryLabel: string;
  eventDate: string | null;
  venue: string | null;
  reference: string;
  ticketUrl: string;
  qrUrl: string;
  /** Integer centavos. */
  total: number;
};

/** Event names and venues are organizer-supplied and land in a runner's inbox —
 *  escape before interpolating. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function peso(centavos: number): string {
  return "₱" + (centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

export function renderTicketEmail(input: TicketEmailInput): { subject: string; html: string } {
  const subject = `Your ${input.categoryLabel} race pass — ${input.eventName}`;
  const meta = [input.eventDate ? longDate(input.eventDate) : null, input.venue].filter(Boolean).join(" · ");

  // Table-based layout with inline styles: email clients strip <style> blocks
  // and have no flexbox or grid support worth relying on.
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;">
        <tr><td style="background:#0f2a20;padding:28px 28px 24px;">
          <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:#7FE0A6;">Race pass · ${esc(input.categoryLabel)}</p>
          <h1 style="margin:8px 0 0;font-size:24px;line-height:1.2;color:#ffffff;">${esc(input.eventName)}</h1>
          ${meta ? `<p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,0.75);">${esc(meta)}</p>` : ""}
        </td></tr>
        <tr><td align="center" style="padding:32px 28px;">
          <img src="${esc(input.qrUrl)}" width="200" height="200" alt="Your ticket QR code" style="display:block;border:0;background:#ffffff;" />
          <p style="margin:16px 0 0;font-family:monospace;font-size:14px;letter-spacing:1px;color:#7a7a7a;">${esc(input.reference)}</p>
          <p style="margin:8px 0 0;font-size:14px;color:#1d1d1f;">Show this QR at check-in.</p>
        </td></tr>
        <tr><td style="padding:0 28px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e0e0e0;">
            <tr><td style="padding:14px 0;font-size:14px;color:#7a7a7a;">Total paid</td>
                <td align="right" style="padding:14px 0;font-size:14px;font-weight:600;color:#1d1d1f;">${peso(input.total)}</td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:8px 28px 32px;">
          <a href="${esc(input.ticketUrl)}" style="display:inline-block;background:#159A55;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 32px;border-radius:9999px;">View your ticket</a>
          <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#7a7a7a;">Save this email offline — trailheads rarely have signal.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, html };
}

/** Resend's HTTP API — no SMTP client in Deno. Returns a result rather than
 *  throwing: a failed email must never fail a confirmed payment. */
export async function sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { ok: false, error: "resend_not_configured" };

  const from = Deno.env.get("EMAIL_FROM") ?? "Race Pace <tickets@racepace.ph>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!res.ok) return { ok: false, error: `resend_${res.status}: ${await res.text()}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run supabase/functions/_shared/email.test.ts
```

Expected: PASS — 6 tests.

- [ ] **Step 5: Write the `send-ticket-email` function**

Create `supabase/functions/send-ticket-email/index.ts`:

```ts
import { serviceClient } from "../_shared/supabase.ts";
import { renderTicketEmail, sendEmail } from "../_shared/email.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Invoked server-to-server from confirmPayment() with the service-role key —
// never from a browser, so no CORS handling here. Loads everything it needs
// from the registration id alone.
Deno.serve(async (req) => {
  try {
    const { registration_id: registrationId } = await req.json().catch(() => ({}));
    if (!registrationId) return json({ error: "registration_id_required" }, 400);

    const db = serviceClient();
    const { data: reg } = await db
      .from("registrations")
      .select("id,user_id,status,total_amount,ticket_token,events(name,event_date,venue),categories(label)")
      .eq("id", registrationId)
      .single();

    if (!reg) return json({ error: "not_found" }, 404);
    if (reg.status !== "paid" || !reg.ticket_token) return json({ error: "not_paid" }, 409);

    const { data: userRes } = await db.auth.admin.getUserById(reg.user_id);
    const to = userRes?.user?.email;
    if (!to) return json({ error: "no_email" }, 422);

    const siteUrl = Deno.env.get("PUBLIC_SITE_URL") ?? "https://race-pace.vercel.app";
    const functionsUrl = Deno.env.get("PUBLIC_FUNCTIONS_URL") ?? "";
    const event = reg.events as { name: string; event_date: string | null; venue: string | null } | null;
    const category = reg.categories as { label: string } | null;

    const { subject, html } = renderTicketEmail({
      eventName: event?.name ?? "Your race",
      categoryLabel: category?.label ?? "",
      eventDate: event?.event_date ?? null,
      venue: event?.venue ?? null,
      reference: reg.id.slice(0, 8).toUpperCase(),
      ticketUrl: `${siteUrl}/ticket/${reg.id}`,
      qrUrl: `${functionsUrl}/ticket-qr?token=${encodeURIComponent(reg.ticket_token)}`,
      total: reg.total_amount,
    });

    const result = await sendEmail(to, subject, html);
    if (!result.ok) {
      console.error("[send-ticket-email] send failed", { registrationId, error: result.error });
      return json({ error: "send_failed", details: result.error }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    console.error("[send-ticket-email] unexpected", e);
    return json({ error: "server_error", details: String(e) }, 500);
  }
});
```

- [ ] **Step 6: Hook it into `confirmPayment`**

In `supabase/functions/_shared/confirm.ts`, replace the final return block:

```ts
  return { ok: true, registration_id: reg.id, already: result === "already" || result === "not_pending" };
}
```

with:

```ts
  const already = result === "already" || result === "not_pending";

  // Fire the ticket email only on a genuine first confirmation, and only as
  // best-effort — a mail failure must never fail a captured payment. This is
  // the single choke point both payment-verify and payments-webhook reach, so
  // exactly one email is sent no matter which path confirms.
  if (!already) {
    try {
      await db.functions.invoke("send-ticket-email", { body: { registration_id: reg.id } });
    } catch (e) {
      console.error("[confirm] ticket email failed", { registrationId: reg.id, error: String(e) });
    }
  }

  return { ok: true, registration_id: reg.id, already };
}
```

- [ ] **Step 7: Allow unauthenticated invocation**

`confirmPayment` invokes it with the service-role key, but the platform's JWT gate runs first and rejects a service-role JWT for a function expecting a user token. Append to `supabase/config.toml`:

```toml
[functions.send-ticket-email]
verify_jwt = false
```

- [ ] **Step 8: [USER] Create the Resend account and set the secrets**

Sign up at resend.com, verify a sending domain, and create an API key. Then:

```bash
pnpm exec supabase secrets set RESEND_API_KEY="re_..." EMAIL_FROM="Race Pace <tickets@yourdomain>" PUBLIC_SITE_URL="https://race-pace.vercel.app"
```

If the domain is not verified yet, Resend only delivers to the account owner's own address — enough to test the flow end to end.

- [ ] **Step 9: Deploy and verify**

```bash
pnpm exec supabase functions deploy send-ticket-email && pnpm exec supabase functions deploy payment-verify payments-webhook
```

Both confirmation paths must be redeployed, because `confirm.ts` changed and each bundles its own copy of `_shared`.

Then complete a real test payment (card `4343 4343 4343 4345`) and confirm the email arrives with a rendering QR. Check the logs either way:

```bash
pnpm exec supabase functions logs send-ticket-email
```

- [ ] **Step 10: Run the full suite and commit**

```bash
pnpm exec vitest run
```

Expected: PASS.

```bash
git add supabase/functions/_shared/email.ts supabase/functions/_shared/email.test.ts supabase/functions/_shared/confirm.ts supabase/functions/send-ticket-email supabase/config.toml
git commit -m "feat(functions): email the ticket on payment confirmation

Fired from confirmPayment(), the single choke point both payment-verify
and payments-webhook funnel through, so exactly one email is sent per
payment regardless of which path confirms it — and mobile registrations
get ticket emails for free. Sending is best-effort: a mail failure must
never fail a captured payment.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: My Races and profile

**Files:**
- Create: `apps/site/components/StatusBadge.tsx`, `apps/site/app/races/page.tsx`, `apps/site/app/races/RacesList.tsx`, `apps/site/app/profile/page.tsx`, `apps/site/app/profile/ProfileForm.tsx`
- Test: `apps/site/components/__tests__/status-badge.test.tsx`

**Interfaces:**
- Consumes: `useMyRegistrations`, `cancelRegistration`, `RegistrationRow` (Task 7); `getProfile`, `upsertProfile`, `Profile` (Task 7); `SHIRT_SIZES`, `BLOOD_TYPES`, `GENDERS`, `formatPeso` from `@race-pace/shared`; `PillSelect` (Task 8).
- Produces: `StatusBadge({ status }: { status: string })`.

- [ ] **Step 1: Write the failing test**

Create `apps/site/components/__tests__/status-badge.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "../StatusBadge";

describe("StatusBadge", () => {
  it("labels each registration status in plain language", () => {
    const cases: [string, string][] = [
      ["paid", "Confirmed"],
      ["pending", "Awaiting payment"],
      ["refunded", "Refunded"],
      ["cancelled", "Cancelled"],
    ];
    for (const [status, label] of cases) {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it("falls back to the raw status for an unknown value", () => {
    render(<StatusBadge status="disputed" />);
    expect(screen.getByText("disputed")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter site test status-badge
```

Expected: FAIL — cannot resolve `../StatusBadge`.

- [ ] **Step 3: Write `components/StatusBadge.tsx`**

```tsx
import { cn } from "@/lib/utils";

const STATUSES: Record<string, { label: string; className: string }> = {
  paid: { label: "Confirmed", className: "bg-paid-tint text-paid" },
  pending: { label: "Awaiting payment", className: "bg-amber-tint text-amber" },
  refunded: { label: "Refunded", className: "bg-muted text-muted-foreground" },
  cancelled: { label: "Cancelled", className: "bg-destructive-tint text-destructive" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUSES[status];
  return (
    <span className={cn("rounded-pill px-2.5 py-1 text-[12px] font-semibold", s?.className ?? "bg-muted text-muted-foreground")}>
      {s?.label ?? status}
    </span>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter site test status-badge
```

Expected: PASS — 2 tests.

- [ ] **Step 5: Write the races list**

Create `apps/site/app/races/RacesList.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatPeso } from "@race-pace/shared";
import { useMyRegistrations, cancelRegistration } from "@/lib/registration";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { longDate } from "@/lib/format";

export function RacesList() {
  const { data, isLoading } = useMyRegistrations();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) return <p className="py-20 text-center text-muted-foreground">Loading…</p>;

  if (!data?.length) {
    return (
      <div className="py-20 text-center">
        <p className="text-[17px] text-muted-foreground">You haven&apos;t entered a race yet.</p>
        <Button asChild className="mt-6 h-auto rounded-pill px-8 py-4 text-[16px] font-semibold">
          <Link href="/events">Browse races</Link>
        </Button>
      </div>
    );
  }

  async function discard(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await cancelRegistration(id);
      await queryClient.invalidateQueries({ queryKey: ["my-registrations"] });
    } catch {
      // RLS blocks deleting anything that is not the owner's own pending row.
      setError("That registration can no longer be discarded. Refresh and try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="text-[14px] text-destructive">{error}</p> : null}
      {data.map((r) => (
        <article key={r.id} className="rounded-xl border border-border bg-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[19px] font-semibold tracking-[-0.3px] text-foreground">{r.eventName}</h2>
              <p className="mt-1 text-[14px] text-muted-foreground">
                {[r.categoryLabel, r.eventDate ? longDate(r.eventDate) : null].filter(Boolean).join(" · ")}
              </p>
            </div>
            <StatusBadge status={r.status} />
          </div>

          <p className="mt-4 text-[15px] font-semibold tabular-nums text-foreground">{formatPeso(r.total_amount)}</p>

          <div className="mt-5 flex flex-wrap gap-3">
            {r.status === "paid" ? (
              <Button asChild className="h-auto rounded-pill px-6 py-3 text-[15px] font-semibold">
                <Link href={`/ticket/${r.id}`}>View ticket</Link>
              </Button>
            ) : null}
            {r.status === "pending" ? (
              <>
                <Button asChild className="h-auto rounded-pill px-6 py-3 text-[15px] font-semibold">
                  <Link href={`/pay/${r.id}`}>Complete payment</Link>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busyId === r.id}
                  onClick={() => discard(r.id)}
                  className="h-auto rounded-pill px-6 py-3 text-[15px] font-semibold"
                >
                  {busyId === r.id ? "Discarding…" : "Discard"}
                </Button>
              </>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Write the races page**

Create `apps/site/app/races/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/SiteHeader";
import { RacesList } from "./RacesList";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Races" };

export default async function RacesPage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/sign-in?next=%2Fraces");

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <h1 className="text-[34px] font-semibold tracking-[-0.8px] text-foreground">My Races</h1>
        <div className="mt-8"><RacesList /></div>
      </main>
    </>
  );
}
```

- [ ] **Step 7: Write the profile form**

Create `apps/site/app/profile/ProfileForm.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { SHIRT_SIZES, BLOOD_TYPES, GENDERS } from "@race-pace/shared";
import { getProfile, upsertProfile, type Profile } from "@/lib/profile";
import { signOut } from "@/lib/auth";
import { PillSelect } from "@/components/PillSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ProfileForm({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<Partial<Profile>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProfile(userId).then((p) => { if (p) setProfile(p); }).finally(() => setLoading(false));
  }, [userId]);

  const set = (k: keyof Profile, v: string) => {
    setProfile((p) => ({ ...p, [k]: v }));
    setSaved(false);
  };

  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await upsertProfile({
      id: userId,
      full_name: profile.full_name || null,
      bib_name: profile.bib_name || null,
      date_of_birth: profile.date_of_birth || null,
      gender: profile.gender || null,
      shirt_size: profile.shirt_size || null,
      blood_type: profile.blood_type || null,
      emergency_contact: profile.emergency_contact || null,
    });
    setBusy(false);
    if (error) setError(error);
    else setSaved(true);
  }

  if (loading) return <p className="py-20 text-center text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col">
      <p className="text-[15px] text-muted-foreground">
        These details prefill every race you enter, so you only type them once.
      </p>

      <div className="mt-8 flex flex-col gap-2">
        <Label htmlFor="full_name">Full name</Label>
        <Input id="full_name" value={profile.full_name ?? ""} onChange={(e) => set("full_name", e.target.value)} />
      </div>
      <div className="mt-6 flex flex-col gap-2">
        <Label htmlFor="bib_name">Bib name</Label>
        <Input id="bib_name" value={profile.bib_name ?? ""} onChange={(e) => set("bib_name", e.target.value)} />
        <p className="text-[13px] text-muted-foreground">Printed on your race bib.</p>
      </div>
      <div className="mt-6 flex flex-col gap-2">
        <Label htmlFor="date_of_birth">Date of birth</Label>
        <Input id="date_of_birth" type="date" value={profile.date_of_birth ?? ""} onChange={(e) => set("date_of_birth", e.target.value)} />
      </div>
      <div className="mt-6 flex flex-col gap-2">
        <Label htmlFor="emergency_contact">Emergency contact</Label>
        <Input id="emergency_contact" value={profile.emergency_contact ?? ""} onChange={(e) => set("emergency_contact", e.target.value)} placeholder="Name and mobile number" />
      </div>

      <PillSelect label="GENDER" value={profile.gender ?? ""} options={GENDERS} onChange={(v) => set("gender", v)} />
      <PillSelect label="SHIRT SIZE" value={profile.shirt_size ?? ""} options={SHIRT_SIZES} onChange={(v) => set("shirt_size", v)} />
      <PillSelect label="BLOOD TYPE" value={profile.blood_type ?? ""} options={BLOOD_TYPES} onChange={(v) => set("blood_type", v)} />

      {error ? <p className="mt-6 text-[14px] text-destructive">{error}</p> : null}
      {saved ? <p className="mt-6 text-[14px] text-primary">Saved.</p> : null}

      <Button type="button" disabled={busy} onClick={save} className="mt-8 h-auto rounded-pill py-4 text-[16px] font-semibold">
        {busy ? "Saving…" : "Save"}
      </Button>

      <Button
        type="button"
        variant="outline"
        onClick={() => signOut().then(() => window.location.assign("/"))}
        className="mt-3 h-auto rounded-pill py-4 text-[15px] font-semibold"
      >
        Sign out
      </Button>
    </div>
  );
}
```

- [ ] **Step 8: Write the profile page**

Create `apps/site/app/profile/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/SiteHeader";
import { ProfileForm } from "./ProfileForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/sign-in?next=%2Fprofile");

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-md px-6 py-12">
        <h1 className="text-[34px] font-semibold tracking-[-0.8px] text-foreground">Profile</h1>
        <div className="mt-6"><ProfileForm userId={user.id} /></div>
      </main>
    </>
  );
}
```

- [ ] **Step 9: Full verification and commit**

```bash
pnpm --filter site typecheck && pnpm --filter site test && pnpm --filter site build
```

Expected: all pass.

```bash
git add apps/site
git commit -m "feat(site): my races and race passport profile

Pending registrations surface a Complete payment CTA and a discard action
gated by the registrations_delete_own_pending RLS policy — a zero-row
delete surfaces as an error rather than a silent success.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Deploy both Vercel projects and smoke test

**Files:**
- Create: `apps/web/vercel.json`
- Modify: none

**Interfaces:**
- Consumes: everything.
- Produces: two live Vercel deployments and a verified end-to-end money path.

- [ ] **Step 1: Add the admin console's SPA rewrite**

Create `apps/web/vercel.json`:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

Without this, `react-router-dom` routes 404 on a hard refresh — the static host has no file at `/events`.

- [ ] **Step 2: [USER] Create the public site's Vercel project**

Import the repository, then set:

- **Project name:** `race-pace`
- **Root directory:** `apps/site`
- **Framework preset:** Next.js
- **Environment variables:**
  - `NEXT_PUBLIC_SUPABASE_URL` = `https://whaqarofxdlzxrelbcrq.supabase.co`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = the new project's anon key
  - `NEXT_PUBLIC_SITE_URL` = `https://race-pace.vercel.app`

`NEXT_PUBLIC_SITE_URL` builds the PayMongo `return_url`. If it is wrong, the payment still confirms via webhook but the runner lands on a dead origin immediately after paying.

- [ ] **Step 3: [USER] Create the admin console's Vercel project**

- **Project name:** `race-pace-admin`
- **Root directory:** `apps/web`
- **Framework preset:** Vite
- **Environment variables:**
  - `VITE_SUPABASE_URL` = `https://whaqarofxdlzxrelbcrq.supabase.co`
  - `VITE_SUPABASE_ANON_KEY` = the new project's anon key

Vite embeds these at build time — changing either later needs a redeploy, not just an env edit.

- [ ] **Step 4: Update `SITE_ORIGINS` with the real origins**

```bash
pnpm exec supabase secrets set SITE_ORIGINS="https://race-pace.vercel.app,https://race-pace-admin.vercel.app,*.vercel.app,http://localhost:3000,http://localhost:5173,https://admin.racepace.lan"
```

Then redeploy every CORS-bearing function, since the secret is read at request time but the deployed bundle must already contain the helper:

```bash
pnpm exec supabase functions deploy registrations-checkout payment-session payment-verify org-members admin-refund check-in ticket-qr
```

- [ ] **Step 5: [USER] Add the redirect allowlist and set `PUBLIC_SITE_URL`**

In Supabase Dashboard → Authentication → URL Configuration:
- **Site URL:** `https://race-pace.vercel.app`
- **Redirect URLs:** `https://race-pace.vercel.app/**` and `https://*-race-pace.vercel.app/**` (preview deploys)

Then align the email's link base with production:

```bash
pnpm exec supabase secrets set PUBLIC_SITE_URL="https://race-pace.vercel.app"
```

- [ ] **Step 6: Verify CORS actually works from the deployed origin**

```bash
curl -s -i -X OPTIONS "https://whaqarofxdlzxrelbcrq.supabase.co/functions/v1/registrations-checkout" \
  -H "Origin: https://race-pace.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization, content-type" | head -20
```

Expected: `HTTP/2 204`, with `access-control-allow-origin: https://race-pace.vercel.app` and `vary: Origin`.

Then confirm a disallowed origin is refused:

```bash
curl -s -i -X OPTIONS "https://whaqarofxdlzxrelbcrq.supabase.co/functions/v1/registrations-checkout" \
  -H "Origin: https://evil.example" \
  -H "Access-Control-Request-Method: POST" | grep -i "access-control-allow-origin"
```

Expected: no output — the header is absent, so the browser blocks the call.

- [ ] **Step 7: Smoke test the admin console**

Open `https://race-pace-admin.vercel.app`, sign in as the admin user from Task 0 Step 11. Verify:
- Events lists the seeded events.
- A hard refresh on `/events` loads rather than 404ing (proves Step 1's rewrite).
- The Team page loads without a console CORS error (proves `org-members` CORS).

- [ ] **Step 8: Smoke test the full money path**

On `https://race-pace.vercel.app`:

1. Sign up with a fresh email, or sign in with Google.
2. Browse to an event, pick a distance, and register through all three wizard steps.
3. **Mid-wizard, refresh the page.** Expected: it resumes on the same step with answers intact — the idempotency-key guarantee from Task 7.
4. Pay with PayMongo test card `4343 4343 4343 4345` (any future expiry, any CVC).
5. Expected: redirect to `/pay/callback`, then automatically to `/ticket/<id>` with a rendered QR.
6. Check the inbox for the ticket email with a visible QR image.
7. Press Cmd+P on the ticket. Expected: one clean page, no nav or buttons.

- [ ] **Step 9: Verify the registration reached the admin console**

In `https://race-pace-admin.vercel.app` → Registrations, confirm the new row appears with status `paid` and the correct amount. **This is the acceptance criterion for spec §1.2** — a registration created on the web is visible to the organizer with no sync layer.

Cross-check the database directly:

```bash
pnpm exec supabase db query --linked "select r.id, r.status, r.total_amount, p.status as payment_status, p.provider from registrations r left join payments p on p.registration_id = r.id order by r.created_at desc limit 3;"
```

Expected: the newest row has `status = 'paid'`, `payment_status = 'paid'`, `provider = 'paymongo'`.

- [ ] **Step 10: Verify the Open Graph card**

```bash
curl -s "https://race-pace.vercel.app/events/00000000-0000-0000-0000-0000000000e1" | grep -o '<meta property="og:[^>]*>'
```

Expected: `og:title` with the event name, `og:description` with distances and date, and `og:image` if the event has a hero image. Then paste the URL into a Facebook post composer (without posting) and confirm the preview renders — this is the §1.3 acceptance criterion.

- [ ] **Step 11: Commit**

```bash
git add apps/web/vercel.json
git commit -m "chore(web): SPA rewrite for Vercel

react-router-dom routes 404 on hard refresh without it — the static host
has no file at /events.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Acceptance criteria

The work is done when all of these hold, each verified by the step named:

| # | Criterion | Verified by |
|---|---|---|
| 1 | A runner registers, pays, and gets a QR ticket entirely in a browser | Task 14 Step 8 |
| 2 | That registration is visible in the admin console with no sync layer | Task 14 Step 9 |
| 3 | Event links produce a real Open Graph preview card | Task 14 Step 10 |
| 4 | One Supabase identity works on web and mobile, via email or Google | Task 4 Step 10, Task 0 Step 11 |
| 5 | The ticket is emailed and printable | Task 12 Step 9, Task 10 Step 7 |
| 6 | A mid-wizard refresh resumes without creating a duplicate registration | Task 7 Step 6, Task 8 Step 13, Task 14 Step 8.3 |
| 7 | Payment is confirmed server-side, never from the redirect | Task 9 (`/pay/callback` → `payment-verify`) |
| 8 | A disallowed origin cannot call the Edge Functions | Task 14 Step 6 |
| 9 | The admin console works from its Vercel origin | Task 14 Step 7 |
| 10 | All three apps run on the new Supabase project | Task 0 Steps 5, 11 |
