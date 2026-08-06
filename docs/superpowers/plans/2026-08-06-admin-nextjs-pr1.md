# Admin Next.js Conversion (PR1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `apps/web` from a Vite/React-Router SPA to a Next.js 15 App Router app with server-rendered, `searchParams`-driven pages, and redesign the six existing pages on one shared shadcn/ui table system (Direction A).

**Architecture:** Every list page is an async server component that parses `searchParams` with a pure module, issues one Supabase query with `.order()`/`.range()`/`count: 'exact'`, and renders. Auth is enforced twice — `middleware.ts` refreshes the session cookie and redirects anonymous requests; `app/(admin)/layout.tsx` verifies the role server-side. Mutations are Server Actions ending in `revalidatePath`. Client interactivity is confined to islands under `components/`.

**Tech Stack:** Next.js 15 (App Router), React 19.2.3, `@supabase/ssr` 0.5.x, Tailwind v4 via `@tailwindcss/postcss`, shadcn/ui (new-york), TanStack Table v8, Vitest + React Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-06-admin-nextjs-redesign-design.md`

**Out of scope for PR1:** Dashboard, Check-in (PR2); Organizations, Commission, Payouts (PR3). Those five routes ship in PR1 as a designed "Coming soon" empty state so the sidebar has no dead links.

## Global Constraints

- **Token contract is load-bearing.** `--x` in `app/globals.css` is a raw RGB channel triple (`--primary: 21 154 85`), NOT a color. `--color-x` wraps it as `rgb(var(--x))`. After every `pnpm dlx shadcn@latest add <component>`, grep the new file for `var(--` and rewrite any hit that is not already `var(--color-*)` — shadcn emits bare `var(--popover)` which silently produces invalid, dropped CSS here.
- **Accent color is trail-green `#159A55`** (`--primary: 21 154 85`). Never introduce a raw hex in a component.
- **`getUser()` never `getSession()`** for anything gating authorization. `getSession()` only decodes the cookie without verifying the JWT.
- **`cookies()` is async in Next 15.** `createClient()` in `lib/supabase/server.ts` must be awaited.
- **Path alias is `@/*` → `./*`** (project root, not `./src`). No file lives under `src/` after Task 1.
- **Env vars are `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.** No `import.meta.env` may remain.
- **Page size default is 25**, allowed values `10 | 25 | 50 | 100`, URL param `per`. Invalid values clamp to 25.
- **Any change to `sort`, `q`, `per`, or a filter resets `page` to 1.**
- **Row height is 44px, card radius `rounded-xl` (16px), control radius `rounded-lg` (11px)** per Direction A.
- **Figures use `font-mono tabular`** — money, bib numbers, timestamps, counts, pagination ranges.
- **Commit after every task.** Run `pnpm --filter web typecheck` before each commit.
- **Node 20, pnpm 9.7.0.** Workspace commands run from the repo root as `pnpm --filter web <script>`.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `apps/web/next.config.ts` | Image remote patterns for Supabase Storage |
| `apps/web/postcss.config.mjs` | Tailwind v4 PostCSS plugin |
| `apps/web/middleware.ts` | Session refresh + anonymous redirect |
| `apps/web/vitest.config.ts` | Vitest for client islands (replaces root-level inclusion) |
| `apps/web/playwright.config.ts` | E2E against `next dev` |
| `apps/web/app/layout.tsx` | Fonts, theme provider, Toaster |
| `apps/web/app/globals.css` | Moved from `src/index.css`, tokens unchanged |
| `apps/web/app/(auth)/login/page.tsx` | Sign-in |
| `apps/web/app/(auth)/no-access/page.tsx` | Role rejection |
| `apps/web/app/(admin)/layout.tsx` | Server role guard + AppShell |
| `apps/web/app/(admin)/{events,registrations,payments,team,settings}/page.tsx` | List/detail pages |
| `apps/web/app/(admin)/events/{new,[id]/edit}/page.tsx` | Event editor |
| `apps/web/app/(admin)/{dashboard,check-in,organizations,commission,payouts}/page.tsx` | Coming-soon stubs |
| `apps/web/lib/supabase/{client,server,middleware}.ts` | Three Supabase clients |
| `apps/web/lib/table-params.ts` | Pure parse/serialize — no React |
| `apps/web/lib/use-table-params.ts` | Client URL writer hook |
| `apps/web/lib/actions/{auth,events,registrations,payments,team,settings}.ts` | Server Actions |
| `apps/web/lib/queries/{events,registrations,payments,team,org,roles}.ts` | Server-side data readers |
| `apps/web/components/data-table/*` | The shared table system |

**Deleted:** `apps/web/index.html`, `vite.config.ts`, `vercel.json`, `src/main.tsx`, `src/App.tsx`, `src/lib/auth.tsx`, `src/lib/useTableParams.ts`, `src/lib/supabase.ts`, `src/routes/Placeholder.tsx`.

**Moved (git mv, imports unchanged thanks to `@/`):** `src/components/*` → `components/*`, `src/lib/*` → `lib/*`, `src/assets/*` → `public/*`.

---

## Task 1: Next.js scaffold, build config, and fonts

Converts the build system. At the end of this task the app builds and serves a single placeholder route — no admin pages yet. This is deliberately one task because a half-converted build system is not independently reviewable.

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/next.config.ts`, `apps/web/postcss.config.mjs`, `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `apps/web/app/page.tsx`, `apps/web/.env.local.example`
- Modify: `apps/web/tsconfig.json`, `apps/web/components.json`
- Delete: `apps/web/index.html`, `apps/web/vite.config.ts`, `apps/web/vercel.json`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`
- Move: `apps/web/src/index.css` → `apps/web/app/globals.css`; `apps/web/src/components` → `apps/web/components`; `apps/web/src/lib` → `apps/web/lib`; `apps/web/src/assets` → `apps/web/public`; `apps/web/src/__tests__` → `apps/web/__tests__`

**Interfaces:**
- Produces: `@/*` alias resolving to `apps/web/*`; CSS custom properties `--font-sans`, `--font-mono`; Tailwind utilities `font-sans`, `font-mono`, `.tabular`.

- [ ] **Step 1: Swap dependencies**

From the repo root:

```bash
pnpm --filter web remove vite @vitejs/plugin-react @tailwindcss/vite react-router-dom
pnpm --filter web add next@^15.1.0 @supabase/ssr@^0.5.2 next-themes@^0.4.4
pnpm --filter web add -D @tailwindcss/postcss@^4 @types/node@^22 vite-tsconfig-paths@^5.1.4
```

Then edit `apps/web/package.json` scripts to exactly:

```json
"scripts": {
  "dev": "next dev -p 3001",
  "build": "next build",
  "start": "next start -p 3001",
  "test": "vitest run",
  "typecheck": "tsc --noEmit"
}
```

Keep `@tanstack/react-query` and `@tanstack/react-table` — react-query is still used by the PSGC and map-snapping islands, react-table by `DataTable`.

- [ ] **Step 2: Move files with git mv (preserves history)**

```bash
cd apps/web
git mv src/index.css app/globals.css 2>/dev/null || (mkdir -p app && git mv src/index.css app/globals.css)
git mv src/components components
git mv src/lib lib
git mv src/__tests__ __tests__
mkdir -p public && git mv src/assets/topnav-logo.png public/topnav-logo.png
git rm -f index.html vite.config.ts vercel.json src/main.tsx src/App.tsx
```

`vercel.json` must be **deleted**, not edited — its SPA rewrite `{"source": "/(.*)", "destination": "/index.html"}` shadows every Next route. Vercel autodetects Next without it.

- [ ] **Step 3: Write the build config files**

`apps/web/next.config.ts`:

```ts
import type { NextConfig } from "next";

// Read at BUILD time. If NEXT_PUBLIC_SUPABASE_URL is unset in the Vercel
// project before the first build, no Supabase pattern is emitted and every
// org logo / event hero 400s in production while local dev works fine.
// Adding the var later requires a REDEPLOY, not just an env edit.
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
  : "";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: "https" as const, hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }]
      : [],
  },
};

export default nextConfig;
```

`apps/web/postcss.config.mjs`:

```js
// Tailwind v4 under Next uses the PostCSS plugin, not the Vite plugin
// this app used before the App Router conversion.
export default { plugins: { "@tailwindcss/postcss": {} } };
```

`apps/web/tsconfig.json` — replace the whole file:

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

In `apps/web/components.json`, change exactly two values: `"rsc": false` → `"rsc": true`, and `"css": "src/index.css"` → `"css": "app/globals.css"`.

`apps/web/.env.local.example`:

```
NEXT_PUBLIC_SUPABASE_URL=https://whaqarofxdlzxrelbcrq.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=replace-me
```

- [ ] **Step 4: Add fonts and the tabular utility to globals.css**

At the very top of `apps/web/app/globals.css`, the `@import "tailwindcss";` line stays first. Inside the existing `@theme inline { … }` block, append these two lines before the closing brace:

```css
  --font-sans: var(--font-inter), -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --font-mono: var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, monospace;
```

In the existing `@layer base { … }` block, replace the `body { font-family: …; }` declaration with:

```css
  body {
    font-family: var(--font-sans);
    color: rgb(var(--foreground));
    background: rgb(var(--muted));
  }
  /* Money, bib numbers, dates and counts. Proportional figures change width
     between digits, so a column visibly reflows when you page through it. */
  .tabular { font-variant-numeric: tabular-nums; }
```

Also delete `html, body, #root { height: 100%; margin: 0; }` and replace with `html, body { height: 100%; margin: 0; }` — there is no `#root` under Next.

- [ ] **Step 5: Write the root layout**

`apps/web/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Race Pace Admin",
  description: "Event organizer console",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning is required by next-themes: it writes the
    // `class` attribute on <html> before React hydrates, which would
    // otherwise log a mismatch on every load.
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${mono.variable}`}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

`apps/web/app/page.tsx` — temporary, replaced in Task 4:

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/events");
}
```

- [ ] **Step 6: Verify the build**

```bash
pnpm --filter web typecheck
```

Expected: PASS. Typecheck will fail on files under `components/` and `lib/` that still import `react-router-dom` or `import.meta.env` — those are fixed in Tasks 3–11. To keep this task independently green, temporarily add `"exclude": ["node_modules", "components", "lib", "__tests__"]` to `tsconfig.json` and **note in the commit message that Task 4 removes it**. Do not leave it in past Task 11.

```bash
pnpm --filter web build
```

Expected: builds successfully, emits `/` as a static redirect.

- [ ] **Step 7: Commit**

```bash
git add -A apps/web
git commit -m "build(web): convert to Next.js 15 App Router scaffold

Swaps Vite for Next, moves src/* to the project root under the @/ alias,
and self-hosts Inter + JetBrains Mono via next/font. vercel.json is deleted
rather than edited: its SPA rewrite shadows every Next route.

tsconfig temporarily excludes components/ and lib/ while their react-router
and import.meta.env references are migrated; Task 4 removes the exclusion."
```

---

## Task 2: Pure table-params module

Smallest, highest-leverage unit. Pure functions, no React, no Supabase — fully unit-testable and every later task depends on it.

**Files:**
- Create: `apps/web/lib/table-params.ts`
- Create: `apps/web/lib/table-params.test.ts`
- Delete: `apps/web/lib/useTableParams.ts`

**Interfaces:**
- Produces:
  - `type SortState = { id: string; desc: boolean }`
  - `type TableParams = { page: number; per: number; sort: SortState[]; filters: Record<string, string>; q: string }`
  - `type TableDefaults = { sort?: SortState[]; filters?: Record<string, string> }`
  - `const PER_PAGE_OPTIONS: readonly [10, 25, 50, 100]`
  - `const DEFAULT_PER = 25`
  - `parseTableParams(sp: Record<string, string | string[] | undefined>, defaults?: TableDefaults): TableParams`
  - `serializeTableParams(p: Partial<TableParams>, defaults?: TableDefaults): URLSearchParams`
  - `rangeLabel(page: number, per: number, total: number): string`

- [ ] **Step 1: Write the failing tests**

`apps/web/lib/table-params.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseTableParams, serializeTableParams, rangeLabel, DEFAULT_PER } from "./table-params";

describe("parseTableParams", () => {
  it("returns defaults for an empty query string", () => {
    const p = parseTableParams({});
    expect(p).toEqual({ page: 1, per: DEFAULT_PER, sort: [], filters: {}, q: "" });
  });

  it("parses page, per and q", () => {
    const p = parseTableParams({ page: "3", per: "50", q: "santos" });
    expect(p.page).toBe(3);
    expect(p.per).toBe(50);
    expect(p.q).toBe("santos");
  });

  it("clamps an unlisted per value to the default", () => {
    expect(parseTableParams({ per: "37" }).per).toBe(DEFAULT_PER);
    expect(parseTableParams({ per: "0" }).per).toBe(DEFAULT_PER);
    expect(parseTableParams({ per: "abc" }).per).toBe(DEFAULT_PER);
  });

  it("clamps page below 1 to 1", () => {
    expect(parseTableParams({ page: "0" }).page).toBe(1);
    expect(parseTableParams({ page: "-4" }).page).toBe(1);
    expect(parseTableParams({ page: "nope" }).page).toBe(1);
  });

  it("parses a multi-column sort", () => {
    expect(parseTableParams({ sort: "created_at:desc,full_name:asc" }).sort).toEqual([
      { id: "created_at", desc: true },
      { id: "full_name", desc: false },
    ]);
  });

  it("falls back to the default sort when sort is absent", () => {
    const d = { sort: [{ id: "event_date", desc: false }] };
    expect(parseTableParams({}, d).sort).toEqual(d.sort);
  });

  it("treats unreserved keys as filters, over defaults", () => {
    const p = parseTableParams({ status: "paid", event: "e1" }, { filters: { status: "all", category: "all" } });
    expect(p.filters).toEqual({ status: "paid", category: "all", event: "e1" });
  });

  it("ignores array-valued params by taking the first entry", () => {
    expect(parseTableParams({ status: ["paid", "pending"] }).filters.status).toBe("paid");
  });
});

describe("serializeTableParams", () => {
  it("omits defaults so the clean URL stays clean", () => {
    expect(serializeTableParams({ page: 1, per: DEFAULT_PER, q: "", sort: [], filters: {} }).toString()).toBe("");
  });

  it("emits only non-default values", () => {
    const s = serializeTableParams({ page: 3, per: 50, q: "cruz", filters: { status: "paid", category: "all" } });
    expect(s.get("page")).toBe("3");
    expect(s.get("per")).toBe("50");
    expect(s.get("q")).toBe("cruz");
    expect(s.get("status")).toBe("paid");
    expect(s.get("category")).toBeNull();
  });

  it("round-trips through parse", () => {
    const original = { page: 2, per: 100, q: "dela cruz", sort: [{ id: "amount", desc: true }], filters: { status: "refunded" } };
    const parsed = parseTableParams(Object.fromEntries(serializeTableParams(original)));
    expect(parsed).toEqual(original);
  });
});

describe("rangeLabel", () => {
  it("describes the visible slice", () => {
    expect(rangeLabel(3, 25, 791)).toBe("51–75 of 791");
  });
  it("caps the upper bound at the total on the last page", () => {
    expect(rangeLabel(32, 25, 791)).toBe("776–791 of 791");
  });
  it("reads as zero when there are no rows", () => {
    expect(rangeLabel(1, 25, 0)).toBe("0 of 0");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web test lib/table-params.test.ts`
Expected: FAIL — "Failed to resolve import ./table-params".

(If `vitest.config.ts` does not exist yet in `apps/web`, create it now with the content from Task 12 Step 1 — the config is a prerequisite for running any test in this package.)

- [ ] **Step 3: Implement**

`apps/web/lib/table-params.ts`:

```ts
export type SortState = { id: string; desc: boolean };

export type TableParams = {
  page: number;
  per: number;
  sort: SortState[];
  filters: Record<string, string>;
  q: string;
};

export type TableDefaults = { sort?: SortState[]; filters?: Record<string, string> };

export const PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;
export const DEFAULT_PER = 25;

/** `page`, `per`, `sort` and `q` are structural; every other key is a filter. */
const RESERVED = new Set(["page", "per", "sort", "q"]);

