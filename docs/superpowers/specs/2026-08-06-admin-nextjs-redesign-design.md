# Admin console: Next.js conversion + Direction A redesign

**Date:** 2026-08-06
**Status:** Approved, ready for planning
**Scope:** `apps/web` — convert from Vite/React Router SPA to Next.js 15 App Router with SSR, and redesign every page on a shared shadcn/ui design system.

---

## 1. Motivation

`apps/web` is a client-only SPA: browser `supabase-js`, React Query, and a `RequireAdmin` component that renders "Loading…" twice before any page paints. Filters and pagination live in the URL but are re-fetched client-side on every navigation. Five of the nine routes are empty `Placeholder` stubs.

`apps/site` is already Next.js 15 App Router with `@supabase/ssr`, so the conversion follows a proven in-repo pattern rather than inventing one.

Goals, in priority order:

1. Kill the auth flash and the client-side role round-trip on every navigation.
2. Make every list view server-rendered from `searchParams`, so a filtered view is a shareable link and back/forward restores state.
3. Ship one table system that every list page consumes, with search, faceted filters, sorting, bulk actions, rows-per-page, range label, and numbered pagination.
4. Build the five stub routes for real.

Non-goals: changing the database schema except where PR3 explicitly requires it; touching `apps/mobile` or `apps/site`; changing RLS policies.

---

## 2. Design direction: A — Refined Console

Chosen from three mocked alternatives. A is a calm, Apple-flavored evolution of the current admin: white sidebar, 14–16px radii, ~44px table rows, single-layer soft shadows. It is the closest visual sibling to the mobile app and the public site, and reuses the existing token contract unchanged.

Rejected: **B (Dense Ops Deck)** — ~2× rows per screen, dark forest rail, but reads as an internal tool and diverges from brand. **C (Bento Command Center)** — inline detail pane and bento dashboard, but the most custom UI to build and maintain.

Direction B's density is achievable later as a user-toggleable "Comfortable / Compact" preference, because it differs from A only in spacing tokens over identical components. That is explicitly out of scope here but the token structure must not preclude it.

### Visual specification

| Property | Value |
|---|---|
| Canvas | `--muted` (`#F5F5F7` light / `#141916` dark) |
| Surfaces | `--card` on `--border`, `--shadow: 0 1px 2px rgb(16 24 40/.04), 0 1px 3px rgb(16 24 40/.06)` |
| Card radius | `--radius-card` (16px) |
| Control radius | `--radius` (11px) |
| Table row height | 44px (`py-3` + 20px line box) |
| Sidebar | `--sidebar` white panel, `--sidebar-accent` (`#F1F7F4`) active row, `--sidebar-primary` icon |
| Accent | trail-green `#159A55` (`--primary`), unchanged |
| Status colors | existing `--paid` / `--info` / `--amber` / `--destructive` + their `-tint` pairs |

---

## 3. Typography

Self-hosted via `next/font/google` (no runtime request to Google, no FOIT):

- **Inter** — all UI text, weights 400/500/600/700. Replaces the `-apple-system` stack so Windows organizers stop getting Segoe UI.
- **JetBrains Mono** — figures only, weights 400/500/600.

Exposed as `--font-sans` / `--font-mono` CSS variables on `<html>`, wired into `@theme inline`. A `.tabular` utility applies `font-variant-numeric: tabular-nums`.

Money, bib numbers, timestamps, counts, and pagination ranges use `font-mono tabular` so column widths do not jitter between pages.

This is a deliberate, accepted brand shift away from the getdesign `apple` handover's system-font stack. `apps/mobile` and `apps/site` are **not** changed in this work; the divergence is known and accepted.

---

## 4. Architecture

### 4.1 Directory structure

`apps/web` converts in place — same package name `web`, same `admin.racepace.lan` host, same Vercel project.

```
apps/web/
  next.config.ts
  postcss.config.mjs            # @tailwindcss/postcss (Vite plugin removed)
  middleware.ts
  vitest.config.ts
  playwright.config.ts
  app/
    layout.tsx                  # fonts, ThemeProvider, Toaster, globals.css
    globals.css                 # moved from src/index.css, unchanged token contract
    (auth)/login/page.tsx
    (auth)/no-access/page.tsx
    (admin)/layout.tsx          # server role guard + AppShell
    (admin)/page.tsx            # redirect → /dashboard
    (admin)/dashboard/page.tsx
    (admin)/events/page.tsx
    (admin)/events/new/page.tsx
    (admin)/events/[id]/edit/page.tsx
    (admin)/registrations/page.tsx
    (admin)/payments/page.tsx
    (admin)/check-in/page.tsx
    (admin)/team/page.tsx
    (admin)/settings/page.tsx
    (admin)/organizations/page.tsx
    (admin)/commission/page.tsx
    (admin)/payouts/page.tsx
  components/                   # moved from src/components, unchanged import alias @/
  lib/
    supabase/{client,server,middleware}.ts
    table-params.ts             # pure parse/serialize, no React
    use-table-params.ts         # client writer hook
    actions/*.ts               # "use server" mutation modules
```

