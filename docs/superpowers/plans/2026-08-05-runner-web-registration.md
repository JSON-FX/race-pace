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