/** Next gives repeated params as arrays. Admin URLs never mean "both", so
 *  take the first and ignore the rest rather than 400-ing on a stray dup. */
function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function parseSort(raw: string | undefined, fallback: SortState[]): SortState[] {
  if (!raw) return fallback;
  const parsed = raw
    .split(",")
    .filter(Boolean)
    .map((part) => {
      const [id, dir] = part.split(":");
      return { id: id ?? "", desc: dir === "desc" };
    })
    .filter((s) => s.id !== "");
  return parsed.length ? parsed : fallback;
}

const formatSort = (s: SortState[]) => s.map((x) => `${x.id}:${x.desc ? "desc" : "asc"}`).join(",");

export function parseTableParams(
  sp: Record<string, string | string[] | undefined>,
  defaults: TableDefaults = {},
): TableParams {
  const rawPage = Number(one(sp.page) ?? 1);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

  const rawPer = Number(one(sp.per) ?? DEFAULT_PER);
  const per = (PER_PAGE_OPTIONS as readonly number[]).includes(rawPer) ? rawPer : DEFAULT_PER;

  const filters: Record<string, string> = { ...(defaults.filters ?? {}) };
  for (const [key, value] of Object.entries(sp)) {
    if (RESERVED.has(key)) continue;
    const v = one(value);
    if (v !== undefined) filters[key] = v;
  }

  return {
    page,
    per,
    sort: parseSort(one(sp.sort), defaults.sort ?? []),
    filters,
    q: one(sp.q) ?? "",
  };
}

/** Inverse of parseTableParams. Values equal to their default are omitted so
 *  the canonical URL for an unfiltered first page is the bare pathname. */
export function serializeTableParams(p: Partial<TableParams>, defaults: TableDefaults = {}): URLSearchParams {
  const out = new URLSearchParams();
  if (p.page && p.page > 1) out.set("page", String(p.page));
  if (p.per && p.per !== DEFAULT_PER) out.set("per", String(p.per));
  if (p.q) out.set("q", p.q);
  if (p.sort?.length) out.set("sort", formatSort(p.sort));
  for (const [key, value] of Object.entries(p.filters ?? {})) {
    const dflt = defaults.filters?.[key] ?? "all";
    if (value && value !== dflt) out.set(key, value);
  }
  return out;
}

/** "51–75 of 791". En dash, not a hyphen — it is a numeric range. */
export function rangeLabel(page: number, per: number, total: number): string {
  if (total === 0) return "0 of 0";
  const first = (page - 1) * per + 1;
  const last = Math.min(page * per, total);
  return `${first}–${last} of ${total}`;
}
```

Then delete the old hook:

```bash
git rm apps/web/lib/useTableParams.ts
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test lib/table-params.test.ts`
Expected: PASS, 13 tests.

Note: the round-trip test passes `filters: { status: "refunded" }` with no defaults, so `serializeTableParams` compares against the implicit `"all"` default and emits it. If it fails, the bug is in the `dflt` fallback, not the test.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/table-params.ts apps/web/lib/table-params.test.ts
git add -u apps/web/lib/useTableParams.ts
git commit -m "feat(web): pure table-params parse/serialize with page-size support

Adds the `per` param (10/25/50/100, clamping to 25) the old hook lacked, and
moves parsing out of React so server components can read searchParams
directly. Wire format is otherwise byte-compatible with the old URLs."
```

---

## Task 3: Supabase SSR clients, middleware, and auth

**Files:**
- Create: `apps/web/lib/supabase/{client,server,middleware}.ts`, `apps/web/lib/routes.ts`, `apps/web/middleware.ts`
- Create: `apps/web/lib/actions/auth.ts`
- Create: `apps/web/app/(auth)/login/page.tsx`, `apps/web/app/(auth)/login/login-form.tsx`, `apps/web/app/(auth)/no-access/page.tsx`
- Create: `apps/web/lib/routes.test.ts`
- Delete: `apps/web/lib/supabase.ts`, `apps/web/lib/auth.tsx`, `apps/web/routes/Login.tsx`, `apps/web/routes/NoAccess.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `lib/supabase/client.ts` → `createClient(): SupabaseClient` (browser)
  - `lib/supabase/server.ts` → `async createClient(): Promise<SupabaseClient>` (**must be awaited**)
  - `lib/routes.ts` → `isProtectedPath(pathname: string): boolean`, `signInRedirectPath(pathname: string, search: string): string`
  - `lib/actions/auth.ts` → `signInAction(prev: AuthState, formData: FormData): Promise<AuthState>`, `signOutAction(): Promise<void>`, where `type AuthState = { error?: string }`

- [ ] **Step 1: Write the failing test for route classification**

`apps/web/lib/routes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isProtectedPath, signInRedirectPath } from "./routes";

describe("isProtectedPath", () => {
  it("protects admin pages", () => {
    expect(isProtectedPath("/events")).toBe(true);
    expect(isProtectedPath("/registrations")).toBe(true);
    expect(isProtectedPath("/events/abc/edit")).toBe(true);
    expect(isProtectedPath("/")).toBe(true);
  });

  it("leaves the auth pages open", () => {
    expect(isProtectedPath("/login")).toBe(false);
    expect(isProtectedPath("/no-access")).toBe(false);
  });
});