The `@/` path alias is preserved, so component-internal imports do not churn.

### 4.2 Auth and authorization

Two layers, deliberately redundant:

1. **`middleware.ts`** — copies `apps/site/lib/supabase/middleware.ts`. Refreshes the session cookie on every request and redirects unauthenticated requests under `(admin)` to `/login?next=<path>`. Matcher excludes `_next`, static assets, and `/login`.
2. **`(admin)/layout.tsx`** — an async server component that calls `supabase.auth.getUser()` (never `getSession()`, which does not verify the JWT) and then the existing role query. Redirects to `/no-access` when the user is not an org admin or super admin.

Middleware alone is not treated as an authorization boundary. RLS in Postgres remains the real enforcement; these two layers exist for UX and to avoid rendering a shell the user cannot use.

The resolved `{ isAdmin, isSuperAdmin, orgId }` is passed down as props from the layout, so no page re-queries roles.

### 4.3 Data flow

**Reads.** Every list page is an async server component. It receives `searchParams`, parses them with `lib/table-params.ts`, and issues one Supabase query with `.order()`, `.range()`, and `{ count: 'exact' }`. The count and rows come back in one round trip and render directly — no loading state, no waterfall.

Slow pages get `loading.tsx` with a skeleton table matching the real row height, so there is no layout shift when data arrives.

**Writes.** Server Actions in `lib/actions/*.ts`, each `"use server"`, each ending in `revalidatePath()` for the affected route. Client components call them through `useActionState` / form actions, showing pending state on the submitting button.

**React Query.** Removed from the dependency tree except where a genuinely interactive client widget needs request caching — currently PSGC address lookup (`lib/psgc.ts`) and map trail-snapping (`lib/snap.ts`). Those two keep a scoped `QueryClientProvider` inside their client boundary rather than a global one.

**Environment variables.** `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` become `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, matching `apps/site`. All `import.meta.env` references are replaced with `process.env`.

### 4.4 The searchParams contract

The existing wire format from `useTableParams` is preserved byte-for-byte so no bookmarked admin URL breaks:

| Param | Format | Default |
|---|---|---|
| `page` | 1-based integer, omitted when 1 | 1 |
| `sort` | `id:asc,other:desc` | per-page default |
| `q` | free text | empty |
| `per` | `10` \| `25` \| `50` \| `100` | 25 |
| *any other key* | filter `key=value`, omitted when "all" | per-page default |

`lib/table-params.ts` exports pure `parseTableParams(searchParams, defaults)` and `serializeTableParams(params)`. Both are unit-tested directly. The client hook `use-table-params.ts` wraps `useSearchParams` + `useRouter` and only writes; it never parses.

`per` is new — the current hook has no page-size param. Invalid or out-of-range values clamp to 25 rather than erroring.

Every mutation of `sort`, `q`, `per`, or any filter resets `page` to 1.

---

## 5. The table system

A single `<DataTable>` composition in `components/data-table/`, consumed by Events, Registrations, Payments, Team, Check-in, Organizations, and Payouts. Page-specific concerns arrive as props; the component is never forked.

Structure, top to bottom:

1. **Toolbar** — debounced search input (300ms), faceted filter dropdowns (shadcn `popover` + `command`, multi-select with counts), and a column-visibility dropdown.
2. **Active filter chips** — one removable chip per non-default filter, plus "Clear all". Hidden when no filters are active.
3. **Bulk action bar** — appears only when rows are selected. Shows "N selected", page-specific actions, and "Clear".
4. **Table** — sortable headers with `aria-sort`, 44px rows, hover highlight, optional row click.
5. **Footer** — rows-per-page `select`, `Showing 51–75 of 791` (mono tabular), numbered pagination with first/prev/next/last and ellipsis truncation.

States: `loading` renders skeleton rows; `empty` renders an illustrated empty state with a primary action; `error` renders an inline alert with retry.

Responsive: below 768px the table wraps in `overflow-x-auto`; the toolbar collapses filter dropdowns into a single "Filters" sheet.

Accessibility: `aria-sort` on sorted headers, `aria-label` on every icon-only control, visible focus rings, and a `role="status"` live region announcing the result count after filter changes.

---

## 6. Infrastructure changes

**`docker-compose.yml`** — the `web` service command changes from `pnpm --filter web dev --host 0.0.0.0` to `pnpm --filter web exec next dev -p 3001 -H 0.0.0.0`, invoking the Next binary directly for the same reason documented on the `site` service (pnpm forwards `--` as a literal argv entry). The Traefik label `traefik.http.services.racepace-admin-${STACK_ID}.loadbalancer.server.port` changes from `5173` to `3001`. Port 3000 is already taken by `site`.

The `STACK_ID` namespacing and router `priority` labels are left exactly as they are — they exist to stop cross-worktree Traefik round-robining and are unrelated to this change.

**`apps/web/vercel.json`** — the SPA rewrite `{"source": "/(.*)", "destination": "/index.html"}` is **deleted**. Left in place it shadows every Next route. The file is removed entirely; Vercel autodetects Next.

**Files deleted:** `index.html`, `vite.config.ts`, `src/main.tsx`, `src/App.tsx`.

**Dependencies:** remove `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `react-router-dom`. Add `next`, `@supabase/ssr`, `@tailwindcss/postcss`, `next-themes`, `recharts`, `@playwright/test`. Keep `@tanstack/react-query` as a dependency — the global provider is deleted, but the package is still needed by the two scoped client widgets in §4.3. Keep `@tanstack/react-table`, which `DataTable` is built on.

