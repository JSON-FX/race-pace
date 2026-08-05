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
import logo from "@/public/topnav-logo.png";

export function SiteHeader() {
  return (
    <header className="no-print sticky top-0 z-40 border-b border-divider bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" aria-label="Race Pace home">
          <Image src={logo} alt="Race Pace" height={28} priority />
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