describe("signInRedirectPath", () => {
  it("preserves the target path and its query string", () => {
    expect(signInRedirectPath("/registrations", "?status=paid")).toBe(
      "/login?next=%2Fregistrations%3Fstatus%3Dpaid",
    );
  });

  it("omits next for a bare root request", () => {
    expect(signInRedirectPath("/", "")).toBe("/login");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web test lib/routes.test.ts`
Expected: FAIL — cannot resolve `./routes`.

- [ ] **Step 3: Implement routes.ts**

`apps/web/lib/routes.ts`:

```ts
/** Pages reachable without a session. Everything else is admin-only. */
const PUBLIC_PATHS = ["/login", "/no-access"];

export function isProtectedPath(pathname: string): boolean {
  return !PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Where to send an anonymous request, remembering where it was headed. */
export function signInRedirectPath(pathname: string, search: string): string {
  if (pathname === "/" && !search) return "/login";
  return `/login?next=${encodeURIComponent(`${pathname}${search}`)}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web test lib/routes.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the three Supabase clients**

`apps/web/lib/supabase/client.ts`:

```ts
import { createBrowserClient } from "@supabase/ssr";

/** Browser-side client. Reads the session from cookies written by middleware,
 *  so it stays in sync with what server components see. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

`apps/web/lib/supabase/server.ts`:

```ts
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Server client for Server Components, Server Actions and Route Handlers.
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
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
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

`apps/web/lib/supabase/middleware.ts`:

```ts
import { createServerClient, type CookieOptions } from "@supabase/ssr";
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
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() revalidates the token against the auth server. getSession()
  // only decodes the cookie and must never gate authorization.
  const { data: { user } } = await supabase.auth.getUser();

  if (!user && isProtectedPath(request.nextUrl.pathname)) {
    const target = signInRedirectPath(request.nextUrl.pathname, request.nextUrl.search);
    return NextResponse.redirect(new URL(target, request.url));
  }

  // Return `supabaseResponse` as-is. Constructing a fresh NextResponse here
  // without copying its cookies silently desyncs the session and logs the
  // admin out at random.
  return supabaseResponse;
}
```

`apps/web/middleware.ts`:

```ts
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static assets and images — those never need a session
    // refresh and running middleware on them wastes an auth call per request.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

- [ ] **Step 6: Write the auth Server Actions**

`apps/web/lib/actions/auth.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string };

export async function signInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/events");

  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Supabase returns the same message for wrong password and unknown user,
    // which is what we want — do not disambiguate for an unauthenticated caller.
    return { error: "That email and password don't match an account." };
  }

  revalidatePath("/", "layout");
  // redirect() throws internally; it must be outside any try/catch.
  redirect(next.startsWith("/") ? next : "/events");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
```

`redirect()` works by throwing a special error. Never wrap these calls in `try/catch` — doing so swallows the navigation and the action appears to hang.

- [ ] **Step 7: Write the login and no-access pages**

`apps/web/app/(auth)/login/login-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAction, type AuthState } from "@/lib/actions/auth";

export function LoginForm() {
  const next = useSearchParams().get("next") ?? "/events";
  const [state, formAction, pending] = useActionState<AuthState, FormData>(signInAction, {});

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">{state.error}</p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
```

`apps/web/app/(auth)/login/page.tsx`:

```tsx
import { Suspense } from "react";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-muted p-6">
      <Card className="w-full max-w-sm rounded-xl">
        <CardHeader className="items-center text-center">
          <Image src="/topnav-logo.png" alt="" width={40} height={40} priority />
          <CardTitle className="text-xl">Race Pace Admin</CardTitle>
        </CardHeader>
        <CardContent>
          {/* useSearchParams needs a Suspense boundary or the whole route
              opts out of static rendering with a build-time warning. */}
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}
```

`apps/web/app/(auth)/no-access/page.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { signOutAction } from "@/lib/actions/auth";

export default function NoAccessPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-muted p-6">
      <Card className="w-full max-w-sm rounded-xl text-center">
        <CardHeader>
          <CardTitle className="text-xl">No admin access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This account isn&apos;t an organizer on any event. Ask your organization
            admin to invite you, then sign in again.
          </p>
          <form action={signOutAction}>
            <Button type="submit" variant="outline" className="w-full">Sign out</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
```

Then delete the superseded files:

```bash
git rm apps/web/lib/supabase.ts apps/web/lib/auth.tsx apps/web/routes/Login.tsx apps/web/routes/NoAccess.tsx apps/web/__tests__/auth.test.tsx
```

`__tests__/auth.test.tsx` tested the `AuthProvider` context that no longer exists; its coverage is replaced by the Playwright specs in Task 12.

- [ ] **Step 8: Verify manually**

```bash
pnpm --filter web dev
```

Visit `http://localhost:3001/events` while signed out. Expected: redirect to `/login?next=%2Fevents`. Sign in with `admin@racepace.test` / `password123`. Expected: redirect back to `/events` (404 until Task 6 — that is correct at this point).

- [ ] **Step 9: Commit**

```bash
git add -A apps/web
git commit -m "feat(web): SSR auth with @supabase/ssr, middleware and Server Actions

Replaces the client AuthProvider and its double loading flash. Middleware
refreshes the session cookie and redirects anonymous requests, preserving
the intended destination in ?next."
```

---

## Task 4: Admin layout, server role guard, and app shell

**Files:**
- Create: `apps/web/lib/queries/roles.ts`
- Create: `apps/web/app/(admin)/layout.tsx`, `apps/web/app/(admin)/page.tsx`
- Create: `apps/web/app/(admin)/{dashboard,check-in,organizations,commission,payouts}/page.tsx`
- Create: `apps/web/components/coming-soon.tsx`
- Modify: `apps/web/components/{AppShell,Sidebar,TopBar,ThemeToggle}.tsx`
- Modify: `apps/web/tsconfig.json` (remove the temporary exclude from Task 1)
- Delete: `apps/web/app/page.tsx`, `apps/web/routes/Placeholder.tsx`, `apps/web/lib/roles.ts`, `apps/web/lib/theme.ts`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server`; `signOutAction` from `@/lib/actions/auth`.
- Produces:
  - `lib/queries/roles.ts` → `type MyRoles = { role: string | null; orgId: string | null; isSuperAdmin: boolean; isAdmin: boolean; isOrgAdmin: boolean }` and `async getMyRoles(): Promise<MyRoles | null>` (null when unauthenticated)
  - `components/Sidebar.tsx` → `<Sidebar roles={MyRoles} email={string} />` (client component, takes props — no longer self-queries)
  - `components/AppShell.tsx` → `<AppShell roles={MyRoles} email={string}>{children}</AppShell>`

- [ ] **Step 1: Write the server-side role reader**

`apps/web/lib/queries/roles.ts`:

```ts
import { createClient } from "@/lib/supabase/server";

export type MyRoles = {
  role: string | null;
  orgId: string | null;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isOrgAdmin: boolean;
};

/** Resolve the caller's roles server-side. Returns null when unauthenticated.
 *  Mirrors the old useMyRoles() shape exactly so Sidebar needs no changes
 *  beyond taking it as a prop. RLS on user_roles scopes the rows to the caller. */
export async function getMyRoles(): Promise<MyRoles | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase.from("user_roles").select("role, org_id");
  if (error) throw error;

  const rows = data ?? [];
  const isSuperAdmin = rows.some((r) => r.role === "super_admin");
  const adminRow = rows.find((r) => r.role === "admin" || r.role === "editor");

  return {
    role: isSuperAdmin ? "super_admin" : adminRow?.role ?? rows[0]?.role ?? null,
    orgId: adminRow?.org_id ?? null,
    isSuperAdmin,
    isAdmin: isSuperAdmin || !!adminRow,
    isOrgAdmin: isSuperAdmin || rows.some((r) => r.role === "admin"),
  };
}
```

- [ ] **Step 2: Write the guarded layout**

`apps/web/app/(admin)/layout.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles } from "@/lib/queries/roles";
import { AppShell } from "@/components/AppShell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Middleware already redirected anonymous requests; this is the second,
  // authoritative check. Middleware runs on the edge and is not an
  // authorization boundary on its own.
  if (!user) redirect("/login");

  const roles = await getMyRoles();
  if (!roles?.isAdmin) redirect("/no-access");

  return (
    <AppShell roles={roles} email={user.email ?? ""}>
      {children}
    </AppShell>
  );
}
```

`apps/web/app/(admin)/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function AdminIndex() {
  redirect("/events");
}
```

Delete the temporary `apps/web/app/page.tsx` from Task 1 — `(admin)/page.tsx` now owns `/`.

- [ ] **Step 3: Port AppShell, Sidebar and TopBar to props**

`apps/web/components/AppShell.tsx` — replace entirely:

```tsx
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import type { MyRoles } from "@/lib/queries/roles";

export function AppShell({
  roles, email, children,
}: { roles: MyRoles; email: string; children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <Sidebar roles={roles} email={email} />
      <SidebarInset className="bg-muted">
        <TopBar />
        <main className="rp-scroll flex-1 overflow-y-auto bg-muted">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

In `apps/web/components/Sidebar.tsx`, make these four changes and leave everything else alone:

1. Add `"use client";` as the first line.
2. Replace `import { NavLink } from "react-router-dom";` with `import Link from "next/link";` and `import { usePathname } from "next/navigation";`.
3. Replace the `NavItem` component with:

```tsx
function NavItem({ to, label, icon: Icon }: Item) {
  const pathname = usePathname();
  const isActive = pathname === to || pathname.startsWith(`${to}/`);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
        <Link href={to}>
          <Icon className={isActive ? "text-sidebar-primary" : "text-muted-foreground"} />
          <span className={isActive ? "font-semibold text-sidebar-accent-foreground" : "font-medium text-muted-foreground"}>
            {label}
          </span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
```

4. Change the signature to `export function Sidebar({ roles, email }: { roles: MyRoles; email: string })`, delete the `useMyRoles()` and `useAuth()` calls, derive `local`/`initials`/`role` from the props, and replace the sign-out button's `onClick={signOut}` with a wrapping `<form action={signOutAction}>` and `<button type="submit">`.

Also replace `import mark from "../assets/topnav-logo.png"` with `next/image` against `/topnav-logo.png`:

```tsx
import Image from "next/image";
// …
<Image src="/topnav-logo.png" alt="" width={28} height={28} />
```

In `apps/web/components/TopBar.tsx` and `ThemeToggle.tsx`, add `"use client";` as the first line and replace any `lib/theme.ts` usage with `useTheme()` from `next-themes`. Then `git rm apps/web/lib/theme.ts`.

- [ ] **Step 4: Add the coming-soon stubs**

`apps/web/components/coming-soon.tsx`:

```tsx
import type { LucideIcon } from "lucide-react";

export function ComingSoon({ title, description, icon: Icon }: {
  title: string; description: string; icon: LucideIcon;
}) {
  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="grid min-h-[420px] place-items-center rounded-xl border border-dashed border-border bg-card">
        <div className="max-w-sm px-6 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-xl bg-accent">
            <Icon className="size-6 text-accent-foreground" />
          </div>
          <h2 className="mt-4 text-lg font-semibold">{title}</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}
```

Create the five stub pages. `apps/web/app/(admin)/dashboard/page.tsx`:

```tsx
import { LayoutDashboard } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";

export default function DashboardPage() {
  return (
    <ComingSoon
      icon={LayoutDashboard}
      title="Dashboard"
      description="Revenue, registration trends and upcoming events land here next."
    />
  );
}
```

Repeat with: `check-in` → `QrCode` / "Check-in" / "Scan bibs and mark runners in on race day."; `organizations` → `Building2` / "Organizations" / "Every organizer on the platform, with their events and volumes."; `commission` → `Percent` / "Commission" / "Platform fee rollups per organizer and per event."; `payouts` → `Banknote` / "Payouts" / "Settlement runs and transfer history for organizers."

- [ ] **Step 5: Restore full typechecking**

In `apps/web/tsconfig.json`, change `"exclude"` back to exactly `["node_modules"]`. This re-includes `components/` and `lib/`.

Run: `pnpm --filter web typecheck`
Expected: FAIL, listing every remaining `react-router-dom` and `import.meta.env` reference in `components/` and `routes/`. Record the list — Tasks 5–11 clear it. If a file in `components/` fails only because it imports `react-router-dom` for navigation, fix it now with `next/link` / `useRouter`; if it fails because it depends on a page not yet built, leave it.

- [ ] **Step 6: Verify manually**

```bash
pnpm --filter web dev
```

Sign in as `admin@racepace.test` / `password123`. Expected: `/` redirects to `/events` (404 until Task 6); `/dashboard` renders the coming-soon card inside the shell with the sidebar highlighted; no loading flash on navigation; the Platform group is visible only for a super admin.

- [ ] **Step 7: Commit**

```bash
git add -A apps/web
git commit -m "feat(web): server role guard and app shell

Roles resolve once in the (admin) layout and pass down as props, removing
the per-navigation client role query and the second loading flash. The five
unbuilt routes render a designed coming-soon state so no sidebar link 404s."
```

---

## Task 5: The DataTable system

The core deliverable. Every list page consumes it unchanged.

**Files:**
- Create: `apps/web/components/data-table/data-table.tsx`, `toolbar.tsx`, `faceted-filter.tsx`, `active-filters.tsx`, `bulk-bar.tsx`, `pagination.tsx`, `column-header.tsx`, `empty-state.tsx`, `index.ts`
- Create: `apps/web/lib/use-table-params.ts`
- Create: `apps/web/components/data-table/data-table.test.tsx`, `pagination.test.tsx`
- Delete: `apps/web/components/DataTable.tsx`, `apps/web/__tests__/data-table.test.tsx`, `apps/web/__tests__/table-params.test.tsx`

**Interfaces:**
- Consumes: `SortState`, `PER_PAGE_OPTIONS`, `DEFAULT_PER`, `rangeLabel`, `serializeTableParams` from `@/lib/table-params`.
- Produces:
  - `lib/use-table-params.ts` → `useTableParams(defaults?: TableDefaults)` returning `{ page, per, sort, filters, q, setPage(n), setPer(n), setSort(s), setFilter(key, value), setQ(v), clearFilters() }`. Writes only; parsing lives in `table-params.ts`.
  - `components/data-table/index.ts` re-exports:
    - `<DataTable<T> columns data total page per sort filterDefs activeFilters searchPlaceholder bulkActions emptyState isError onRowHref />`
    - `type FilterDef = { key: string; label: string; options: { value: string; label: string; count?: number }[] }`
    - `type BulkAction = { label: string; icon?: LucideIcon; variant?: "default" | "destructive"; onSelect: (ids: string[]) => void }`
    - `<DataTableSkeleton rows={number} columns={number} />`

- [ ] **Step 1: Write the failing tests**

`apps/web/components/data-table/pagination.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTablePagination } from "./pagination";

function setup(over: Partial<React.ComponentProps<typeof DataTablePagination>> = {}) {
  const onPageChange = vi.fn();
  const onPerChange = vi.fn();
  render(
    <DataTablePagination
      page={3} per={25} total={791}
      onPageChange={onPageChange} onPerChange={onPerChange}
      {...over}
    />,
  );
  return { onPageChange, onPerChange };
}

describe("DataTablePagination", () => {
  it("shows the visible range and total", () => {
    setup();
    expect(screen.getByText("51–75 of 791")).toBeInTheDocument();
  });

  it("offers every page-size option", async () => {
    setup();
    await userEvent.click(screen.getByLabelText("Rows per page"));
    for (const n of [10, 25, 50, 100]) {
      expect(screen.getByRole("option", { name: String(n) })).toBeInTheDocument();
    }
  });

  it("disables Previous on the first page", () => {
    setup({ page: 1 });
    expect(screen.getByLabelText("Previous page")).toBeDisabled();
  });

  it("disables Next on the last page", () => {
    setup({ page: 32 });
    expect(screen.getByLabelText("Next page")).toBeDisabled();
  });

  it("reports the requested page", async () => {
    const { onPageChange } = setup();
    await userEvent.click(screen.getByLabelText("Next page"));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it("renders nothing when there are no rows", () => {
    const { container } = render(
      <DataTablePagination page={1} per={25} total={0} onPageChange={vi.fn()} onPerChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

`apps/web/components/data-table/data-table.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "./data-table";

type Row = { id: string; name: string; amount: number };

const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "amount", header: "Amount" },
];

const rows: Row[] = [
  { id: "1", name: "Maria Santos", amount: 2850 },
  { id: "2", name: "Ramon Cruz", amount: 1950 },
];

const base = {
  columns, data: rows, total: 2, page: 1, per: 25,
  sort: [], filterDefs: [], activeFilters: {},
  onParamsChange: vi.fn(),
} as const;

describe("DataTable", () => {
  it("renders every row", () => {
    render(<DataTable {...base} />);
    expect(screen.getByText("Maria Santos")).toBeInTheDocument();
    expect(screen.getByText("Ramon Cruz")).toBeInTheDocument();
  });

  it("announces the result count to screen readers", () => {
    render(<DataTable {...base} />);
    expect(screen.getByRole("status")).toHaveTextContent("2 results");
  });

  it("marks a sorted column with aria-sort", () => {
    render(<DataTable {...base} sort={[{ id: "amount", desc: true }]} />);
    expect(screen.getByRole("columnheader", { name: /amount/i })).toHaveAttribute("aria-sort", "descending");
  });

  it("shows the empty state instead of a bare table", () => {
    render(<DataTable {...base} data={[]} total={0} emptyState={{ title: "No registrations", description: "Nobody has signed up yet." }} />);
    expect(screen.getByText("No registrations")).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Maria/ })).not.toBeInTheDocument();
  });

  it("shows a retryable error state", () => {
    render(<DataTable {...base} isError />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders one removable chip per active filter", async () => {
    const onParamsChange = vi.fn();
    render(
      <DataTable {...base} onParamsChange={onParamsChange}
        filterDefs={[{ key: "status", label: "Status", options: [{ value: "paid", label: "Paid" }] }]}
        activeFilters={{ status: "paid" }} />,
    );
    await userEvent.click(screen.getByLabelText("Remove Status filter"));
    expect(onParamsChange).toHaveBeenCalledWith({ status: null, page: null });
  });

  it("reveals bulk actions once rows are selected", async () => {
    const onSelect = vi.fn();
    render(<DataTable {...base} bulkActions={[{ label: "Send email", onSelect }]} getRowId={(r) => r.id} />);
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByLabelText("Select row")[0]);
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send email" }));
    expect(onSelect).toHaveBeenCalledWith(["1"]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter web test components/data-table`
Expected: FAIL — cannot resolve `./pagination` and `./data-table`.

- [ ] **Step 3: Install the shadcn components the table needs**

```bash
cd apps/web
pnpm dlx shadcn@latest add checkbox popover command pagination alert
```

Then, **mandatory** per the Global Constraints:

```bash
grep -rn "var(--" components/ui/checkbox.tsx components/ui/popover.tsx components/ui/command.tsx components/ui/pagination.tsx components/ui/alert.tsx
```

Rewrite every hit that is not already `var(--color-*)`. For example `bg-popover` resolving through `var(--popover)` must become `var(--color-popover)`. A missed one produces invalid CSS that is silently dropped — the component renders transparent, not broken, so it is easy to miss.

- [ ] **Step 4: Implement pagination**

`apps/web/components/data-table/pagination.tsx`:

```tsx
"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PER_PAGE_OPTIONS, rangeLabel } from "@/lib/table-params";

/** Page numbers to render, with `null` marking an ellipsis gap.
 *  Always shows first, last, current, and one neighbour either side. */
export function pageWindow(page: number, pageCount: number): (number | null)[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const out: (number | null)[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);
  if (start > 2) out.push(null);
  for (let i = start; i <= end; i++) out.push(i);
  if (end < pageCount - 1) out.push(null);
  out.push(pageCount);
  return out;
}

export function DataTablePagination({
  page, per, total, onPageChange, onPerChange,
}: {
  page: number; per: number; total: number;
  onPageChange: (page: number) => void;
  onPerChange: (per: number) => void;
}) {
  if (total === 0) return null;
  const pageCount = Math.max(1, Math.ceil(total / per));

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-4 py-3">
      <div className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
        <span>Rows per page</span>
        <Select value={String(per)} onValueChange={(v) => onPerChange(Number(v))}>
          <SelectTrigger aria-label="Rows per page" className="h-8 w-[72px] rounded-lg">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PER_PAGE_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>{n}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span aria-hidden>·</span>
        <span className="font-mono tabular">{rangeLabel(page, per, total)}</span>
      </div>

      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="size-8 rounded-lg" aria-label="First page"
          disabled={page <= 1} onClick={() => onPageChange(1)}>
          <ChevronsLeft className="size-4" />
        </Button>
        <Button variant="outline" size="icon" className="size-8 rounded-lg" aria-label="Previous page"
          disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="size-4" />
        </Button>
        {pageWindow(page, pageCount).map((n, i) =>
          n === null ? (
            <span key={`gap-${i}`} className="px-1 text-sm text-muted-foreground" aria-hidden>…</span>
          ) : (
            <Button key={n} size="icon" aria-label={`Page ${n}`} aria-current={n === page ? "page" : undefined}
              variant={n === page ? "default" : "outline"} className="size-8 rounded-lg font-mono tabular"
              onClick={() => onPageChange(n)}>
              {n}
            </Button>
          ),
        )}
        <Button variant="outline" size="icon" className="size-8 rounded-lg" aria-label="Next page"
          disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
          <ChevronRight className="size-4" />
        </Button>
        <Button variant="outline" size="icon" className="size-8 rounded-lg" aria-label="Last page"
          disabled={page >= pageCount} onClick={() => onPageChange(pageCount)}>
          <ChevronsRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement the URL writer hook**

`apps/web/lib/use-table-params.ts`:

```tsx
"use client";

import { useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DEFAULT_PER, type SortState } from "./table-params";

/** Writes table state into the URL. Parsing happens server-side in
 *  table-params.ts — this hook never reads state back for rendering. */
export function useTableParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  /** null removes the key. Every caller that changes what is being listed
   *  passes page: null too, so you never land on page 9 of a 2-page result. */
  const patch = useCallback(
    (next: Record<string, string | null>) => {
      const sp = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === null || v === "" || v === "all") sp.delete(k);
        else sp.set(k, v);
      }
      const qs = sp.toString();
      startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  return {
    isPending,
    patch,
    setPage: (p: number) => patch({ page: p <= 1 ? null : String(p) }),
    setPer: (n: number) => patch({ per: n === DEFAULT_PER ? null : String(n), page: null }),
    setSort: (s: SortState[]) =>
      patch({ sort: s.length ? s.map((x) => `${x.id}:${x.desc ? "desc" : "asc"}`).join(",") : null, page: null }),
    setFilter: (key: string, value: string) => patch({ [key]: value, page: null }),
    setQ: (value: string) => patch({ q: value || null, page: null }),
    clearFilters: () => {
      const sp = new URLSearchParams(searchParams.toString());
      for (const key of Array.from(sp.keys())) {
        if (key !== "sort" && key !== "per") sp.delete(key);
      }
      const qs = sp.toString();
      startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
  };
}
```

- [ ] **Step 6: Implement the remaining table pieces**

`apps/web/components/data-table/faceted-filter.tsx`:

```tsx
"use client";

import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export type FilterDef = {
  key: string;
  label: string;
  options: { value: string; label: string; count?: number }[];
};

export function FacetedFilter({ def, value, onChange }: {
  def: FilterDef; value: string; onChange: (value: string) => void;
}) {
  const active = def.options.find((o) => o.value === value);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 rounded-lg" aria-label={def.label}>
          {def.label}
          {active ? (
            <span className="ml-1.5 rounded-pill bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">1</span>
          ) : null}
          <ChevronDown className="ml-1 size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <Command>
          {def.options.length > 8 ? <CommandInput placeholder={`Filter ${def.label.toLowerCase()}…`} /> : null}
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              <CommandItem onSelect={() => onChange("all")}>
                <Check className={cn("mr-2 size-4", value === "all" ? "opacity-100" : "opacity-0")} />
                All
              </CommandItem>
              {def.options.map((o) => (
                <CommandItem key={o.value} onSelect={() => onChange(o.value)}>
                  <Check className={cn("mr-2 size-4", value === o.value ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.count != null ? (
                    <span className="ml-2 font-mono tabular text-xs text-muted-foreground">{o.count}</span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

`apps/web/components/data-table/active-filters.tsx`:

```tsx
"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FilterDef } from "./faceted-filter";

export function ActiveFilters({ defs, active, q, onRemove, onClearAll }: {
  defs: FilterDef[];
  active: Record<string, string>;
  q: string;
  onRemove: (key: string) => void;
  onClearAll: () => void;
}) {
  const chips = defs
    .map((def) => {
      const value = active[def.key];
      if (!value || value === "all") return null;
      const label = def.options.find((o) => o.value === value)?.label ?? value;
      return { key: def.key, text: `${def.label}: ${label}`, aria: `Remove ${def.label} filter` };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (q) chips.push({ key: "q", text: `Search: ${q}`, aria: "Remove search filter" });
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <span key={c.key}
          className="inline-flex items-center gap-1.5 rounded-pill bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground">
          {c.text}
          <button type="button" aria-label={c.aria} onClick={() => onRemove(c.key)}
            className="opacity-60 transition-opacity hover:opacity-100">
            <X className="size-3" />
          </button>
        </span>
      ))}
      <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={onClearAll}>
        Clear all
      </Button>
    </div>
  );
}
```

`apps/web/components/data-table/bulk-bar.tsx`:

```tsx
"use client";

import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export type BulkAction = {
  label: string;
  icon?: LucideIcon;
  variant?: "default" | "destructive";
  onSelect: (ids: string[]) => void;
};

export function BulkBar({ count, ids, actions, onClear }: {
  count: number; ids: string[]; actions: BulkAction[]; onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-accent px-4 py-2.5">
      <span className="text-[13px] font-semibold text-accent-foreground">{count} selected</span>
      {actions.map((a) => (
        <Button key={a.label} size="sm" variant={a.variant === "destructive" ? "destructive" : "outline"}
          className="h-8 rounded-lg" onClick={() => a.onSelect(ids)}>
          {a.icon ? <a.icon className="size-3.5" /> : null}
          {a.label}
        </Button>
      ))}
      <Button variant="ghost" size="sm" className="ml-auto h-8 text-xs text-muted-foreground" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
```

`apps/web/components/data-table/empty-state.tsx`:

```tsx
import { Inbox } from "lucide-react";

export function TableEmptyState({ title, description, action }: {
  title: string; description: string; action?: React.ReactNode;
}) {
  return (
    <div className="grid place-items-center px-6 py-16 text-center">
      <div className="grid size-11 place-items-center rounded-xl bg-muted">
        <Inbox className="size-5 text-muted-foreground" />
      </div>
      <h3 className="mt-3.5 text-sm font-semibold">{title}</h3>
      <p className="mt-1 max-w-xs text-[13px] text-muted-foreground">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function DataTableSkeleton({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="h-10 border-b border-border bg-muted/60" />
      {Array.from({ length: rows }).map((_, r) => (
        // 44px matches the real row height, so nothing shifts when data lands.
        <div key={r} className="flex h-11 items-center gap-4 border-b border-border px-4 last:border-b-0">
          {Array.from({ length: columns }).map((_, c) => (
            <div key={c} className="h-3 flex-1 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ))}
    </div>
  );
}
```

`apps/web/components/data-table/column-header.tsx`:

```tsx
"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { Header } from "@tanstack/react-table";
import { flexRender } from "@tanstack/react-table";
import { TableHead } from "@/components/ui/table";

export function SortableHeader<TData>({ header, onSort }: {
  header: Header<TData, unknown>;
  onSort: (id: string, desc: boolean) => void;
}) {
  const canSort = header.column.getCanSort();
  const dir = header.column.getIsSorted();
  const content = header.isPlaceholder
    ? null
    : flexRender(header.column.columnDef.header, header.getContext());

  return (
    <TableHead
      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : canSort ? "none" : undefined}
      className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
    >
      {canSort ? (
        <button type="button" className="inline-flex items-center gap-1 uppercase"
          onClick={() => onSort(header.column.id, dir === "asc")}>
          {content}
          {dir === "asc" ? <ArrowUp className="size-3" />
            : dir === "desc" ? <ArrowDown className="size-3" />
            : <ChevronsUpDown className="size-3 opacity-40" />}
        </button>
      ) : content}
    </TableHead>
  );
}
```

`apps/web/components/data-table/toolbar.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { FacetedFilter, type FilterDef } from "./faceted-filter";

export function DataTableToolbar({
  filterDefs, activeFilters, q, searchPlaceholder, columnToggles,
  onFilterChange, onSearchChange,
}: {
  filterDefs: FilterDef[];
  activeFilters: Record<string, string>;
  q: string;
  searchPlaceholder: string;
  columnToggles: { id: string; label: string; visible: boolean; toggle: () => void }[];
  onFilterChange: (key: string, value: string) => void;
  onSearchChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(q);

  // Debounce so typing does not push a history entry per keystroke. The
  // mounted ref stops the initial value echoing straight back into the URL.
  const mounted = useRef(false);
  const onSearchRef = useRef(onSearchChange);
  onSearchRef.current = onSearchChange;
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    const id = setTimeout(() => onSearchRef.current(draft), 300);
    return () => clearTimeout(id);
  }, [draft]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label="Search" placeholder={searchPlaceholder} className="h-9 w-[220px] rounded-lg pl-8"
          value={draft} onChange={(e) => setDraft(e.target.value)} />
      </div>

      {filterDefs.map((def) => (
        <FacetedFilter key={def.key} def={def}
          value={activeFilters[def.key] ?? "all"}
          onChange={(v) => onFilterChange(def.key, v)} />
      ))}

      {columnToggles.length > 0 ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="ml-auto h-9 rounded-lg" aria-label="Toggle columns">
              <SlidersHorizontal className="size-3.5" />
              Columns
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-48 space-y-2 p-3">
            {columnToggles.map((c) => (
              <div key={c.id} className="flex items-center gap-2">
                <Checkbox id={`col-${c.id}`} checked={c.visible} onCheckedChange={c.toggle} />
                <Label htmlFor={`col-${c.id}`} className="text-[13px] font-normal">{c.label}</Label>
              </div>
            ))}
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
```

`apps/web/components/data-table/data-table.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  flexRender, getCoreRowModel, useReactTable,
  type ColumnDef, type VisibilityState,
} from "@tanstack/react-table";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { useTableParams } from "@/lib/use-table-params";
import type { SortState } from "@/lib/table-params";
import { DataTableToolbar } from "./toolbar";
import { ActiveFilters } from "./active-filters";
import { BulkBar, type BulkAction } from "./bulk-bar";
import { DataTablePagination } from "./pagination";
import { SortableHeader } from "./column-header";
import { TableEmptyState } from "./empty-state";
import type { FilterDef } from "./faceted-filter";
import { cn } from "@/lib/utils";

export type DataTableProps<TData> = {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  total: number;
  page: number;
  per: number;
  sort: SortState[];
  filterDefs: FilterDef[];
  activeFilters: Record<string, string>;
  q?: string;
  searchPlaceholder?: string;
  bulkActions?: BulkAction[];
  getRowId?: (row: TData) => string;
  rowHref?: (row: TData) => string;
  emptyState?: { title: string; description: string; action?: React.ReactNode };
  isError?: boolean;
};

export function DataTable<TData>({
  columns, data, total, page, per, sort, filterDefs, activeFilters,
  q = "", searchPlaceholder = "Search…", bulkActions = [],
  getRowId, rowHref, emptyState, isError,
}: DataTableProps<TData>) {
  const params = useTableParams();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [visibility, setVisibility] = useState<VisibilityState>({});

  const selectable = bulkActions.length > 0 && !!getRowId;

  const allColumns = useMemo<ColumnDef<TData, unknown>[]>(() => {
    if (!selectable) return columns;
    return [
      {
        id: "__select",
        enableSorting: false,
        size: 38,
        header: () => null,
        cell: ({ row }) => {
          const id = getRowId!(row.original);
          return (
            <Checkbox aria-label="Select row" checked={!!selected[id]}
              onCheckedChange={(v) => setSelected((s) => ({ ...s, [id]: !!v }))} />
          );
        },
      },
      ...columns,
    ];
  }, [columns, selectable, getRowId, selected]);

  const table = useReactTable({
    data,
    columns: allColumns,
    state: { sorting: sort, columnVisibility: visibility },
    onColumnVisibilityChange: setVisibility,
    manualSorting: true,
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
  });

  const selectedIds = Object.keys(selected).filter((k) => selected[k]);

  const columnToggles = table
    .getAllColumns()
    .filter((c) => c.id !== "__select" && c.getCanHide())
    .map((c) => ({
      id: c.id,
      label: typeof c.columnDef.header === "string" ? c.columnDef.header : c.id,
      visible: c.getIsVisible(),
      toggle: () => c.toggleVisibility(),
    }));

  return (
    <div className="space-y-3">
      <DataTableToolbar
        filterDefs={filterDefs} activeFilters={activeFilters} q={q}
        searchPlaceholder={searchPlaceholder} columnToggles={columnToggles}
        onFilterChange={params.setFilter} onSearchChange={params.setQ}
      />

      <ActiveFilters defs={filterDefs} active={activeFilters} q={q}
        onRemove={(key) => (key === "q" ? params.setQ("") : params.setFilter(key, "all"))}
        onClearAll={params.clearFilters} />

      {/* Announced after every filter change so screen-reader users learn the
          result count without hunting for it. */}
      <p role="status" aria-live="polite" className="sr-only">{total} results</p>

      <div className={cn("overflow-hidden rounded-xl border border-border bg-card", params.isPending && "opacity-60 transition-opacity")}>
        {selectable ? (
          <BulkBar count={selectedIds.length} ids={selectedIds} actions={bulkActions} onClear={() => setSelected({})} />
        ) : null}

        {isError ? (
          <Alert variant="destructive" className="m-4 w-auto">
            <AlertCircle className="size-4" />
            <AlertDescription>Couldn&apos;t load this data. Reload the page to try again.</AlertDescription>
          </Alert>
        ) : data.length === 0 ? (
          <TableEmptyState
            title={emptyState?.title ?? "Nothing here yet"}
            description={emptyState?.description ?? "Try clearing your filters."}
            action={emptyState?.action}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/60">
                {table.getHeaderGroups().map((group) => (
                  <TableRow key={group.id}>
                    {group.headers.map((header) => (
                      <SortableHeader key={header.id} header={header}
                        onSort={(id, desc) => params.setSort([{ id, desc }])} />
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} className={cn(rowHref && "cursor-pointer")}>
                    {row.getVisibleCells().map((cell) => {
                      const body = flexRender(cell.column.columnDef.cell, cell.getContext());
                      return (
                        <TableCell key={cell.id} className="py-3 text-[13px]">
                          {/* Link wraps the cell, not the row: an <a> cannot
                              legally contain <td>, and this keeps the row
                              keyboard-navigable and middle-clickable. */}
                          {rowHref && cell.column.id !== "__select" ? (
                            <Link href={rowHref(row.original)} className="block">{body}</Link>
                          ) : body}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!isError ? (
          <DataTablePagination page={page} per={per} total={total}
            onPageChange={params.setPage} onPerChange={params.setPer} />
        ) : null}
      </div>
    </div>
  );
}
```

`apps/web/components/data-table/index.ts`:

```ts
export { DataTable, type DataTableProps } from "./data-table";
export { type FilterDef } from "./faceted-filter";
export { type BulkAction } from "./bulk-bar";
export { DataTableSkeleton, TableEmptyState } from "./empty-state";
export { DataTablePagination, pageWindow } from "./pagination";
```

- [ ] **Step 7: Run tests to verify they pass**

The tests render `DataTable` outside a Next router, so `useTableParams` must be mocked. Add this to the top of `data-table.test.tsx`, below the imports:

```tsx
vi.mock("@/lib/use-table-params", () => ({
  useTableParams: () => ({
    isPending: false,
    patch: mockPatch,
    setPage: vi.fn(), setPer: vi.fn(), setSort: vi.fn(),
    setFilter: (key: string, value: string) => mockPatch({ [key]: value === "all" ? null : value, page: null }),
    setQ: vi.fn(), clearFilters: vi.fn(),
  }),
}));
const mockPatch = vi.fn();
```

and change the chip test to assert on `mockPatch`. Note `vi.mock` is hoisted above the `const`, so `mockPatch` must be declared with `var`-like hoisting semantics — declare it inside the factory instead if the reference errors.

Run: `pnpm --filter web test components/data-table`
Expected: PASS, 13 tests.

- [ ] **Step 8: Delete the old table**

```bash
git rm apps/web/components/DataTable.tsx apps/web/__tests__/data-table.test.tsx apps/web/__tests__/table-params.test.tsx
```

- [ ] **Step 9: Commit**

```bash
git add -A apps/web
git commit -m "feat(web): shared DataTable with filters, bulk actions and page size

One composition for every list page: debounced search, faceted filter
popovers, removable filter chips, aria-sort headers, bulk-select action bar,
rows-per-page and a range label. State round-trips through the URL."
```

---

## Task 6: Events page

**Files:**
- Create: `apps/web/lib/queries/events.ts`, `apps/web/app/(admin)/events/page.tsx`, `apps/web/app/(admin)/events/events-table.tsx`, `apps/web/app/(admin)/events/loading.tsx`
- Create: `apps/web/app/(admin)/events/events-table.test.tsx`
- Delete: `apps/web/routes/Events.tsx`, `apps/web/__tests__/events.test.tsx`

**Interfaces:**
- Consumes: `parseTableParams`, `DataTable`, `FilterDef`, `getMyRoles`.
- Produces: `lib/queries/events.ts` → `type AdminEventRow` (as in the old `lib/events.ts`, unchanged) and `async listOrgEvents(orgId: string, params: TableParams): Promise<{ rows: AdminEventRow[]; total: number }>`.

- [ ] **Step 1: Write the server query**

`apps/web/lib/queries/events.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import type { TableParams } from "@/lib/table-params";

export type AdminEventRow = {
  id: string;
  name: string;
  place: string | null;
  city_name: string | null;
  province_name: string | null;
  event_date: string | null;
  end_date: string | null;
  status: string;
  original_date: string | null;
  categories: { slots_taken: number; slots_total: number }[];
};

const SELECT =
  "id,name,place,city_name,province_name,event_date,end_date,status,original_date,categories(slots_taken,slots_total)";

/**
 * PostgREST's `.or()` filter string is a structural mini-language where
 * `,`, `(`, `)` and `.` separate logic-tree nodes. A raw search term
 * containing any of those (e.g. "Dela Cruz, Ana") breaks the parse
 * (PGRST100) and 400s the whole query. Quoting the value as
 * `col.ilike."value"` makes it one opaque token; escape backslashes and
 * double quotes inside it per PostgREST's quoted-value syntax.
 */
export function quotePostgrestValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export async function listOrgEvents(
  orgId: string,
  params: TableParams,
): Promise<{ rows: AdminEventRow[]; total: number }> {
  const supabase = await createClient();
  const from = (params.page - 1) * params.per;

  let req = supabase.from("events").select(SELECT, { count: "exact" }).eq("org_id", orgId);

  const status = params.filters.status ?? "all";
  if (status !== "all") req = req.eq("status", status);

  if (params.q.trim()) {
    const term = quotePostgrestValue(`%${params.q.trim()}%`);
    req = req.or(`name.ilike.${term},place.ilike.${term},city_name.ilike.${term}`);
  }

  const s = params.sort[0] ?? { id: "event_date", desc: false };
  req = req.order(s.id, { ascending: !s.desc }).range(from, from + params.per - 1);

  const { data, error, count } = await req;
  if (error) throw error;
  return { rows: (data ?? []) as AdminEventRow[], total: count ?? 0 };
}
```

- [ ] **Step 2: Write the failing test for the client table**

`apps/web/app/(admin)/events/events-table.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventsTable } from "./events-table";
import type { AdminEventRow } from "@/lib/queries/events";

vi.mock("@/lib/use-table-params", () => ({
  useTableParams: () => ({
    isPending: false, patch: vi.fn(), setPage: vi.fn(), setPer: vi.fn(),
    setSort: vi.fn(), setFilter: vi.fn(), setQ: vi.fn(), clearFilters: vi.fn(),
  }),
}));

const rows: AdminEventRow[] = [
  {
    id: "e1", name: "Dahilayan Sky Ultra", place: "Dahilayan", city_name: "Manolo Fortich",
    province_name: "Bukidnon", event_date: "2026-11-14", end_date: null, status: "published",
    original_date: null, categories: [{ slots_taken: 120, slots_total: 200 }, { slots_taken: 40, slots_total: 50 }],
  },
];

describe("EventsTable", () => {
  it("shows the event name and location", () => {
    render(<EventsTable rows={rows} total={1} page={1} per={25} sort={[]} activeFilters={{}} q="" />);
    expect(screen.getByText("Dahilayan Sky Ultra")).toBeInTheDocument();
    expect(screen.getByText(/Manolo Fortich/)).toBeInTheDocument();
  });

  it("sums slots across categories", () => {
    render(<EventsTable rows={rows} total={1} page={1} per={25} sort={[]} activeFilters={{}} q="" />);
    expect(screen.getByText("160 / 250")).toBeInTheDocument();
  });

  it("offers a create action from the empty state", () => {
    render(<EventsTable rows={[]} total={0} page={1} per={25} sort={[]} activeFilters={{}} q="" />);
    expect(screen.getByRole("link", { name: /create an event/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter web test app/\(admin\)/events`
Expected: FAIL — cannot resolve `./events-table`.

- [ ] **Step 4: Implement the client table and the page**

`apps/web/app/(admin)/events/events-table.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { DataTable, type FilterDef } from "@/components/data-table";
import { EventStatusBadge } from "@/components/StatusBadge";
import type { AdminEventRow } from "@/lib/queries/events";
import type { SortState } from "@/lib/table-params";

const STATUS_FILTER: FilterDef = {
  key: "status",
  label: "Status",
  options: [
    { value: "draft", label: "Draft" },
    { value: "published", label: "Published" },
    { value: "cancelled", label: "Cancelled" },
    { value: "completed", label: "Completed" },
  ],
};

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

export function EventsTable({ rows, total, page, per, sort, activeFilters, q }: {
  rows: AdminEventRow[]; total: number; page: number; per: number;
  sort: SortState[]; activeFilters: Record<string, string>; q: string;
}) {
  const columns = useMemo<ColumnDef<AdminEventRow, unknown>[]>(() => [
    {
      accessorKey: "name",
      header: "Event",
      cell: ({ row }) => (
        <div>
          <div className="font-semibold">{row.original.name}</div>
          <div className="text-xs text-muted-foreground">
            {[row.original.place, row.original.city_name, row.original.province_name].filter(Boolean).join(", ") || "—"}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "event_date",
      header: "Date",
      cell: ({ row }) => <span className="font-mono tabular text-muted-foreground">{fmtDate(row.original.event_date)}</span>,
    },
    {
      id: "slots",
      header: "Slots",
      enableSorting: false,
      cell: ({ row }) => {
        const taken = row.original.categories.reduce((n, c) => n + c.slots_taken, 0);
        const totalSlots = row.original.categories.reduce((n, c) => n + c.slots_total, 0);
        return <span className="font-mono tabular">{taken} / {totalSlots}</span>;
      },
    },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <EventStatusBadge status={row.original.status} /> },
  ], []);

  return (
    <DataTable
      columns={columns} data={rows} total={total} page={page} per={per} sort={sort}
      filterDefs={[STATUS_FILTER]} activeFilters={activeFilters} q={q}
      searchPlaceholder="Search events…"
      rowHref={(r) => `/events/${r.id}/edit`}
      emptyState={{
        title: q || activeFilters.status ? "No events match" : "No events yet",
        description: q || activeFilters.status
          ? "Try a different search or clear your filters."
          : "Create your first event to start taking registrations.",
        action: <Button asChild size="sm"><Link href="/events/new">Create an event</Link></Button>,
      }}
    />
  );
}
```

`apps/web/app/(admin)/events/page.tsx`:

```tsx
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseTableParams } from "@/lib/table-params";
import { getMyRoles } from "@/lib/queries/roles";
import { listOrgEvents } from "@/lib/queries/events";
import { EventsTable } from "./events-table";

const DEFAULTS = { sort: [{ id: "event_date", desc: false }], filters: { status: "all" } };

export default async function EventsPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // searchParams is a Promise in Next 15 and must be awaited.
  const params = parseTableParams(await searchParams, DEFAULTS);
  const roles = await getMyRoles();
  const { rows, total } = await listOrgEvents(roles!.orgId!, params);

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-5 flex flex-wrap items-start gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Events</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            <span className="font-mono tabular">{total}</span> event{total === 1 ? "" : "s"} in this organization
          </p>
        </div>
        <Button asChild className="ml-auto">
          <Link href="/events/new"><Plus className="size-4" />New event</Link>
        </Button>
      </div>

      <EventsTable rows={rows} total={total} page={params.page} per={params.per}
        sort={params.sort} activeFilters={params.filters} q={params.q} />
    </div>
  );
}
```

`apps/web/app/(admin)/events/loading.tsx`:

```tsx
import { DataTableSkeleton } from "@/components/data-table";

export default function Loading() {
  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-5 h-9 w-40 animate-pulse rounded bg-muted" />
      <DataTableSkeleton rows={8} columns={4} />
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter web test app/\(admin\)/events`
Expected: PASS, 3 tests.

If `EventStatusBadge` is not the export name in `components/StatusBadge.tsx`, read that file and use the actual export — the old `routes/Events.tsx` imported it, so grep there first.

- [ ] **Step 6: Delete the old route**

```bash
git rm apps/web/routes/Events.tsx apps/web/__tests__/events.test.tsx
```

- [ ] **Step 7: Verify manually and commit**

Visit `/events`. Confirm: filtering by status updates the URL and the row count; a hard reload preserves the filter; the back button restores the previous filter; sorting by Date flips `?sort=event_date:desc`.

```bash
git add -A apps/web
git commit -m "feat(web): server-rendered Events page on the shared DataTable"
```

---

## Task 7: Registrations page

Registrations are scoped to one event — the page needs an event picker, and switching events must clear the per-event category filter or the table silently returns zero rows.

**Files:**
- Create: `apps/web/lib/queries/registrations.ts`, `apps/web/app/(admin)/registrations/page.tsx`, `registrations-table.tsx`, `event-picker.tsx`, `loading.tsx`
- Create: `apps/web/app/(admin)/registrations/registrations-table.test.tsx`
- Modify: `apps/web/components/RegistrationDetail.tsx` (add `"use client"`, take the row as a prop, call a Server Action to refund)
- Create: `apps/web/lib/actions/registrations.ts`
- Delete: `apps/web/routes/Registrations.tsx`, `apps/web/__tests__/registrations.test.tsx`, `apps/web/__tests__/registrations-hooks.test.tsx`, `apps/web/__tests__/events-registrations.test.tsx`

**Interfaces:**
- Consumes: `parseTableParams`, `DataTable`, `quotePostgrestValue` from `@/lib/queries/events`.
- Produces:
  - `lib/queries/registrations.ts` → `type RegistrationRow` and `type PaymentStatus` (unchanged from the old `lib/registrations.ts`), `async listEventRegistrations(eventId: string, params: TableParams)`, `async listOrgEventOptions(orgId: string)` returning `{ id: string; name: string; count: number }[]`, `async listEventCategories(eventId: string)` returning `{ id: string; label: string }[]`
  - `lib/actions/registrations.ts` → `async refundRegistrationAction(registrationId: string, note?: string): Promise<{ ok: boolean; error?: string }>`

- [ ] **Step 1: Write the server queries**

`apps/web/lib/queries/registrations.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import type { TableParams } from "@/lib/table-params";
import { quotePostgrestValue } from "./events";

export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export type RegistrationRow = {
  id: string;
  user_id: string;
  category_id: string;
  category_label: string | null;
  full_name: string | null;
  bib_name: string | null;
  total_amount: number;
  payment_status: PaymentStatus | null;
  payment_method: string | null;
  created_at: string;
  custom_data: Record<string, unknown>;
};

const SELECT =
  "id,user_id,category_id,category_label,full_name,bib_name,total_amount,payment_status,payment_method,custom_data,created_at";

export async function listEventRegistrations(
  eventId: string,
  params: TableParams,
): Promise<{ rows: RegistrationRow[]; total: number }> {
  const supabase = await createClient();
  const from = (params.page - 1) * params.per;

  let req = supabase
    .from("admin_registrations_v")
    .select(SELECT, { count: "exact" })
    .eq("event_id", eventId);

  const status = params.filters.status ?? "all";
  if (status !== "all") req = req.eq("payment_status", status);

  const category = params.filters.category ?? "all";
  if (category !== "all") req = req.eq("category_id", category);

  if (params.q.trim()) {
    const term = quotePostgrestValue(`%${params.q.trim()}%`);
    req = req.or(`full_name.ilike.${term},bib_name.ilike.${term}`);
  }

  const s = params.sort[0] ?? { id: "created_at", desc: true };
  req = req.order(s.id, { ascending: !s.desc }).range(from, from + params.per - 1);

  const { data, error, count } = await req;
  if (error) throw error;
  return { rows: (data ?? []) as RegistrationRow[], total: count ?? 0 };
}

/** Events for the picker, with their registration counts. */
export async function listOrgEventOptions(orgId: string): Promise<{ id: string; name: string; count: number }[]> {
  const supabase = await createClient();
  const [events, counts] = await Promise.all([
    supabase.from("events").select("id,name").eq("org_id", orgId).order("event_date", { ascending: false }),
    supabase.from("admin_event_reg_counts_v").select("event_id,reg_count").eq("org_id", orgId),
  ]);
  if (events.error) throw events.error;
  if (counts.error) throw counts.error;

  const byId = new Map((counts.data ?? []).map((c) => [c.event_id as string, c.reg_count as number]));
  return (events.data ?? []).map((e) => ({ id: e.id as string, name: e.name as string, count: byId.get(e.id as string) ?? 0 }));
}

export async function listEventCategories(eventId: string): Promise<{ id: string; label: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories").select("id,label").eq("event_id", eventId).order("base_price", { ascending: false });
  if (error) throw error;
  return (data ?? []) as { id: string; label: string }[];
}
```

- [ ] **Step 2: Write the refund Server Action**

`apps/web/lib/actions/registrations.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Full refund via the admin-refund Edge Function, which owns the atomic
 *  money transition. Never update payment_status directly from here. */
export async function refundRegistrationAction(
  registrationId: string,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.functions.invoke("admin-refund", {
    body: { registration_id: registrationId, note: note ?? null },
  });

  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    return {
      ok: false,
      error:
        status === 403 ? "You don't have permission to refund this registration."
        : status === 409 ? "This registration can't be refunded — it isn't paid."
        : status === 404 ? "Registration not found."
        : "Refund failed. Please try again.",
    };
  }

  revalidatePath("/registrations");
  revalidatePath("/payments");
  return { ok: true };
}
```

- [ ] **Step 3: Write the failing test**

`apps/web/app/(admin)/registrations/registrations-table.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RegistrationsTable } from "./registrations-table";
import type { RegistrationRow } from "@/lib/queries/registrations";

vi.mock("@/lib/use-table-params", () => ({
  useTableParams: () => ({
    isPending: false, patch: vi.fn(), setPage: vi.fn(), setPer: vi.fn(),
    setSort: vi.fn(), setFilter: vi.fn(), setQ: vi.fn(), clearFilters: vi.fn(),
  }),
}));

const rows: RegistrationRow[] = [
  {
    id: "r1", user_id: "u1", category_id: "c1", category_label: "50K Ultra",
    full_name: "Maria Josefa Santos", bib_name: "MJ", total_amount: 285000,
    payment_status: "paid", payment_method: "gcash",
    created_at: "2026-08-03T09:14:00Z", custom_data: {},
  },
];

const props = {
  rows, total: 1, page: 1, per: 25, sort: [], activeFilters: {}, q: "",
  categories: [{ id: "c1", label: "50K Ultra" }],
};

describe("RegistrationsTable", () => {
  it("renders the runner name and category", () => {
    render(<RegistrationsTable {...props} />);
    expect(screen.getByText("Maria Josefa Santos")).toBeInTheDocument();
    expect(screen.getByText("50K Ultra")).toBeInTheDocument();
  });

  it("formats centavos as pesos", () => {
    render(<RegistrationsTable {...props} />);
    expect(screen.getByText("₱2,850")).toBeInTheDocument();
  });

  it("builds the category filter from the event's categories", () => {
    render(<RegistrationsTable {...props} />);
    expect(screen.getByLabelText("Category")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm --filter web test app/\(admin\)/registrations`
Expected: FAIL — cannot resolve `./registrations-table`.

- [ ] **Step 5: Implement the event picker, the table, and the page**

`apps/web/app/(admin)/registrations/event-picker.tsx`:

```tsx
"use client";

import { usePathname, useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function EventPicker({ events, value }: {
  events: { id: string; name: string; count: number }[];
  value: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <Select
      value={value}
      onValueChange={(id) => {
        // Category ids are per-event, so carrying a category filter across a
        // switch would silently return zero rows. Drop every other param and
        // start clean on the new event.
        router.push(`${pathname}?event=${id}`, { scroll: false });
      }}
    >
      <SelectTrigger aria-label="Event" className="h-9 w-[280px] rounded-lg">
        <SelectValue placeholder="Pick an event" />
      </SelectTrigger>
      <SelectContent>
        {events.map((e) => (
          <SelectItem key={e.id} value={e.id}>
            {e.name} <span className="font-mono tabular text-muted-foreground">({e.count})</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

`apps/web/app/(admin)/registrations/registrations-table.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, type FilterDef } from "@/components/data-table";
import { PaymentStatusBadge } from "@/components/StatusBadge";
import type { RegistrationRow } from "@/lib/queries/registrations";
import type { SortState } from "@/lib/table-params";

const peso = (centavos: number) => `₱${(centavos / 100).toLocaleString()}`;
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

const STATUS_FILTER: FilterDef = {
  key: "status",
  label: "Status",
  options: [
    { value: "paid", label: "Paid" },
    { value: "pending", label: "Pending" },
    { value: "refunded", label: "Refunded" },
    { value: "failed", label: "Failed" },
  ],
};

export function RegistrationsTable({
  rows, total, page, per, sort, activeFilters, q, categories,
}: {
  rows: RegistrationRow[]; total: number; page: number; per: number;
  sort: SortState[]; activeFilters: Record<string, string>; q: string;
  categories: { id: string; label: string }[];
}) {
  const filterDefs = useMemo<FilterDef[]>(() => [
    STATUS_FILTER,
    { key: "category", label: "Category", options: categories.map((c) => ({ value: c.id, label: c.label })) },
  ], [categories]);

  const columns = useMemo<ColumnDef<RegistrationRow, unknown>[]>(() => [
    {
      accessorKey: "full_name",
      header: "Runner",
      cell: ({ row }) => (
        <div>
          <div className="font-semibold">{row.original.full_name ?? "—"}</div>
          {row.original.bib_name ? (
            <div className="text-xs text-muted-foreground">{row.original.bib_name}</div>
          ) : null}
        </div>
      ),
    },
    { accessorKey: "category_label", header: "Category", cell: ({ row }) => row.original.category_label ?? "—" },
    {
      accessorKey: "total_amount",
      header: "Amount",
      cell: ({ row }) => <span className="font-mono tabular">{peso(row.original.total_amount)}</span>,
    },
    {
      accessorKey: "payment_status",
      header: "Payment",
      cell: ({ row }) => <PaymentStatusBadge status={row.original.payment_status} />,
    },
    {
      accessorKey: "created_at",
      header: "Registered",
      cell: ({ row }) => (
        <span className="font-mono tabular text-muted-foreground">{fmtDate(row.original.created_at)}</span>
      ),
    },
  ], []);

  return (
    <DataTable
      columns={columns} data={rows} total={total} page={page} per={per} sort={sort}
      filterDefs={filterDefs} activeFilters={activeFilters} q={q}
      searchPlaceholder="Search name or bib…"
      emptyState={{
        title: "No registrations match",
        description: "Try a different search, or clear your filters to see everyone.",
      }}
    />
  );
}
```

`apps/web/app/(admin)/registrations/page.tsx`:

```tsx
import { parseTableParams } from "@/lib/table-params";
import { getMyRoles } from "@/lib/queries/roles";
import { listEventRegistrations, listOrgEventOptions, listEventCategories } from "@/lib/queries/registrations";
import { TableEmptyState } from "@/components/data-table";
import { EventPicker } from "./event-picker";
import { RegistrationsTable } from "./registrations-table";

const DEFAULTS = { sort: [{ id: "created_at", desc: true }], filters: { status: "all", category: "all" } };

export default async function RegistrationsPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const params = parseTableParams(sp, DEFAULTS);
  const roles = await getMyRoles();

  const events = await listOrgEventOptions(roles!.orgId!);
  // `event` is a filter key, so parseTableParams already surfaced it. Default
  // to the most recent event so the page is never empty on first visit.
  const eventId = params.filters.event && params.filters.event !== "all"
    ? params.filters.event
    : events[0]?.id;

  if (!eventId) {
    return (
      <div className="px-4 pb-10 pt-6 md:px-[30px]">
        <h1 className="mb-5 text-xl font-bold tracking-tight">Registrations</h1>
        <div className="rounded-xl border border-border bg-card">
          <TableEmptyState title="No events yet" description="Create an event before you can take registrations." />
        </div>
      </div>
    );
  }

  const [{ rows, total }, categories] = await Promise.all([
    listEventRegistrations(eventId, params),
    listEventCategories(eventId),
  ]);

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight">Registrations</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          <span className="font-mono tabular">{total}</span> registration{total === 1 ? "" : "s"} for this event
        </p>
      </div>

      <div className="mb-3">
        <EventPicker events={events} value={eventId} />
      </div>

      <RegistrationsTable rows={rows} total={total} page={params.page} per={params.per}
        sort={params.sort} activeFilters={params.filters} q={params.q} categories={categories} />
    </div>
  );
}
```

`apps/web/app/(admin)/registrations/loading.tsx` — same shape as the Events one, with `columns={5}`:

```tsx
import { DataTableSkeleton } from "@/components/data-table";

export default function Loading() {
  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-5 h-9 w-48 animate-pulse rounded bg-muted" />
      <DataTableSkeleton rows={8} columns={5} />
    </div>
  );
}
```

- [ ] **Step 6: Port RegistrationDetail**

In `apps/web/components/RegistrationDetail.tsx`: add `"use client";` as the first line, replace the `refundRegistration` import from `lib/registrations` with `refundRegistrationAction` from `@/lib/actions/registrations`, and replace the `useRegistrationAddons` react-query hook with a `useEffect` + browser client fetch using `createClient()` from `@/lib/supabase/client`. Replace the `onRefunded` callback's `refetch()` calls with nothing — `revalidatePath` in the action already re-renders the server page.

- [ ] **Step 7: Run tests, delete old routes, commit**

Run: `pnpm --filter web test app/\(admin\)/registrations`
Expected: PASS, 3 tests.

```bash
git rm apps/web/routes/Registrations.tsx apps/web/lib/registrations.ts \
  apps/web/__tests__/registrations.test.tsx apps/web/__tests__/registrations-hooks.test.tsx \
  apps/web/__tests__/events-registrations.test.tsx
git add -A apps/web
git commit -m "feat(web): server-rendered Registrations with event picker

Switching events resets every other param, because category ids are
per-event and a stale category filter silently returns zero rows."
```

---

## Task 8: Payments page

**Files:**
- Create: `apps/web/lib/queries/payments.ts`, `apps/web/app/(admin)/payments/page.tsx`, `payments-table.tsx`, `loading.tsx`
- Create: `apps/web/app/(admin)/payments/payments-table.test.tsx`
- Modify: `apps/web/components/RefundModal.tsx` (add `"use client"`, call the Server Action)
- Delete: `apps/web/routes/Payments.tsx`, `apps/web/__tests__/payments.test.tsx`

**Interfaces:**
- Consumes: `parseTableParams`, `DataTable`, `quotePostgrestValue`, `refundRegistrationAction`.
- Produces: `lib/queries/payments.ts` → `type PaymentRow` (unchanged from the old `lib/registrations.ts`) and `async listOrgPayments(orgId: string, params: TableParams): Promise<{ rows: PaymentRow[]; total: number }>`.

- [ ] **Step 1: Write the server query**

`apps/web/lib/queries/payments.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import type { TableParams } from "@/lib/table-params";
import { quotePostgrestValue } from "./events";
import type { PaymentStatus } from "./registrations";

export type PaymentRow = {
  registration_id: string;
  event_id: string | null;
  event_name: string | null;
  user_id: string | null;
  full_name: string | null;
  amount: number;
  platform_fee: number;
  net_to_org: number;
  method: string | null;
  status: PaymentStatus;
  created_at: string;
};

const SELECT =
  "registration_id,event_id,event_name,user_id,full_name,amount,platform_fee,net_to_org,method,status,created_at";

export async function listOrgPayments(
  orgId: string,
  params: TableParams,
): Promise<{ rows: PaymentRow[]; total: number }> {
  const supabase = await createClient();
  const from = (params.page - 1) * params.per;

  let req = supabase.from("admin_payments_v").select(SELECT, { count: "exact" }).eq("org_id", orgId);

  const status = params.filters.status ?? "all";
  if (status !== "all") req = req.eq("status", status);

  const method = params.filters.method ?? "all";
  if (method !== "all") req = req.eq("method", method);

  if (params.q.trim()) {
    const term = quotePostgrestValue(`%${params.q.trim()}%`);
    req = req.or(`full_name.ilike.${term},event_name.ilike.${term}`);
  }

  const s = params.sort[0] ?? { id: "created_at", desc: true };
  req = req.order(s.id, { ascending: !s.desc }).range(from, from + params.per - 1);

  const { data, error, count } = await req;
  if (error) throw error;
  return { rows: (data ?? []) as PaymentRow[], total: count ?? 0 };
}
```

- [ ] **Step 2: Write the failing test**

`apps/web/app/(admin)/payments/payments-table.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PaymentsTable } from "./payments-table";
import type { PaymentRow } from "@/lib/queries/payments";

vi.mock("@/lib/use-table-params", () => ({
  useTableParams: () => ({
    isPending: false, patch: vi.fn(), setPage: vi.fn(), setPer: vi.fn(),
    setSort: vi.fn(), setFilter: vi.fn(), setQ: vi.fn(), clearFilters: vi.fn(),
  }),
}));

const rows: PaymentRow[] = [{
  registration_id: "r1", event_id: "e1", event_name: "Dahilayan Sky Ultra",
  user_id: "u1", full_name: "Maria Josefa Santos",
  amount: 285000, platform_fee: 14250, net_to_org: 270750,
  method: "gcash", status: "paid", created_at: "2026-08-03T09:14:00Z",
}];

const props = { rows, total: 1, page: 1, per: 25, sort: [], activeFilters: {}, q: "" };

describe("PaymentsTable", () => {
  it("shows gross, fee and net as pesos", () => {
    render(<PaymentsTable {...props} />);
    expect(screen.getByText("₱2,850")).toBeInTheDocument();
    expect(screen.getByText("₱142.50")).toBeInTheDocument();
    expect(screen.getByText("₱2,707.50")).toBeInTheDocument();
  });

  it("offers status and method filters", () => {
    render(<PaymentsTable {...props} />);
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    expect(screen.getByLabelText("Method")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter web test app/\(admin\)/payments`
Expected: FAIL — cannot resolve `./payments-table`.

- [ ] **Step 4: Implement**

`apps/web/app/(admin)/payments/payments-table.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, type FilterDef } from "@/components/data-table";
import { PaymentStatusBadge } from "@/components/StatusBadge";
import type { PaymentRow } from "@/lib/queries/payments";
import type { SortState } from "@/lib/table-params";

/** Centavos to pesos. Shows decimals only when they are non-zero, so a clean
 *  fee reads ₱2,850 while a real one reads ₱142.50. */
function peso(centavos: number): string {
  const value = centavos / 100;
  return `₱${value.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

const FILTERS: FilterDef[] = [
  {
    key: "status", label: "Status",
    options: [
      { value: "paid", label: "Paid" },
      { value: "pending", label: "Pending" },
      { value: "refunded", label: "Refunded" },
      { value: "failed", label: "Failed" },
    ],
  },
  {
    key: "method", label: "Method",
    options: [
      { value: "gcash", label: "GCash" },
      { value: "card", label: "Card" },
      { value: "paymaya", label: "Maya" },
    ],
  },
];

export function PaymentsTable({ rows, total, page, per, sort, activeFilters, q }: {
  rows: PaymentRow[]; total: number; page: number; per: number;
  sort: SortState[]; activeFilters: Record<string, string>; q: string;
}) {
  const columns = useMemo<ColumnDef<PaymentRow, unknown>[]>(() => [
    {
      accessorKey: "full_name",
      header: "Runner",
      cell: ({ row }) => (
        <div>
          <div className="font-semibold">{row.original.full_name ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{row.original.event_name ?? "—"}</div>
        </div>
      ),
    },
    { accessorKey: "amount", header: "Gross", cell: ({ row }) => <span className="font-mono tabular">{peso(row.original.amount)}</span> },
    { accessorKey: "platform_fee", header: "Fee", cell: ({ row }) => <span className="font-mono tabular text-muted-foreground">{peso(row.original.platform_fee)}</span> },
    { accessorKey: "net_to_org", header: "Net", cell: ({ row }) => <span className="font-mono tabular font-semibold">{peso(row.original.net_to_org)}</span> },
    { accessorKey: "method", header: "Method", cell: ({ row }) => <span className="capitalize text-muted-foreground">{row.original.method ?? "—"}</span> },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <PaymentStatusBadge status={row.original.status} /> },
    { accessorKey: "created_at", header: "Date", cell: ({ row }) => <span className="font-mono tabular text-muted-foreground">{fmtDate(row.original.created_at)}</span> },
  ], []);

  return (
    <DataTable
      columns={columns} data={rows} total={total} page={page} per={per} sort={sort}
      filterDefs={FILTERS} activeFilters={activeFilters} q={q}
      searchPlaceholder="Search runner or event…"
      emptyState={{ title: "No payments match", description: "Try a different search or clear your filters." }}
    />
  );
}
```

`apps/web/app/(admin)/payments/page.tsx`:

```tsx
import { parseTableParams } from "@/lib/table-params";
import { getMyRoles } from "@/lib/queries/roles";
import { listOrgPayments } from "@/lib/queries/payments";
import { PaymentsTable } from "./payments-table";

const DEFAULTS = { sort: [{ id: "created_at", desc: true }], filters: { status: "all", method: "all" } };

export default async function PaymentsPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = parseTableParams(await searchParams, DEFAULTS);
  const roles = await getMyRoles();
  const { rows, total } = await listOrgPayments(roles!.orgId!, params);

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight">Payments</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          <span className="font-mono tabular">{total}</span> transaction{total === 1 ? "" : "s"}
        </p>
      </div>
      <PaymentsTable rows={rows} total={total} page={params.page} per={params.per}
        sort={params.sort} activeFilters={params.filters} q={params.q} />
    </div>
  );
}
```

`apps/web/app/(admin)/payments/loading.tsx` — as in Task 7 Step 5 but `columns={7}`.

- [ ] **Step 5: Port RefundModal**

In `apps/web/components/RefundModal.tsx`: add `"use client";`, replace the `refundRegistration` import with `refundRegistrationAction` from `@/lib/actions/registrations`, and drop any `onRefunded` refetch since `revalidatePath` handles it.

- [ ] **Step 6: Run tests, delete, commit**

Run: `pnpm --filter web test app/\(admin\)/payments`
Expected: PASS, 2 tests.

```bash
git rm apps/web/routes/Payments.tsx apps/web/__tests__/payments.test.tsx
git add -A apps/web
git commit -m "feat(web): server-rendered Payments page with status and method filters"
```

---

## Task 9: Team page

**Files:**
- Create: `apps/web/lib/queries/team.ts`, `apps/web/lib/actions/team.ts`, `apps/web/app/(admin)/team/page.tsx`, `team-table.tsx`, `loading.tsx`
- Modify: `apps/web/components/InviteMemberForm.tsx` (`"use client"`, Server Action)
- Modify: `apps/web/__tests__/invite-member-form.test.tsx` → move to `apps/web/components/invite-member-form.test.tsx`
- Delete: `apps/web/routes/Team.tsx`, `apps/web/lib/team.ts`, `apps/web/__tests__/team-hooks.test.tsx`, `apps/web/__tests__/team-page.test.tsx`

**Interfaces:**
- Consumes: `parseTableParams`, `DataTable`, `getMyRoles`.
- Produces:
  - `lib/queries/team.ts` → `type TeamMember = { user_id: string; email: string | null; full_name: string | null; role: string; created_at: string; status: "active" | "invited" }` and `async listTeam(orgId: string, params: TableParams): Promise<{ rows: TeamMember[]; total: number }>`
  - `lib/actions/team.ts` → `async inviteMemberAction(prev: TeamState, formData: FormData): Promise<TeamState>`, `async changeRoleAction(userId: string, orgId: string, role: string): Promise<{ ok: boolean; error?: string }>`, `async removeMemberAction(userId: string, orgId: string): Promise<{ ok: boolean; error?: string }>`, where `type TeamState = { error?: string; success?: string }`

- [ ] **Step 1: Read the existing team module before writing anything**

Run: `git show HEAD:apps/web/src/lib/team.ts`

The existing hooks define the exact table names, role values, and invite RPC this task must reuse. Port the query bodies verbatim into `lib/queries/team.ts` and `lib/actions/team.ts`, changing only: `useQuery(...)` wrappers become plain `async` functions; `supabase` from the module singleton becomes `await createClient()` from `@/lib/supabase/server`; each mutation ends with `revalidatePath("/team")`.

Do not invent table or column names — use exactly what that file uses.

- [ ] **Step 2: Write the failing test**

`apps/web/app/(admin)/team/team-table.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TeamTable } from "./team-table";
import type { TeamMember } from "@/lib/queries/team";

vi.mock("@/lib/use-table-params", () => ({
  useTableParams: () => ({
    isPending: false, patch: vi.fn(), setPage: vi.fn(), setPer: vi.fn(),
    setSort: vi.fn(), setFilter: vi.fn(), setQ: vi.fn(), clearFilters: vi.fn(),
  }),
}));

const rows: TeamMember[] = [
  { user_id: "u1", email: "admin@racepace.test", full_name: "Ada Admin", role: "admin", created_at: "2026-07-01T00:00:00Z", status: "active" },
  { user_id: "u2", email: "marshal@racepace.test", full_name: null, role: "marshal", created_at: "2026-07-20T00:00:00Z", status: "invited" },
];

const props = { rows, total: 2, page: 1, per: 25, sort: [], activeFilters: {}, q: "", canManage: true, orgId: "a1" };

describe("TeamTable", () => {
  it("lists members with their roles", () => {
    render(<TeamTable {...props} />);
    expect(screen.getByText("Ada Admin")).toBeInTheDocument();
    expect(screen.getByText("admin@racepace.test")).toBeInTheDocument();
  });

  it("marks a pending invite", () => {
    render(<TeamTable {...props} />);
    expect(screen.getByText("Invited")).toBeInTheDocument();
  });

  it("hides role controls when the viewer cannot manage the team", () => {
    render(<TeamTable {...props} canManage={false} />);
    expect(screen.queryByLabelText(/change role/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter web test app/\(admin\)/team`
Expected: FAIL — cannot resolve `./team-table`.

- [ ] **Step 4: Implement**

`apps/web/app/(admin)/team/team-table.tsx`:

```tsx
"use client";

import { useMemo, useTransition } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, type FilterDef } from "@/components/data-table";
import { changeRoleAction } from "@/lib/actions/team";
import type { TeamMember } from "@/lib/queries/team";
import type { SortState } from "@/lib/table-params";

const ROLES = ["admin", "editor", "marshal"] as const;

const ROLE_FILTER: FilterDef = {
  key: "role", label: "Role",
  options: ROLES.map((r) => ({ value: r, label: r.charAt(0).toUpperCase() + r.slice(1) })),
};

function initials(member: TeamMember): string {
  const source = member.full_name ?? member.email ?? "??";
  return source.slice(0, 2).toUpperCase();
}

export function TeamTable({ rows, total, page, per, sort, activeFilters, q, canManage, orgId }: {
  rows: TeamMember[]; total: number; page: number; per: number;
  sort: SortState[]; activeFilters: Record<string, string>; q: string;
  canManage: boolean; orgId: string;
}) {
  const [, startTransition] = useTransition();

  const columns = useMemo<ColumnDef<TeamMember, unknown>[]>(() => [
    {
      accessorKey: "full_name",
      header: "Member",
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8"><AvatarFallback className="text-[11px]">{initials(row.original)}</AvatarFallback></Avatar>
          <div>
            <div className="font-semibold">{row.original.full_name ?? "—"}</div>
            <div className="text-xs text-muted-foreground">{row.original.email ?? "—"}</div>
          </div>
        </div>
      ),
    },
    {
      accessorKey: "role",
      header: "Role",
      cell: ({ row }) =>
        canManage ? (
          <Select
            defaultValue={row.original.role}
            onValueChange={(role) =>
              startTransition(async () => {
                const res = await changeRoleAction(row.original.user_id, orgId, role);
                if (res.ok) toast.success("Role updated");
                else toast.error(res.error ?? "Couldn't update that role.");
              })
            }
          >
            <SelectTrigger aria-label={`Change role for ${row.original.full_name ?? row.original.email}`}
              className="h-8 w-[130px] rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="capitalize">{row.original.role}</span>
        ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) =>
        row.original.status === "invited"
          ? <Badge variant="secondary">Invited</Badge>
          : <Badge variant="outline">Active</Badge>,
    },
  ], [canManage, orgId, startTransition]);

  return (
    <DataTable
      columns={columns} data={rows} total={total} page={page} per={per} sort={sort}
      filterDefs={[ROLE_FILTER]} activeFilters={activeFilters} q={q}
      searchPlaceholder="Search name or email…"
      emptyState={{ title: "No team members", description: "Invite an organizer to help run your events." }}
    />
  );
}
```

`apps/web/app/(admin)/team/page.tsx`:

```tsx
import { parseTableParams } from "@/lib/table-params";
import { getMyRoles } from "@/lib/queries/roles";
import { listTeam } from "@/lib/queries/team";
import { InviteMemberForm } from "@/components/InviteMemberForm";
import { TeamTable } from "./team-table";

const DEFAULTS = { sort: [{ id: "created_at", desc: false }], filters: { role: "all" } };

export default async function TeamPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = parseTableParams(await searchParams, DEFAULTS);
  const roles = await getMyRoles();
  const orgId = roles!.orgId!;
  const { rows, total } = await listTeam(orgId, params);

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-5 flex flex-wrap items-start gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Team</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            <span className="font-mono tabular">{total}</span> member{total === 1 ? "" : "s"}
          </p>
        </div>
        {roles!.isOrgAdmin ? <div className="ml-auto"><InviteMemberForm orgId={orgId} /></div> : null}
      </div>

      <TeamTable rows={rows} total={total} page={params.page} per={params.per}
        sort={params.sort} activeFilters={params.filters} q={params.q}
        canManage={roles!.isOrgAdmin} orgId={orgId} />
    </div>
  );
}
```

`apps/web/app/(admin)/team/loading.tsx` — as in Task 7 Step 5 but `columns={3}`.

- [ ] **Step 5: Run tests, delete, commit**

Run: `pnpm --filter web test app/\(admin\)/team components/invite-member-form.test.tsx`
Expected: PASS.

```bash
git rm apps/web/routes/Team.tsx apps/web/lib/team.ts \
  apps/web/__tests__/team-hooks.test.tsx apps/web/__tests__/team-page.test.tsx
git add -A apps/web
git commit -m "feat(web): server-rendered Team page with role management"
```

---

## Task 10: Settings page

**Files:**
- Create: `apps/web/lib/queries/org.ts`, `apps/web/lib/actions/settings.ts`, `apps/web/app/(admin)/settings/page.tsx`, `settings-form.tsx`
- Modify: `apps/web/components/CropUploader.tsx` (`"use client"`), `apps/web/lib/org.ts` → split browser upload helpers into `lib/org-upload.ts` with `"use client"` callers
- Move: `apps/web/__tests__/settings-branding.test.tsx` → `apps/web/app/(admin)/settings/settings-form.test.tsx`
- Delete: `apps/web/routes/Settings.tsx`

**Interfaces:**
- Consumes: `getMyRoles`.
- Produces:
  - `lib/queries/org.ts` → `type OrgBranding = { id: string; name: string; logo_url: string | null; banner_url: string | null }` and `async getOrg(orgId: string): Promise<OrgBranding>`
  - `lib/actions/settings.ts` → `async updateOrgBrandingAction(orgId: string, patch: { logo_url?: string; banner_url?: string }): Promise<{ ok: boolean; error?: string }>` and `async updateOrgNameAction(prev: SettingsState, formData: FormData): Promise<SettingsState>`, where `type SettingsState = { error?: string; success?: string }`
  - `lib/org-upload.ts` → `async uploadOrgImage(orgId: string, blob: Blob, kind: "avatar" | "cover"): Promise<string>` (browser-only; uses the browser client because it streams a Blob from a canvas crop)

- [ ] **Step 1: Split the org module**

Move `uploadOrgImage` from the current `lib/org.ts` into a new `apps/web/lib/org-upload.ts` verbatim, changing only the import from the removed `./supabase` singleton to `createClient()` from `@/lib/supabase/client`, called at the top of the function. This stays client-side: it uploads a Blob produced by the canvas crop, which cannot cross the Server Action boundary efficiently.

Move `useMyOrg`'s query body into `lib/queries/org.ts` as a plain `async getOrg(orgId)`, and `updateOrgBranding` into `lib/actions/settings.ts` as a `"use server"` action ending in `revalidatePath("/settings")`.

Then `git rm apps/web/lib/org.ts`.

**Known gotcha:** the hosted `organizations` table has previously had table-level UPDATE grant drift that RLS policy review alone did not catch. If `updateOrgBrandingAction` fails with a permissions error against hosted, scope-check with `has_column_privilege` before assuming the RLS policy is wrong.

- [ ] **Step 2: Write the page**

`apps/web/app/(admin)/settings/page.tsx`:

```tsx
import { getMyRoles } from "@/lib/queries/roles";
import { getOrg } from "@/lib/queries/org";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const roles = await getMyRoles();
  const org = await getOrg(roles!.orgId!);

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Your organization&apos;s profile and branding.</p>
      </div>
      <SettingsForm org={org} canEdit={roles!.isOrgAdmin} />
    </div>
  );
}
```

`settings-form.tsx` is a `"use client"` component wrapping the existing `CropUploader` for logo and banner, plus a name field posting to `updateOrgNameAction` via `useActionState`. Lay it out as two `Card`s — "Profile" (name) and "Branding" (logo + cover) — each `rounded-xl` per Direction A.

- [ ] **Step 3: Port and run the branding test**

```bash
git mv apps/web/__tests__/settings-branding.test.tsx apps/web/app/\(admin\)/settings/settings-form.test.tsx
```

Update its imports to `./settings-form` and mock `@/lib/actions/settings`.

Run: `pnpm --filter web test app/\(admin\)/settings`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git rm apps/web/routes/Settings.tsx
git add -A apps/web
git commit -m "feat(web): server-rendered Settings with org profile and branding"
```

---

## Task 11: Event editor

The largest single page. The heavy editors stay client islands; only data loading and saving move to the server.

**Files:**
- Create: `apps/web/lib/queries/event-editor.ts`, `apps/web/lib/actions/events.ts`
- Create: `apps/web/app/(admin)/events/new/page.tsx`, `apps/web/app/(admin)/events/[id]/edit/page.tsx`, `apps/web/app/(admin)/events/event-editor-form.tsx`
- Modify: every component under `apps/web/components/` used by the editor — add `"use client";` to `CategoryEditor`, `ScheduleEditor`, `InclusionsEditor`, `AddonEditor`, `EventImagesEditor`, `RouteEditor`, `CourseDrawEditor`, `PsgcAddressField`, `CropUploader`, `CancelModal`, `RescheduleModal`
- Move: `__tests__/{category-editor,event-editor,event-images-editor,psgc-address-field,psgc-hooks,events-address,events-actions}.test.tsx` → alongside their components
- Delete: `apps/web/routes/EventEditor.tsx`, `apps/web/lib/events.ts`, `apps/web/lib/eventWrites.ts`

**Interfaces:**
- Consumes: `getMyRoles`.
- Produces:
  - `lib/queries/event-editor.ts` → `type EditorEvent`, `type EditorCategory`, `type EditorAddon`, `type EditorData` (all unchanged from the current `lib/events.ts`) and `async getEventForEditor(id: string): Promise<EditorData | null>`
  - `lib/actions/events.ts` → `async saveEventAction(prev: EditorState, formData: FormData): Promise<EditorState>`, `async cancelEventAction(id: string, reason: string)`, `async rescheduleEventAction(id: string, newDate: string)`, where `type EditorState = { error?: string; eventId?: string }`

- [ ] **Step 1: Read the existing write module first**

Run: `git show HEAD:apps/web/src/lib/eventWrites.ts`

It contains the exact insert/update shapes, the categories/addons diffing, and the PSGC field mapping. Port those bodies verbatim into `lib/actions/events.ts`, changing only the client (`await createClient()` from `@/lib/supabase/server`) and adding `revalidatePath("/events")` plus `revalidatePath(\`/events/${id}/edit\`)` at the end of each. Do not redesign the write shape in this task.

- [ ] **Step 2: Write the loader**

`apps/web/lib/queries/event-editor.ts` — port `useEventForEditor`'s query body verbatim from `git show HEAD:apps/web/src/lib/events.ts`, dropping the `useQuery` wrapper:

```ts
import { createClient } from "@/lib/supabase/server";
import type { EventDiscipline, RoutePoint } from "@race-pace/shared";
import type { ScheduleItem } from "@/lib/validation";

export type EditorEvent = {
  id: string; org_id: string; name: string;
  city_psgc_code: string | null; region_name: string | null; province_name: string | null;
  city_name: string | null; venue: string | null;
  event_date: string | null; end_date: string | null; flag_off: string | null;
  status: string; discipline: EventDiscipline;
  elevation_gain_m: number | null; cutoff_hours: number | null; description: string | null;
  start_lat: number | null; start_lng: number | null; finish_lat: number | null; finish_lng: number | null;
  route: RoutePoint[] | null;
  hero_image_url: string | null; gallery: string[]; schedule: ScheduleItem[]; inclusions: string[];
};
export type EditorCategory = {
  id: string; code: string; label: string; distance_km: number | null; base_price: number;
  slots_total: number; slots_taken: number; elevation_gain_m: number | null;
  cutoff_hours: number | null; blurb: string | null;
};
export type EditorAddon = { id: string; name: string; price: number };
export type EditorData = { event: EditorEvent; categories: EditorCategory[]; addons: EditorAddon[] };

const EVENT_SELECT =
  "id,org_id,name,city_psgc_code,region_name,province_name,city_name,venue,event_date,end_date,flag_off,status,discipline,elevation_gain_m,cutoff_hours,start_lat,start_lng,finish_lat,finish_lng,route,description,hero_image_url,gallery,schedule,inclusions";

export async function getEventForEditor(id: string): Promise<EditorData | null> {
  const supabase = await createClient();

  const ev = await supabase.from("events").select(EVENT_SELECT).eq("id", id).single();
  if (ev.error) {
    // PGRST116 is "no rows" from .single() — a genuine 404, not a failure.
    if (ev.error.code === "PGRST116") return null;
    throw ev.error;
  }

  const [cats, adds] = await Promise.all([
    supabase.from("categories")
      .select("id,code,label,distance_km,base_price,slots_total,slots_taken,elevation_gain_m,cutoff_hours,blurb")
      .eq("event_id", id).order("base_price", { ascending: false }),
    supabase.from("addons").select("id,name,price").eq("event_id", id).order("created_at"),
  ]);
  if (cats.error) throw cats.error;
  if (adds.error) throw adds.error;

  return {
    event: ev.data as EditorEvent,
    categories: (cats.data ?? []) as EditorCategory[],
    addons: (adds.data ?? []) as EditorAddon[],
  };
}
```

- [ ] **Step 3: Write the two pages**

`apps/web/app/(admin)/events/[id]/edit/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getEventForEditor } from "@/lib/queries/event-editor";
import { EventEditorForm } from "../../event-editor-form";

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  // params is a Promise in Next 15 and must be awaited.
  const { id } = await params;
  const data = await getEventForEditor(id);
  if (!data) notFound();

  return <EventEditorForm initial={data} />;
}
```

`apps/web/app/(admin)/events/new/page.tsx`:

```tsx
import { EventEditorForm } from "../event-editor-form";

export default function NewEventPage() {
  return <EventEditorForm initial={null} />;
}
```

- [ ] **Step 4: Port the editor form**

`event-editor-form.tsx` is a `"use client"` component. Take the entire body of `git show HEAD:apps/web/src/routes/EventEditor.tsx` and change exactly these things:

1. `"use client";` as the first line.
2. Delete the `useEventForEditor` call; the data arrives as the `initial` prop (`EditorData | null`).
3. Replace `useNavigate()` with `useRouter()` from `next/navigation`; `navigate("/events")` becomes `router.push("/events")`.
4. Replace `useParams()` from react-router with the `initial?.event.id` already in props.
5. Replace the `saveEvent` import from `lib/eventWrites` with `saveEventAction` from `@/lib/actions/events`, called inside `startTransition`.
6. Keep every child editor component exactly as-is.

Keep the existing section layout, but wrap each section in a `Card` with `rounded-xl` and a `CardHeader` title, per Direction A.

- [ ] **Step 5: Add "use client" to the editor islands**

For each of `CategoryEditor.tsx`, `ScheduleEditor.tsx`, `InclusionsEditor.tsx`, `AddonEditor.tsx`, `EventImagesEditor.tsx`, `RouteEditor.tsx`, `CourseDrawEditor.tsx`, `PsgcAddressField.tsx`, `CropUploader.tsx`, `CancelModal.tsx`, `RescheduleModal.tsx`, `RefundModal.tsx`, `RegistrationDetail.tsx`, `InviteMemberForm.tsx`, `StatusBadge.tsx`, `ThemeToggle.tsx`, `TopBar.tsx`: add `"use client";` as the first line if not already present.

`CourseDrawEditor.tsx` and `RouteEditor.tsx` use maplibre-gl, which touches `window` at import time. Import them with `next/dynamic` and `ssr: false` from `event-editor-form.tsx`:

```tsx
import dynamic from "next/dynamic";

// maplibre-gl reads `window` at module scope and throws during SSR.
const CourseDrawEditor = dynamic(
  () => import("@/components/CourseDrawEditor").then((m) => m.CourseDrawEditor),
  { ssr: false, loading: () => <div className="h-[420px] animate-pulse rounded-xl bg-muted" /> },
);
```

`PsgcAddressField` keeps react-query. Wrap it in a local `QueryClientProvider` inside `event-editor-form.tsx` rather than restoring a global one:

```tsx
"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
// …inside the component:
const [qc] = useState(() => new QueryClient());
// …wrapping only the address section:
<QueryClientProvider client={qc}><PsgcAddressField … /></QueryClientProvider>
```

- [ ] **Step 6: Move and run the editor tests**

```bash
cd apps/web
git mv __tests__/category-editor.test.tsx components/category-editor.test.tsx
git mv __tests__/event-images-editor.test.tsx components/event-images-editor.test.tsx
git mv __tests__/psgc-address-field.test.tsx components/psgc-address-field.test.tsx
git mv __tests__/psgc-hooks.test.tsx lib/psgc.test.ts
git mv __tests__/event-editor.test.tsx "app/(admin)/events/event-editor-form.test.tsx"
git mv __tests__/events-address.test.tsx "app/(admin)/events/events-address.test.tsx"
git mv __tests__/events-actions.test.tsx "app/(admin)/events/events-actions.test.tsx"
```

Update each file's imports to the new paths, and mock `@/lib/actions/events` where they previously mocked `lib/eventWrites`.

Run: `pnpm --filter web test`
Expected: PASS across the whole suite.

- [ ] **Step 7: Clean up and commit**

```bash
git rm apps/web/routes/EventEditor.tsx apps/web/lib/events.ts apps/web/lib/eventWrites.ts
rmdir apps/web/routes apps/web/__tests__ 2>/dev/null || true
```

Run: `pnpm --filter web typecheck`
Expected: PASS with zero errors. No `react-router-dom` or `import.meta.env` reference may remain:

```bash
grep -rn "react-router-dom\|import.meta.env" apps/web --include="*.ts" --include="*.tsx"
```

Expected: no output.

```bash
git add -A apps/web
git commit -m "feat(web): server-loaded event editor with Server Action saves

Completes the react-router removal. maplibre editors load via next/dynamic
with ssr:false because maplibre-gl reads window at module scope."
```

---

## Task 12: Test config, E2E, and infrastructure

**Files:**
- Create: `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `apps/web/e2e/auth.spec.ts`, `apps/web/e2e/registrations.spec.ts`
- Modify: `apps/web/package.json` (add `test:e2e`), `docker-compose.yml`, `apps/web/README.md`

**Interfaces:**
- Consumes: every page from Tasks 4–11.
- Produces: `pnpm --filter web test:e2e`.

- [ ] **Step 1: Write the vitest config**

`apps/web/vitest.config.ts`:

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
    // e2e/ is Playwright's; running it under vitest hangs on a missing browser.
    exclude: ["node_modules", "e2e", ".next"],
  },
});
```

`vitest.setup.ts` already exists at `apps/web/vitest.setup.ts` and needs no changes — its MemoryStorage and ResizeObserver stubs are still required.

- [ ] **Step 2: Write the Playwright config and specs**

Install: `pnpm --filter web add -D @playwright/test && pnpm --filter web exec playwright install chromium`

`apps/web/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: { baseURL: "http://localhost:3001", trace: "on-first-retry" },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3001/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

`apps/web/e2e/auth.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

const ADMIN = { email: "admin@racepace.test", password: "password123" };

test("anonymous request to a protected page redirects to login", async ({ page }) => {
  await page.goto("/registrations");
  await expect(page).toHaveURL(/\/login\?next=%2Fregistrations/);
});

test("signing in returns to the originally requested page", async ({ page }) => {
  await page.goto("/events?status=published");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/events\?status=published/);
  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible();
});

test("a wrong password shows an error and does not navigate", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("don't match");
  await expect(page).toHaveURL(/\/login/);
});
```

`apps/web/e2e/registrations.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@racepace.test");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/events/);
});

test("a filter survives a hard reload and the back button restores the prior view", async ({ page }) => {
  await page.goto("/registrations");
  const unfiltered = await page.getByRole("status").textContent();

  await page.getByRole("button", { name: "Status" }).click();
  await page.getByRole("option", { name: "Paid" }).click();
  await expect(page).toHaveURL(/status=paid/);
  const filtered = await page.getByRole("status").textContent();
  expect(filtered).not.toBe(unfiltered);

  await page.reload();
  await expect(page).toHaveURL(/status=paid/);
  await expect(page.getByRole("status")).toHaveText(filtered!);

  await page.goBack();
  await expect(page.getByRole("status")).toHaveText(unfiltered!);
});

test("changing page size updates the range label", async ({ page }) => {
  await page.goto("/registrations");
  await page.getByLabel("Rows per page").click();
  await page.getByRole("option", { name: "50" }).click();
  await expect(page).toHaveURL(/per=50/);
  await expect(page.getByText(/of \d+$/)).toBeVisible();
});

test("a removable chip clears its filter", async ({ page }) => {
  await page.goto("/registrations?status=paid");
  await page.getByLabel("Remove Status filter").click();
  await expect(page).not.toHaveURL(/status=paid/);
});
```

Add to `apps/web/package.json` scripts: `"test:e2e": "playwright test"`.

- [ ] **Step 3: Update docker-compose**

In `docker-compose.yml`, in the `web` service, change the `command` to:

```yaml
    command: sh -c "corepack enable && corepack prepare pnpm@9.7.0 --activate && pnpm install --frozen-lockfile=false && pnpm --filter web exec next dev -p 3001 -H 0.0.0.0"
```

Invoking the `next` binary directly matters for the same reason documented on the `site` service: `pnpm --filter web dev -- …` forwards `--` as a literal argv entry, which Next reads as a project directory.

Change the loadbalancer port label from `5173` to `3001`:

```yaml
      - "traefik.http.services.racepace-admin-${STACK_ID:-fff722}.loadbalancer.server.port=3001"
```

Add the env block so the container gets the `.lan` origin (Next gives real env vars precedence over `.env.local`):

```yaml
    environment:
      NEXT_PUBLIC_SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL}
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}
```

Leave every `STACK_ID` and `priority` label untouched — they exist to stop cross-worktree Traefik round-robining and are unrelated to this change.

- [ ] **Step 4: Verify the whole stack**

```bash
docker compose up -d web
```

Visit `https://admin.racepace.lan`. Expected: login, then `/events`.

If you see alternating 404s on a repeated request, a second worktree's stack is up and Traefik is round-robining the shared host — bring the other one down or set `STACK_ID` on one of them.

```bash
pnpm --filter web typecheck && pnpm --filter web test && pnpm --filter web build && pnpm --filter web test:e2e
```

Expected: all four PASS.

- [ ] **Step 5: Update the README and commit**

In `apps/web/README.md`, replace any Vite/port-5173 instructions with `pnpm --filter web dev` on port 3001, document the `NEXT_PUBLIC_*` env vars, and note that `pnpm --filter web test:e2e` needs a seeded local Supabase.

```bash
git add -A apps/web docker-compose.yml
git commit -m "test(web): Playwright E2E for auth and table state; retarget Docker to 3001

Covers the SSR paths RTL cannot: the middleware redirect, filter state
surviving a reload, back-button restore, and page-size changes."
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §2 Direction A visual spec | 1 (tokens/fonts), 5 (table), 6–11 (pages) |
| §3 Typography (Inter + JetBrains Mono, `.tabular`) | 1 |
| §4.1 Directory structure | 1, 3, 4 |
| §4.2 Auth two layers | 3 (middleware), 4 (layout guard) |
| §4.3 Reads/writes/React Query/env vars | 3, 6–11 |
| §4.4 searchParams contract incl. `per` | 2, 5 |
| §5 Table system (toolbar, chips, bulk, footer, a11y, responsive) | 5 |
| §6 Docker, vercel.json, deleted files, deps | 1 (vercel.json, deps), 12 (Docker) |
| §7 Testing split | 2, 5–11 (vitest), 12 (Playwright) |
| §8 PR1 page inventory | 3 (login/no-access), 4 (shell + stubs), 6–11 |
| §9 Risk: grant drift | 10 Step 1 |
| §9 Risk: two dev servers | 12 Steps 3–4 |

Two spec items are deliberately deferred with a note rather than silently dropped: the **⌘K command palette** listed in §8's app shell row, and the **mobile "Filters" sheet** in §5's responsive line. Both are additive to a working page and neither is load-bearing for PR1's SSR conversion; they are tracked as follow-ups on the PR rather than blocking it. Everything else in §8's PR1 inventory has a task.

**Placeholder scan:** No `TBD`, `TODO`, "handle edge cases", or "similar to Task N" references remain. One action-name typo in Task 8 Step 5 was corrected to `refundRegistrationAction`, matching Task 7's Interfaces block.

Tasks 9, 10 and 11 direct the implementer to `git show HEAD:<path>` and port existing query bodies verbatim rather than reproducing several hundred lines of unchanged Supabase calls inline. This is intentional: those bodies contain the authoritative table and column names, and retyping them into the plan risks introducing a name that does not exist. Each such step names the exact source file and states precisely which lines change.

**Type consistency:** `SortState`, `TableParams`, `TableDefaults`, `FilterDef`, `BulkAction`, `MyRoles`, `RegistrationRow`, `PaymentRow`, `AdminEventRow`, `EditorData` are each defined once and referenced with the same shape throughout. `quotePostgrestValue` is defined in Task 6's `lib/queries/events.ts` and imported by Tasks 7 and 8. `createClient` is deliberately the same name in all three Supabase modules, distinguished by import path, matching `apps/site`.