---

## 7. Testing

**Vitest + React Testing Library** — client islands only: `DataTable` and its sub-components, all editors (`CategoryEditor`, `ScheduleEditor`, `InclusionsEditor`, `AddonEditor`, `EventImagesEditor`, `RouteEditor`, `CourseDrawEditor`), forms, modals, `StatusBadge`, `ThemeToggle`, `CropUploader`, `PsgcAddressField`. Most of the 27 existing test files port with import-path changes only.

**Pure unit tests** — `lib/table-params.ts` parse/serialize round-trips, including clamping, defaults, and page reset.

**Playwright E2E** — against a real `next dev` server with a seeded local Supabase:

- unauthenticated request to `/registrations` redirects to `/login`
- non-admin user lands on `/no-access`
- admin sees the shell and the default page
- applying a filter updates the URL, the row count, and survives a hard reload
- changing rows-per-page and paginating produces the expected range label
- back/forward restores the previous filter state

Tests that exercised React Query cache behavior are deleted rather than ported; that behavior no longer exists.

---

## 8. Page inventory

### PR1 — Conversion + existing pages

| Page | Notes |
|---|---|
| Login | Server-rendered form, Server Action sign-in, `?next=` honored |
| No access | Static, with sign-out |
| App shell | Sidebar (collapsible, role-gated Platform group), topbar with breadcrumb + ⌘K command palette |
| Events | DataTable: search, status/date filters, sort by date. Row → editor |
| Event editor | Multi-section form; existing editors kept as client islands. Server Action save |
| Registrations | DataTable: search, event/status/category filters, bulk email + assign bibs + cancel |
| Payments | DataTable: search, status/method/date-range filters, refund modal |
| Team | DataTable: members + pending invites, role editing, invite form |
| Settings | Org profile, branding editor (existing `CropUploader` retained), theme |

### PR2 — Dashboard and Check-in

| Page | Notes |
|---|---|
| Dashboard | KPI tiles (total, paid, gross revenue, refunds), 30-day registrations area chart (recharts), recent registrations, upcoming events. Replaces `/` redirect target |
| Check-in | Event picker, search-by-bib/name, check-in toggle, live counts. Gates on `status = 'paid'` per the existing Plan 14 rule |

### PR3 — Platform pages

| Page | Notes |
|---|---|
| Organizations | Super-admin only. DataTable of orgs with event/registration counts |
| Commission | Requires the commission-rollup RPC (plan A3), which is not shipped. DB work is part of this PR |
| Payouts | No schema exists. Table design plus migration are both part of this PR |

---

## 9. Risks and open items

**Hosted schema drift.** Server-driven tables were written against a `db push` that has not landed on the current hosted project (`whaqarofxdlzxrelbcrq`). PR1 is specified against `supabase/migrations` and verified locally; hosted verification is blocked until that push happens. This is a known gate on PR1's go-live, not on its merge.

**Table-level grant drift.** When adding any new UPDATE path, scope-check with `has_column_privilege` — the hosted `organizations` table has previously had table-level grant drift that RLS policy review alone did not catch.

**Two dev servers.** `site` on 3000 and `web` on 3001 both run under Docker against the same Traefik. Both must be up for cross-app links to resolve on `.lan`.

**PR3 is backend work.** Commission and Payouts are not primarily UI tasks. If the RPC and schema design turn out to be larger than expected, PR3 should split again rather than absorb the delay.
