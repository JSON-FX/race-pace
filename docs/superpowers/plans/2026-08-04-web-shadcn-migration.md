# Admin Web shadcn/ui Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-platform every UI surface in `apps/web` onto shadcn/ui + Tailwind v4 while preserving the current getdesign handover look, and move Payments and Registrations onto server-driven tables backed by new Postgres views.

**Architecture:** Three tiers — untouched shadcn primitives in `src/components/ui/*`, domain components composing them in `src/components/*`, and one generic `DataTable` over TanStack Table serving all four list screens (server-driven for Payments/Registrations, client-side for Events/Team). Design tokens adopt the shadcn variable contract that `apps/mobile/global.css` already ships, giving light + dark for free.

**Tech Stack:** React 19, Vite 6, TypeScript, Tailwind CSS v4, shadcn/ui (new-york), Radix UI, TanStack Table v8, TanStack Query v5, react-hook-form + zod, lucide-react, sonner, Vitest + Testing Library, Supabase (PostgREST + RLS).

**Spec:** [`docs/superpowers/specs/2026-08-04-web-shadcn-migration-design.md`](../specs/2026-08-04-web-shadcn-migration-design.md)

## Global Constraints

- **Branch:** `worktree-web-shadcn-migration`. One branch, one PR. Every task ends with a commit that leaves `pnpm --filter web test` and `pnpm --filter web typecheck` green.
- **Preserve the design.** Light-mode output must read as the same design as today. Where a shadcn default differs from the handover, fix it in a token value or a CVA variant — **never** by editing a file in `src/components/ui/`.
- **`apps/mobile/global.css` is the source of truth for token values.** Copy values verbatim. Any change to a shared token touches both files in one commit.
- **Package manager is pnpm 9.7.0 in a workspace.** Install with `pnpm --filter web add <pkg>`. Node >= 20.
- **Do not modify** `supabase/functions/**`, `apps/mobile/**`, or any existing money-path logic (`saveEvent`, `refundRegistration`, `cancelEvent`, `rescheduleEvent`, the `org-members` and `admin-refund` invocations). These are presentation-only refactors.
- **Do not replace** the native `<input type="date">` / `type="time">` fields in `EventEditor`. Plan 12 chose them deliberately and `event-editor.test.tsx` asserts `.type === "date"`.
- **Test intent is preserved.** When a test's query strategy must change (native `<select>` → Radix), the assertion it makes must stay the same.
- **Supabase CLI is pinned to 2.109.1.** SQL against the hosted project runs via `pnpm exec supabase db query --linked` (no DB password needed); migrations push via `pnpm exec supabase db push --linked`.
- Existing test counts to protect: web **51/51**, backend **54/54**. Report real numbers from real runs; never assert a count from memory.

## Deviation from the spec

The spec names **two** views. This plan adds a **third**, `admin_event_reg_counts_v` (Task 4), because `useEventRegistrationCounts` (`apps/web/src/lib/registrations.ts:69`) currently selects *every* registration row in the org just to count them in JS — the same unbounded-fetch problem the other two views exist to solve, and five extra lines in the same migration. If this is unwanted, drop it from Task 4 and leave that hook as-is; nothing else in the plan depends on it.

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `apps/web/components.json` | shadcn CLI config (new-york, `@/` aliases, `src/index.css`) |
| `apps/web/src/index.css` | Tailwind v4 entry + the light/dark token contract |
| `apps/web/src/lib/utils.ts` | `cn()` — clsx + tailwind-merge |
| `apps/web/src/components/ui/*.tsx` | shadcn primitives, CLI-generated, never hand-edited |
| `apps/web/src/components/DataTable.tsx` | Generic table: client or server mode, owns loading/empty/error |
| `apps/web/src/components/ThemeToggle.tsx` | Light/dark switch, persists to `localStorage` |
| `apps/web/src/lib/theme.ts` | `applyTheme` / `readTheme` / `toggleTheme` |
| `apps/web/src/lib/useTableParams.ts` | Reads/writes page, sort, filters, search in the URL |
| `apps/web/src/components/StatusBadge.tsx` | Replaces `StatusChip` (Events) and `PaymentBadge` |
| `supabase/migrations/20260804120000_admin_list_views.sql` | The three security-invoker views |
| `supabase/tests/admin-list-views.test.ts` | RLS isolation for rows **and** counts |
| `apps/web/src/__tests__/data-table.test.tsx` | DataTable behavior |
| `apps/web/src/__tests__/theme-toggle.test.tsx` | Dark-mode toggle + persistence |
| `apps/web/src/__tests__/table-params.test.ts` | URL state round-trip |

**Deleted:** `apps/web/src/theme.css`, `apps/web/src/components/PaymentBadge.tsx`

**Modified:** every file in `apps/web/src/routes/` and `apps/web/src/components/`, plus `vite.config.ts`, `tsconfig.json`, `vitest.setup.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/lib/registrations.ts`, and the test files named per task.

---

### Task 1: Foundation — Tailwind v4, shadcn init, token contract

Installs the styling stack and the token contract with **no visible UI change**. The app still renders via inline styles at the end of this task; `theme.css` is replaced by `index.css`, which re-declares the legacy variables *temporarily* so nothing breaks before Task 11 removes them.

**Files:**
- Create: `apps/web/src/index.css`, `apps/web/src/lib/utils.ts`, `apps/web/components.json`
- Modify: `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/vitest.setup.ts`, `apps/web/src/main.tsx:6`, `apps/web/index.html`
- Delete: `apps/web/src/theme.css`

**Interfaces:**
- Consumes: nothing.
- Produces: `cn(...inputs: ClassValue[]): string` from `@/lib/utils`. The `@/*` alias resolving to `apps/web/src/*`. The full token set in §"Token contract" below, available as Tailwind utilities (`bg-background`, `text-muted-foreground`, `border-border`, `bg-sidebar-accent`, …).

- [ ] **Step 1: Install dependencies**

```bash
cd apps/web
pnpm add tailwindcss@^4 @tailwindcss/vite@^4 class-variance-authority clsx tailwind-merge lucide-react @tanstack/react-table@^8 sonner react-hook-form @hookform/resolvers
pnpm add -D @testing-library/user-event
```

- [ ] **Step 2: Add the `@/*` alias to `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "types": ["vite/client", "vitest/globals"],
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "vite.config.ts", "vitest.setup.ts"]
}
```

- [ ] **Step 3: Wire the Tailwind plugin and alias into `vite.config.ts`**

Keep every existing `server` option exactly as-is — they are what make the app reachable at `https://admin.racepace.lan` through Traefik.

```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    host: true,
    port: 5173,
    allowedHosts: ["admin.racepace.lan", "localhost"],
    hmr: { protocol: "wss", host: "admin.racepace.lan", clientPort: 443 },
    watch: { usePolling: true },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

- [ ] **Step 4: Write `components.json`**

`tailwind.config` is empty because v4 has no JS config file.

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
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

- [ ] **Step 5: Write `src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 6: Write `src/index.css` — the token contract**

Values are copied verbatim from `apps/mobile/global.css`. The `LEGACY` block at the bottom is deleted in Task 11; it exists only so the still-inline-styled screens keep rendering through Tasks 2–10.

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

  /* Sidebar surface — handover: white panel, #F1F7F4 active row */
  --sidebar: 255 255 255;
  --sidebar-foreground: 29 29 31;
  --sidebar-primary: 21 154 85;
  --sidebar-primary-foreground: 255 255 255;
  --sidebar-accent: 241 247 244;
  --sidebar-accent-foreground: 29 29 31;
  --sidebar-border: 224 224 224;
  --sidebar-ring: 21 154 85;

  --radius: 0.6875rem;    /* 11px — handover --radius */
  --radius-card: 1rem;    /* 16px */
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

  --sidebar: 20 25 22;
  --sidebar-foreground: 245 245 247;
  --sidebar-primary: 47 181 106;
  --sidebar-primary-foreground: 6 18 11;
  --sidebar-accent: 19 37 28;
  --sidebar-accent-foreground: 127 224 166;
  --sidebar-border: 38 43 40;
  --sidebar-ring: 47 181 106;
}

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
  --color-sidebar: rgb(var(--sidebar));
  --color-sidebar-foreground: rgb(var(--sidebar-foreground));
  --color-sidebar-primary: rgb(var(--sidebar-primary));
  --color-sidebar-primary-foreground: rgb(var(--sidebar-primary-foreground));
  --color-sidebar-accent: rgb(var(--sidebar-accent));
  --color-sidebar-accent-foreground: rgb(var(--sidebar-accent-foreground));
  --color-sidebar-border: rgb(var(--sidebar-border));
  --color-sidebar-ring: rgb(var(--sidebar-ring));
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: var(--radius-card);
  --radius-pill: var(--radius-pill);
}

@layer base {
  * { box-sizing: border-box; }
  html, body, #root { height: 100%; margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Inter, system-ui, sans-serif;
    color: rgb(var(--foreground));
    background: rgb(var(--muted));
  }
  .rp-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
  .rp-scroll::-webkit-scrollbar-thumb { background: #D6D6DA; border-radius: 8px; }
  .rp-scroll::-webkit-scrollbar-track { background: transparent; }
}

/* LEGACY — inline-style screens still read these. Deleted in Task 11. */
:root {
  --ink: #1D1D1F; --ink-muted: #7A7A7A; --ink-subtle: #8A8A8E; --ink-faint: #C7C7CC;
  --section: #A0A0A5; --canvas: #ffffff; --parchment: #F5F5F7; --surface: #FAFAFB;
  --nav-active: #F1F7F4; --hairline: #E0E0E0; --row-border: #F3F3F5;
  --danger: #FF3B30; --danger-tint: #FDECEA;
}
```

- [ ] **Step 7: Point `main.tsx` at the new stylesheet**

Change line 6 of `apps/web/src/main.tsx`:

```ts
import "./index.css";
```

- [ ] **Step 8: Add the no-flash theme script to `index.html`**

Insert into `<head>`, before `</head>`:

```html
<script>
  (function () {
    try {
      var s = localStorage.getItem("rp-theme");
      var dark = s ? s === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (dark) document.documentElement.classList.add("dark");
    } catch (e) {}
  })();
</script>
```

- [ ] **Step 9: Add jsdom polyfills to `vitest.setup.ts`**

Radix primitives call these; jsdom implements none of them. Landing them now means no later task debugs a confusing "not a function" error.

```ts
import "@testing-library/jest-dom/vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

Element.prototype.scrollIntoView ??= function () {};
Element.prototype.hasPointerCapture ??= function () { return false; };
Element.prototype.setPointerCapture ??= function () {};
Element.prototype.releasePointerCapture ??= function () {};
```

- [ ] **Step 10: Delete the old stylesheet**

```bash
rm apps/web/src/theme.css
```

- [ ] **Step 11: Verify nothing regressed**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: **51/51 passing**, typecheck clean. The UI is byte-identical because the legacy variables are still declared.

- [ ] **Step 12: Commit**

```bash
git add apps/web/components.json apps/web/src/index.css apps/web/src/lib/utils.ts apps/web/vite.config.ts apps/web/tsconfig.json apps/web/vitest.setup.ts apps/web/src/main.tsx apps/web/index.html apps/web/package.json pnpm-lock.yaml
git rm apps/web/src/theme.css
git commit -m "chore(web): add Tailwind v4 + shadcn config and the shared token contract"
```

---

### Task 2: StatusBadge — first primitive, first conversion

Proves the "preserve the look with tokens" approach on the smallest possible surface, and produces the badge every table in Tasks 6–9 needs.

**Files:**
- Create: `apps/web/src/components/ui/badge.tsx` (CLI), `apps/web/src/components/StatusBadge.tsx`
- Modify: `apps/web/src/routes/Events.tsx:12-30` (remove local `STATUS` + `StatusChip`), `apps/web/src/routes/Registrations.tsx`, `apps/web/src/routes/Payments.tsx`, `apps/web/src/components/RegistrationDetail.tsx`
- Delete: `apps/web/src/components/PaymentBadge.tsx`
- Test: `apps/web/src/__tests__/status-badge.test.tsx` (new); update `payments.test.tsx:22`

**Interfaces:**
- Consumes: `cn()` from Task 1; the `--paid` / `--amber` / `--info` / `--destructive` tokens.
- Produces:
  ```ts
  export type BadgeTone = "paid" | "pending" | "info" | "danger" | "neutral";
  export function StatusBadge(props: { tone: BadgeTone; children: React.ReactNode }): JSX.Element;
  export function PaymentStatusBadge(props: { status: string | null }): JSX.Element;
  export function EventStatusBadge(props: { status: string }): JSX.Element;
  ```

- [ ] **Step 1: Generate the badge primitive**

```bash
cd apps/web && pnpm dlx shadcn@latest add badge
```

- [ ] **Step 2: Write the failing test**

`apps/web/src/__tests__/status-badge.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { PaymentStatusBadge, EventStatusBadge } from "../components/StatusBadge";

it("labels each payment status", () => {
  const { rerender } = render(<PaymentStatusBadge status="paid" />);
  expect(screen.getByText("Paid")).toBeInTheDocument();
  rerender(<PaymentStatusBadge status="refunded" />);
  expect(screen.getByText("Refunded")).toBeInTheDocument();
});

it("falls back to an em dash for a null payment status", () => {
  render(<PaymentStatusBadge status={null} />);
  expect(screen.getByText("—")).toBeInTheDocument();
});

it("humanises event statuses, including unknown ones", () => {
  const { rerender } = render(<EventStatusBadge status="almost_full" />);
  expect(screen.getByText("Almost full")).toBeInTheDocument();
  rerender(<EventStatusBadge status="some_new_state" />);
  expect(screen.getByText("some new state")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter web test src/__tests__/status-badge.test.tsx`
Expected: FAIL — `Failed to resolve import "../components/StatusBadge"`.

- [ ] **Step 4: Write `src/components/StatusBadge.tsx`**

Tones map to the same colours the two old components used, so nothing changes visually.

```tsx
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

export type BadgeTone = "paid" | "pending" | "info" | "danger" | "neutral";

const tone = cva(
  "inline-block rounded-pill px-2.5 py-1 text-[11px] font-semibold",
  {
    variants: {
      tone: {
        paid: "bg-paid-tint text-forest dark:text-paid",
        pending: "bg-amber-tint text-amber",
        info: "bg-info-tint text-info",
        danger: "bg-destructive-tint text-destructive",
        neutral: "bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export function StatusBadge({ tone: t, children }: { tone: BadgeTone; children: React.ReactNode }) {
  return <span className={cn(tone({ tone: t }))}>{children}</span>;
}

const PAYMENT: Record<string, { label: string; tone: BadgeTone }> = {
  paid: { label: "Paid", tone: "paid" },
  pending: { label: "Pending", tone: "pending" },
  refunded: { label: "Refunded", tone: "info" },
  failed: { label: "Failed", tone: "danger" },
};

export function PaymentStatusBadge({ status }: { status: string | null }) {
  const s = PAYMENT[status ?? ""] ?? { label: status ?? "—", tone: "neutral" as const };
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}

const EVENT: Record<string, { label: string; tone: BadgeTone }> = {
  open: { label: "Open", tone: "neutral" },
  almost_full: { label: "Almost full", tone: "pending" },
  cancelled: { label: "Cancelled", tone: "danger" },
  rescheduled: { label: "Rescheduled", tone: "info" },
  completed: { label: "Completed", tone: "neutral" },
  closed: { label: "Closed", tone: "neutral" },
  draft: { label: "Draft", tone: "neutral" },
};

export function EventStatusBadge({ status }: { status: string }) {
  const s = EVENT[status] ?? { label: status.replace(/_/g, " "), tone: "neutral" as const };
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `pnpm --filter web test src/__tests__/status-badge.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Replace both old components at their call sites**

In `src/routes/Events.tsx`: delete the `STATUS` map (lines 12–20) and the `StatusChip` function (lines 22–30); import `EventStatusBadge` and render `<EventStatusBadge status={e.status} />` in the status cell.

In `src/routes/Registrations.tsx`, `src/routes/Payments.tsx`, and `src/components/RegistrationDetail.tsx`: change `import { PaymentBadge } from "…/PaymentBadge"` to `import { PaymentStatusBadge } from "…/StatusBadge"` and rename the JSX usage.

Then delete the old file:

```bash
git rm apps/web/src/components/PaymentBadge.tsx
```

- [ ] **Step 7: Update the one test that mocked the old component**

In `apps/web/src/__tests__/payments.test.tsx`, replace line 22:

```tsx
vi.mock("../components/StatusBadge", () => ({ PaymentStatusBadge: ({ status }: { status: string }) => <span>{status}</span> }));
```

- [ ] **Step 8: Run the full suite**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: **54/54** (51 + 3 new), typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/ui/badge.tsx apps/web/src/components/StatusBadge.tsx apps/web/src/__tests__/status-badge.test.tsx apps/web/src/routes apps/web/src/components/RegistrationDetail.tsx apps/web/src/__tests__/payments.test.tsx
git rm apps/web/src/components/PaymentBadge.tsx
git commit -m "feat(web): unify StatusChip and PaymentBadge into a token-driven StatusBadge"
```

---

### Task 3: App shell — sidebar, top bar, theme toggle, toasts

**Files:**
- Create: `apps/web/src/components/ui/{sidebar,sheet,separator,avatar,button,skeleton,tooltip,input,sonner}.tsx` (CLI), `apps/web/src/components/ThemeToggle.tsx`, `apps/web/src/lib/theme.ts`, `apps/web/src/hooks/use-mobile.ts` (CLI, pulled in by sidebar)
- Modify: `apps/web/src/components/AppShell.tsx`, `apps/web/src/components/Sidebar.tsx`, `apps/web/src/components/TopBar.tsx`, `apps/web/src/main.tsx`
- Test: `apps/web/src/__tests__/theme-toggle.test.tsx` (new); `apps/web/src/__tests__/sidebar.test.tsx` (extend)

**Interfaces:**
- Consumes: `cn()`, the `--sidebar-*` tokens from Task 1.
- Produces:
  ```ts
  // src/lib/theme.ts
  export type Theme = "light" | "dark";
  export function readTheme(): Theme;
  export function applyTheme(t: Theme): void;   // toggles .dark on <html>, writes localStorage "rp-theme"
  // src/components/ThemeToggle.tsx
  export function ThemeToggle(): JSX.Element;   // renders a button, aria-label "Toggle dark mode"
  ```
  `AppShell` wraps its subtree in shadcn's `<SidebarProvider>`, so `Sidebar` and `TopBar` may call `useSidebar()`.

- [ ] **Step 1: Generate the primitives**

```bash
cd apps/web && pnpm dlx shadcn@latest add sidebar sheet separator avatar button skeleton tooltip input sonner
```

- [ ] **Step 2: Write the failing theme test**

`apps/web/src/__tests__/theme-toggle.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "../components/ThemeToggle";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

it("adds .dark to <html> and persists the choice", () => {
  render(<ThemeToggle />);
  fireEvent.click(screen.getByLabelText("Toggle dark mode"));
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(localStorage.getItem("rp-theme")).toBe("dark");
});

it("toggles back to light and persists that too", () => {
  localStorage.setItem("rp-theme", "dark");
  document.documentElement.classList.add("dark");
  render(<ThemeToggle />);
  fireEvent.click(screen.getByLabelText("Toggle dark mode"));
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  expect(localStorage.getItem("rp-theme")).toBe("light");
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter web test src/__tests__/theme-toggle.test.tsx`
Expected: FAIL — cannot resolve `../components/ThemeToggle`.

- [ ] **Step 4: Write `src/lib/theme.ts`**

```ts
export type Theme = "light" | "dark";

const KEY = "rp-theme";

export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch { /* private mode — fall through to the media query */ }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(t: Theme): void {
  document.documentElement.classList.toggle("dark", t === "dark");
  try { localStorage.setItem(KEY, t); } catch { /* nothing to do */ }
}
```

- [ ] **Step 5: Write `src/components/ThemeToggle.tsx`**

```tsx
import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { applyTheme, readTheme, type Theme } from "@/lib/theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => readTheme());

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }

  return (
    <Button variant="ghost" size="icon" aria-label="Toggle dark mode" onClick={toggle}>
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
```

- [ ] **Step 6: Run the theme test and watch it pass**

Run: `pnpm --filter web test src/__tests__/theme-toggle.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 7: Rewrite `src/components/Sidebar.tsx`**

Nav items gain icons. The role-gating rules are unchanged: `/team` only for `isOrgAdmin`, the platform group only for `isSuperAdmin`.

```tsx
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, CalendarDays, ClipboardList, CreditCard,
  QrCode, Users, Settings as SettingsIcon, Building2, Percent, Banknote, type LucideIcon,
} from "lucide-react";
import {
  Sidebar as UISidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./ThemeToggle";
import { useMyRoles } from "../lib/roles";
import { useAuth } from "../lib/auth";
import mark from "../assets/topnav-logo.png";

type Item = { to: string; label: string; icon: LucideIcon };

const ORG_ITEMS: Item[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/events", label: "Events", icon: CalendarDays },
  { to: "/registrations", label: "Registrations", icon: ClipboardList },
  { to: "/payments", label: "Payments", icon: CreditCard },
  { to: "/check-in", label: "Check-in", icon: QrCode },
  { to: "/team", label: "Team", icon: Users },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];
const SUPER_ITEMS: Item[] = [
  { to: "/organizations", label: "Organizations", icon: Building2 },
  { to: "/commission", label: "Commission", icon: Percent },
  { to: "/payouts", label: "Payouts", icon: Banknote },
];

function NavItem({ to, label, icon: Icon }: Item) {
  return (
    <SidebarMenuItem>
      <NavLink to={to}>
        {({ isActive }) => (
          <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
            <span>
              <Icon className={isActive ? "text-sidebar-primary" : "text-muted-foreground"} />
              <span className={isActive ? "font-semibold" : "font-medium"}>{label}</span>
            </span>
          </SidebarMenuButton>
        )}
      </NavLink>
    </SidebarMenuItem>
  );
}

export function Sidebar() {
  const roles = useMyRoles();
  const { session, signOut } = useAuth();
  const email = session?.user.email ?? "";
  const local = email.split("@")[0] || "admin";
  const initials = local.slice(0, 2).toUpperCase();
  const role = roles.data?.isSuperAdmin ? "Super admin" : "Admin";

  return (
    <UISidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
          <img src={mark} alt="" className="size-[26px] shrink-0 object-contain" />
          <div className="group-data-[collapsible=icon]:hidden">
            <div className="text-base font-bold tracking-tight">Race Pace</div>
            <div className="text-[11px] text-muted-foreground">Admin console</div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>ORGANIZATION</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {ORG_ITEMS.filter((it) => it.to !== "/team" || roles.data?.isOrgAdmin).map((it) => (
                <NavItem key={it.to} {...it} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {roles.data?.isSuperAdmin ? (
          <SidebarGroup>
            <SidebarGroupLabel>PLATFORM · SUPER ADMIN</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{SUPER_ITEMS.map((it) => <NavItem key={it.to} {...it} />)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-2.5 border-t border-sidebar-border px-2 pt-3">
          <Avatar className="size-8 shrink-0">
            <AvatarFallback className="bg-forest text-[11px] font-bold text-white">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <div className="truncate text-[13px] font-semibold">{local}</div>
            <div className="text-[11px] text-muted-foreground">{role}</div>
          </div>
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => signOut()}
            className="text-destructive group-data-[collapsible=icon]:hidden"
          >
            Sign out
          </Button>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </UISidebar>
  );
}
```

- [ ] **Step 8: Rewrite `src/components/TopBar.tsx`**

The `TITLES` map, the org-name query, and the two path regexes are unchanged — only the markup is.

```tsx
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { supabase } from "../lib/supabase";
import { useMyRoles } from "../lib/roles";

const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard", "/events": "Events", "/registrations": "Registrations",
  "/payments": "Payments", "/check-in": "Race-day check-in", "/settings": "Settings",
  "/organizations": "Organizations", "/commission": "Commission", "/payouts": "Payout statements",
};

export function TopBar() {
  const { pathname } = useLocation();
  const roles = useMyRoles();
  const orgId = roles.data?.orgId;
  const org = useQuery({
    queryKey: ["org-name", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from("organizations").select("name").eq("id", orgId).single();
      return data?.name ?? "";
    },
  });
  const title = pathname === "/events/new" ? "Create event"
    : /^\/events\/[^/]+\/edit$/.test(pathname) ? "Edit event"
    : TITLES[pathname] ?? "Dashboard";
  const orgLabel = roles.data?.isSuperAdmin ? "Platform · Super admin" : org.data ?? "";

  return (
    <header className="flex h-[66px] shrink-0 items-center gap-4 border-b border-border bg-card px-4 md:px-[30px]">
      <SidebarTrigger />
      <div className="text-lg font-bold tracking-tight">{title}</div>
      {orgLabel ? <Badge variant="secondary" className="ml-auto text-[13px] font-semibold">{orgLabel}</Badge> : null}
    </header>
  );
}
```

- [ ] **Step 9: Rewrite `src/components/AppShell.tsx`**

```tsx
import { Outlet } from "react-router-dom";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell() {
  return (
    <SidebarProvider>
      <Sidebar />
      <SidebarInset className="bg-muted">
        <TopBar />
        <main className="rp-scroll flex-1 overflow-y-auto bg-muted">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

- [ ] **Step 10: Mount the toaster in `main.tsx`**

Add the import and render `<Toaster />` as a sibling of `<App />` inside `AuthProvider`:

```tsx
import { Toaster } from "@/components/ui/sonner";
// …
<AuthProvider>
  <App />
  <Toaster position="bottom-right" richColors />
</AuthProvider>
```

- [ ] **Step 11: Extend `sidebar.test.tsx` for collapse and the toggle**

`Sidebar` now needs a `SidebarProvider` ancestor. Replace `renderSidebar` and append two tests:

```tsx
import { SidebarProvider } from "../components/ui/sidebar";

function renderSidebar() {
  return render(
    <MemoryRouter>
      <SidebarProvider>
        <Sidebar />
      </SidebarProvider>
    </MemoryRouter>
  );
}

it("hides Team from an admin who is not an org admin", () => {
  mockRoles = { data: { isSuperAdmin: false, isOrgAdmin: false } };
  renderSidebar();
  expect(screen.queryByText("Team")).not.toBeInTheDocument();
});

it("shows the dark-mode toggle in the footer", () => {
  mockRoles = { data: { isSuperAdmin: false, isOrgAdmin: true } };
  renderSidebar();
  expect(screen.getByLabelText("Toggle dark mode")).toBeInTheDocument();
});
```

Also widen the `mockRoles` type at line 5 to `{ data?: { isSuperAdmin: boolean; isOrgAdmin?: boolean } }`.

- [ ] **Step 12: Run the full suite**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: **58/58** (54 + 2 theme + 2 sidebar), typecheck clean.

- [ ] **Step 13: Commit**

```bash
git add apps/web/src apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): shadcn app shell — collapsible sidebar, lucide icons, dark toggle, toasts"
```

---

### Task 4: Database — flattened admin views

**Files:**
- Create: `supabase/migrations/20260804120000_admin_list_views.sql`, `supabase/tests/admin-list-views.test.ts`

**Interfaces:**
- Consumes: existing RLS — `registrations_read_org_admin`, `payments_read_org_admin`, `profiles_read_org_admin`, `events_read_org_admin`, `categories_read_org_admin`, all built on `auth_can_admin_org(uuid)`.
- Produces three readable views:
  - `admin_payments_v(registration_id, org_id, event_id, event_name, user_id, full_name, amount, platform_fee, net_to_org, method, status, created_at)`
  - `admin_registrations_v(id, org_id, event_id, user_id, full_name, bib_name, category_id, category_label, total_amount, payment_status, payment_method, custom_data, created_at)`
  - `admin_event_reg_counts_v(org_id, event_id, reg_count)`

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260804120000_admin_list_views.sql`:

```sql
-- Flattened read models for the admin console's list screens.
--
-- Why views: registrations.user_id references auth.users, NOT profiles, so PostgREST
-- has no embeddable path to a runner's name. Both list hooks worked around this with a
-- second .in() query and stitched names in JS, which makes server-side ORDER BY / ILIKE
-- on the runner name impossible. Flattening the joins here makes .range(), .order(),
-- .ilike() and count:'exact' work on plain columns.
--
-- security_invoker = true: the caller's own RLS on every underlying table still applies,
-- so these views expose no row an org admin could not already read.

create or replace view admin_payments_v
with (security_invoker = true) as
  select
    p.registration_id,
    p.org_id,
    r.event_id,
    e.name              as event_name,
    r.user_id,
    pr.full_name,
    p.amount,
    p.platform_fee,
    p.net_to_org,
    p.method,
    p.status,
    p.created_at
  from payments p
  join registrations r on r.id = p.registration_id
  left join events e   on e.id = r.event_id
  left join profiles pr on pr.id = r.user_id;

create or replace view admin_registrations_v
with (security_invoker = true) as
  select
    r.id,
    r.org_id,
    r.event_id,
    r.user_id,
    pr.full_name,
    pr.bib_name,
    r.category_id,
    c.label             as category_label,
    r.total_amount,
    p.status            as payment_status,
    p.method            as payment_method,
    r.custom_data,
    r.created_at
  from registrations r
  left join profiles pr on pr.id = r.user_id
  left join categories c on c.id = r.category_id
  left join payments p   on p.registration_id = r.id;

create or replace view admin_event_reg_counts_v
with (security_invoker = true) as
  select r.org_id, r.event_id, count(*)::int as reg_count
  from registrations r
  group by r.org_id, r.event_id;

grant select on admin_payments_v          to authenticated;
grant select on admin_registrations_v     to authenticated;
grant select on admin_event_reg_counts_v  to authenticated;
```

- [ ] **Step 2: Write the failing RLS test**

`supabase/tests/admin-list-views.test.ts`. The count assertion is the point: an exact count computed before RLS would leak another org's transaction volume even with rows hidden.

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
const service = () => createClient(url, serviceKey, { auth: { persistSession: false } });
const authed = (t: string) => createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${t}` } }, auth: { persistSession: false } });

async function makeUser(email: string) {
  const svc = service();
  const c = await svc.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  const s = await anon().auth.signInWithPassword({ email, password: "password123" });
  return { id: c.data.user!.id, token: s.data.session!.access_token };
}

const RWP = "00000000-0000-0000-0000-0000000000a1";
const APO = "00000000-0000-0000-0000-0000000000a2";
const E1 = "00000000-0000-0000-0000-0000000000e1";
const C4 = "00000000-0000-0000-0000-0000000000c4";

describe("admin list views", () => {
  it("flatten the join for the owning org and leak neither rows nor counts to another org", async () => {
    const svc = service();
    const admin = await makeUser(`av_adm_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: admin.id, role: "admin", org_id: RWP });
    const other = await makeUser(`av_oth_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: other.id, role: "admin", org_id: APO });
    const runner = await makeUser(`av_run_${Date.now()}@test.dev`);
    await svc.from("profiles").insert({ id: runner.id, full_name: "Ana Cruz", bib_name: "ANA" });

    const reg = await svc.from("registrations")
      .insert({ org_id: RWP, event_id: E1, category_id: C4, user_id: runner.id, status: "paid", total_amount: 100000 })
      .select().single();
    await svc.from("payments").insert({ org_id: RWP, registration_id: reg.data!.id, amount: 100000, platform_fee: 10000, net_to_org: 90000, method: "gcash", status: "paid" });

    // The owning admin sees a flat row with the joined-in names.
    const pay = await authed(admin.token).from("admin_payments_v").select("*").eq("registration_id", reg.data!.id).single();
    expect(pay.data).toMatchObject({ full_name: "Ana Cruz", net_to_org: 90000, status: "paid", org_id: RWP });
    expect(pay.data!.event_name).toBeTruthy();

    const row = await authed(admin.token).from("admin_registrations_v").select("*").eq("id", reg.data!.id).single();
    expect(row.data).toMatchObject({ full_name: "Ana Cruz", bib_name: "ANA", payment_status: "paid", payment_method: "gcash" });
    expect(row.data!.category_label).toBeTruthy();

    // Server-side paging primitives work.
    const paged = await authed(admin.token).from("admin_registrations_v")
      .select("id", { count: "exact" }).eq("event_id", E1).order("created_at", { ascending: false }).range(0, 0);
    expect(paged.data).toHaveLength(1);
    expect(paged.count).toBeGreaterThanOrEqual(1);

    // Server-side search on the runner name — impossible before these views.
    const searched = await authed(admin.token).from("admin_registrations_v").select("id").eq("event_id", E1).ilike("full_name", "%ana%");
    expect((searched.data ?? []).map((r) => r.id)).toContain(reg.data!.id);

    // The other org sees no rows AND a zero count through every view.
    const otherPay = await authed(other.token).from("admin_payments_v").select("registration_id", { count: "exact" }).eq("registration_id", reg.data!.id);
    expect(otherPay.data ?? []).toHaveLength(0);
    expect(otherPay.count ?? 0).toBe(0);

    const otherReg = await authed(other.token).from("admin_registrations_v").select("id", { count: "exact" }).eq("id", reg.data!.id);
    expect(otherReg.data ?? []).toHaveLength(0);
    expect(otherReg.count ?? 0).toBe(0);

    const otherCounts = await authed(other.token).from("admin_event_reg_counts_v").select("*").eq("event_id", E1);
    expect(otherCounts.data ?? []).toHaveLength(0);

    // The runner (not an admin anywhere) sees nothing through the admin views.
    const runnerPay = await authed(runner.token).from("admin_payments_v").select("registration_id", { count: "exact" }).eq("registration_id", reg.data!.id);
    expect(runnerPay.count ?? 0).toBe(0);

    await svc.from("registrations").delete().eq("id", reg.data!.id);
    await svc.from("user_roles").delete().in("user_id", [admin.id, other.id]);
    await svc.from("profiles").delete().eq("id", runner.id);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm test -- supabase/tests/admin-list-views.test.ts`
Expected: FAIL — `relation "admin_payments_v" does not exist` (PostgREST reports it as a schema-cache miss, `PGRST205`).

> Requires a reachable Supabase. Cloud is the default (`--linked`); a local stack works too if one is running.

- [ ] **Step 4: Apply the migration**

```bash
pnpm exec supabase db push --linked
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `pnpm test -- supabase/tests/admin-list-views.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 6: Verify effective grants on the hosted DB**

`20260724140000_scope_org_update_grant.sql` exists because hosted `organizations` had grant drift that the migrations did not describe. Check reality rather than trusting the file:

```bash
pnpm exec supabase db query --linked "select table_name, privilege_type, grantee from information_schema.role_table_grants where table_name in ('admin_payments_v','admin_registrations_v','admin_event_reg_counts_v') order by table_name, grantee;"
```

Expected: `SELECT` for `authenticated` on all three, and **no** INSERT/UPDATE/DELETE for `anon` or `authenticated`. If anything extra appears, add an explicit `revoke` to the migration and re-push before moving on.

- [ ] **Step 7: Run the whole backend suite**

Run: `pnpm test`
Expected: **55/55** (54 + 1 new).

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260804120000_admin_list_views.sql supabase/tests/admin-list-views.test.ts
git commit -m "feat(db): flattened security-invoker admin list views for server-side paging"
```

---

### Task 5: DataTable + URL state

Built and tested standalone before any screen depends on it.

**Files:**
- Create: `apps/web/src/components/ui/{table,pagination,select,dropdown-menu}.tsx` (CLI), `apps/web/src/components/DataTable.tsx`, `apps/web/src/lib/useTableParams.ts`
- Test: `apps/web/src/__tests__/data-table.test.tsx`, `apps/web/src/__tests__/table-params.test.tsx`

**Interfaces:**
- Consumes: `cn()`, `@tanstack/react-table`.
- Produces:
  ```ts
  export type SortState = { id: string; desc: boolean };

  export type ServerPaging = {
    pageIndex: number;                       // 0-based
    pageCount: number;
    totalRows: number;
    onPageChange: (pageIndex: number) => void;
    sorting: SortState[];
    onSortingChange: (s: SortState[]) => void;
  };

  export function DataTable<TData>(props: {
    columns: ColumnDef<TData, unknown>[];
    data: TData[];
    messages: { loading: string; empty: string; error: string };
    isLoading?: boolean;
    isError?: boolean;
    onRetry?: () => void;
    onRowClick?: (row: TData) => void;
    server?: ServerPaging;                   // omit → client-side paging + sorting
    pageSize?: number;                       // client mode only, default 25
  }): JSX.Element;

  // src/lib/useTableParams.ts
  export type TableParams = {
    page: number;                            // 1-based in the URL, 0-based in DataTable
    sort: SortState[];
    filters: Record<string, string>;
    q: string;
  };
  export function useTableParams(defaults?: {
    sort?: SortState[];
    filters?: Record<string, string>;
  }): TableParams & {
    setPage: (p: number) => void;
    setSort: (s: SortState[]) => void;
    setFilter: (key: string, value: string) => void;   // resets page to 1
    setQ: (q: string) => void;                         // resets page to 1
  };
  ```

- [ ] **Step 1: Generate the primitives**

```bash
cd apps/web && pnpm dlx shadcn@latest add table pagination select dropdown-menu
```

- [ ] **Step 2: Write the failing `useTableParams` test**

`apps/web/src/__tests__/table-params.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useTableParams } from "../lib/useTableParams";

function Probe() {
  const t = useTableParams({ sort: [{ id: "created_at", desc: true }] });
  return (
    <div>
      <span data-testid="page">{t.page}</span>
      <span data-testid="sort">{t.sort.map((s) => `${s.id}:${s.desc ? "desc" : "asc"}`).join(",")}</span>
      <span data-testid="status">{t.filters.status ?? ""}</span>
      <span data-testid="q">{t.q}</span>
      <button onClick={() => t.setPage(3)}>page3</button>
      <button onClick={() => t.setFilter("status", "refunded")}>filter</button>
      <button onClick={() => t.setSort([{ id: "amount", desc: false }])}>sort</button>
    </div>
  );
}

const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><Probe /></MemoryRouter>);

it("defaults page to 1 and applies the default sort", () => {
  at("/payments");
  expect(screen.getByTestId("page")).toHaveTextContent("1");
  expect(screen.getByTestId("sort")).toHaveTextContent("created_at:desc");
});

it("reads page, sort, filters and search from the URL", () => {
  at("/payments?page=4&sort=amount:asc&status=paid&q=ana");
  expect(screen.getByTestId("page")).toHaveTextContent("4");
  expect(screen.getByTestId("sort")).toHaveTextContent("amount:asc");
  expect(screen.getByTestId("status")).toHaveTextContent("paid");
  expect(screen.getByTestId("q")).toHaveTextContent("ana");
});

it("writes page and sort back to the URL", () => {
  at("/payments");
  fireEvent.click(screen.getByText("page3"));
  expect(screen.getByTestId("page")).toHaveTextContent("3");
  fireEvent.click(screen.getByText("sort"));
  expect(screen.getByTestId("sort")).toHaveTextContent("amount:asc");
});

it("resets to page 1 when a filter changes", () => {
  at("/payments?page=5");
  fireEvent.click(screen.getByText("filter"));
  expect(screen.getByTestId("page")).toHaveTextContent("1");
  expect(screen.getByTestId("status")).toHaveTextContent("refunded");
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter web test src/__tests__/table-params.test.tsx`
Expected: FAIL — cannot resolve `../lib/useTableParams`.

- [ ] **Step 4: Write `src/lib/useTableParams.ts`**

```ts
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export type SortState = { id: string; desc: boolean };

export type TableParams = {
  page: number;
  sort: SortState[];
  filters: Record<string, string>;
  q: string;
};

const RESERVED = new Set(["page", "sort", "q"]);

function parseSort(raw: string | null, fallback: SortState[]): SortState[] {
  if (!raw) return fallback;
  return raw.split(",").filter(Boolean).map((part) => {
    const [id, dir] = part.split(":");
    return { id, desc: dir === "desc" };
  });
}

const formatSort = (s: SortState[]) => s.map((x) => `${x.id}:${x.desc ? "desc" : "asc"}`).join(",");

export function useTableParams(defaults?: { sort?: SortState[]; filters?: Record<string, string> }) {
  const [params, setParams] = useSearchParams();
  const defaultSort = defaults?.sort ?? [];
  const defaultFilters = defaults?.filters ?? {};

  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const q = params.get("q") ?? "";
  const sort = useMemo(() => parseSort(params.get("sort"), defaultSort), [params, defaultSort]);

  const filters = useMemo(() => {
    const out: Record<string, string> = { ...defaultFilters };
    params.forEach((value, key) => { if (!RESERVED.has(key)) out[key] = value; });
    return out;
  }, [params, defaultFilters]);

  const patch = useCallback((next: Record<string, string | null>) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(next)) {
        if (v === null || v === "") p.delete(k);
        else p.set(k, v);
      }
      return p;
    }, { replace: true });
  }, [setParams]);

  return {
    page,
    sort,
    filters,
    q,
    setPage: (p: number) => patch({ page: p <= 1 ? null : String(p) }),
    setSort: (s: SortState[]) => patch({ sort: s.length ? formatSort(s) : null, page: null }),
    setFilter: (key: string, value: string) => patch({ [key]: value === "all" ? null : value, page: null }),
    setQ: (value: string) => patch({ q: value || null, page: null }),
  };
}
```

- [ ] **Step 5: Run the params test and watch it pass**

Run: `pnpm --filter web test src/__tests__/table-params.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 6: Write the failing DataTable test**

`apps/web/src/__tests__/data-table.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "../components/DataTable";

type Row = { id: string; name: string; amount: number };
const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: "name", header: "Runner" },
  { accessorKey: "amount", header: "Amount" },
];
const rows: Row[] = [
  { id: "1", name: "Ana Cruz", amount: 100 },
  { id: "2", name: "Ben Diaz", amount: 200 },
];
const messages = { loading: "Loading…", empty: "Nothing here.", error: "Couldn't load." };

it("renders a real table with a header row and one row per record", () => {
  render(<DataTable columns={columns} data={rows} messages={messages} />);
  expect(screen.getByRole("columnheader", { name: "Runner" })).toBeInTheDocument();
  expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2
  expect(screen.getByText("Ana Cruz")).toBeInTheDocument();
});

it("shows the loading message", () => {
  render(<DataTable columns={columns} data={[]} messages={messages} isLoading />);
  expect(screen.getByText("Loading…")).toBeInTheDocument();
});

it("shows the empty message", () => {
  render(<DataTable columns={columns} data={[]} messages={messages} />);
  expect(screen.getByText("Nothing here.")).toBeInTheDocument();
});

it("shows the error message and retries on click", () => {
  const onRetry = vi.fn();
  render(<DataTable columns={columns} data={[]} messages={messages} isError onRetry={onRetry} />);
  expect(screen.getByText("Couldn't load.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(onRetry).toHaveBeenCalled();
});

it("calls onRowClick with the clicked record", () => {
  const onRowClick = vi.fn();
  render(<DataTable columns={columns} data={rows} messages={messages} onRowClick={onRowClick} />);
  fireEvent.click(screen.getByText("Ben Diaz"));
  expect(onRowClick).toHaveBeenCalledWith(rows[1]);
});

it("pages client-side when no server config is given", () => {
  render(<DataTable columns={columns} data={rows} messages={messages} pageSize={1} />);
  expect(screen.getByText("Ana Cruz")).toBeInTheDocument();
  expect(screen.queryByText("Ben Diaz")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(screen.getByText("Ben Diaz")).toBeInTheDocument();
});

it("delegates paging to the server config and reports the total", () => {
  const onPageChange = vi.fn();
  render(
    <DataTable
      columns={columns}
      data={rows}
      messages={messages}
      server={{ pageIndex: 1, pageCount: 5, totalRows: 97, onPageChange, sorting: [], onSortingChange: vi.fn() }}
    />
  );
  expect(screen.getByText("97 rows")).toBeInTheDocument();
  expect(screen.getByText("Page 2 of 5")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(onPageChange).toHaveBeenCalledWith(2);
});

it("reports header clicks through onSortingChange in server mode", () => {
  const onSortingChange = vi.fn();
  render(
    <DataTable
      columns={columns}
      data={rows}
      messages={messages}
      server={{ pageIndex: 0, pageCount: 1, totalRows: 2, onPageChange: vi.fn(), sorting: [], onSortingChange }}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Amount" }));
  expect(onSortingChange).toHaveBeenCalledWith([{ id: "amount", desc: false }]);
});

it("disables Previous on the first page and Next on the last", () => {
  render(
    <DataTable
      columns={columns}
      data={rows}
      messages={messages}
      server={{ pageIndex: 0, pageCount: 1, totalRows: 2, onPageChange: vi.fn(), sorting: [], onSortingChange: vi.fn() }}
    />
  );
  expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
});
```

- [ ] **Step 7: Run it and watch it fail**

Run: `pnpm --filter web test src/__tests__/data-table.test.tsx`
Expected: FAIL — cannot resolve `../components/DataTable`.

- [ ] **Step 8: Write `src/components/DataTable.tsx`**

```tsx
import { useState } from "react";
import {
  flexRender, getCoreRowModel, getPaginationRowModel, getSortedRowModel,
  useReactTable, type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type SortState = { id: string; desc: boolean };

export type ServerPaging = {
  pageIndex: number;
  pageCount: number;
  totalRows: number;
  onPageChange: (pageIndex: number) => void;
  sorting: SortState[];
  onSortingChange: (s: SortState[]) => void;
};

type Props<TData> = {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  messages: { loading: string; empty: string; error: string };
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  onRowClick?: (row: TData) => void;
  server?: ServerPaging;
  pageSize?: number;
};

export function DataTable<TData>({
  columns, data, messages, isLoading, isError, onRetry, onRowClick, server, pageSize = 25,
}: Props<TData>) {
  const [clientSorting, setClientSorting] = useState<SortingState>([]);
  const sorting: SortingState = server ? server.sorting : clientSorting;

  const table = useReactTable({
    data,
    columns,
    state: server
      ? { sorting, pagination: { pageIndex: server.pageIndex, pageSize } }
      : { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      if (server) server.onSortingChange(next as SortState[]);
      else setClientSorting(next);
    },
    manualPagination: !!server,
    manualSorting: !!server,
    pageCount: server?.pageCount,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: server ? undefined : getSortedRowModel(),
    getPaginationRowModel: server ? undefined : getPaginationRowModel(),
    initialState: server ? undefined : { pagination: { pageIndex: 0, pageSize } },
  });

  const pageIndex = server ? server.pageIndex : table.getState().pagination.pageIndex;
  const pageCount = server ? server.pageCount : table.getPageCount();
  const totalRows = server ? server.totalRows : data.length;
  const canPrev = pageIndex > 0;
  const canNext = pageIndex < pageCount - 1;

  function goTo(next: number) {
    if (server) server.onPageChange(next);
    else table.setPageIndex(next);
  }

  const colSpan = columns.length;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <Table>
        <TableHeader className="bg-muted/60">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const dir = header.column.getIsSorted();
                return (
                  <TableHead
                    key={header.id}
                    className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 uppercase"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {dir === "asc" ? <ArrowUp className="size-3" />
                          : dir === "desc" ? <ArrowDown className="size-3" />
                          : <ChevronsUpDown className="size-3 opacity-40" />}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>

        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={colSpan} className="p-5 text-sm text-muted-foreground">{messages.loading}</TableCell>
            </TableRow>
          ) : isError ? (
            <TableRow>
              <TableCell colSpan={colSpan} className="p-5">
                <div className="flex items-center gap-3.5">
                  <span className="text-sm text-muted-foreground">{messages.error}</span>
                  {onRetry ? <Button variant="outline" size="sm" className="rounded-pill" onClick={onRetry}>Retry</Button> : null}
                </div>
              </TableCell>
            </TableRow>
          ) : table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={colSpan} className="p-5 text-sm text-muted-foreground">{messages.empty}</TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={cn(onRowClick && "cursor-pointer")}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="py-3.5 text-[13px]">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {!isLoading && !isError && totalRows > 0 ? (
        <div className="flex items-center justify-between border-t border-border px-5 py-3 text-[13px] text-muted-foreground">
          <span>{totalRows} rows</span>
          <div className="flex items-center gap-3">
            <span>Page {pageIndex + 1} of {Math.max(pageCount, 1)}</span>
            <Button variant="outline" size="sm" aria-label="Previous page" disabled={!canPrev} onClick={() => goTo(pageIndex - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" aria-label="Next page" disabled={!canNext} onClick={() => goTo(pageIndex + 1)}>
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 9: Run the DataTable test and watch it pass**

Run: `pnpm --filter web test src/__tests__/data-table.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 10: Run the full suite**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: **71/71** (58 + 9 + 4), typecheck clean.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): generic DataTable over TanStack Table + URL-synced table params"
```

---

### Task 6: Payments on server-side paging

**Files:**
- Modify: `apps/web/src/lib/registrations.ts:98-152` (rewrite `usePayments`), `apps/web/src/routes/Payments.tsx`
- Test: `apps/web/src/__tests__/payments.test.tsx` (rewrite), `apps/web/src/__tests__/payments-query.test.ts` (new)

**Interfaces:**
- Consumes: `admin_payments_v` (Task 4); `DataTable`, `ServerPaging`, `useTableParams` (Task 5); `PaymentStatusBadge` (Task 2).
- Produces:
  ```ts
  export const PAGE_SIZE = 25;
  export type PaymentsQuery = {
    page: number;                             // 1-based
    sort: { id: string; desc: boolean }[];
    status: PaymentStatus | "all";
    q: string;
  };
  export function usePayments(
    orgId: string | undefined,
    query: PaymentsQuery
  ): UseQueryResult<{ rows: PaymentRow[]; total: number }>;
  ```
  `PaymentRow` keeps the exact shape it has today — no field added or removed.

- [ ] **Step 1: Write the failing query test**

`apps/web/src/__tests__/payments-query.test.ts` asserts the paging primitives actually reach PostgREST rather than being simulated client-side:

```ts
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";

const calls: Record<string, unknown[]> = { range: [], order: [], eq: [], or: [] };
const builder: Record<string, unknown> = {};
["select", "eq", "order", "range", "or"].forEach((m) => {
  builder[m] = (...args: unknown[]) => { calls[m]?.push(args); return builder; };
});
(builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
  resolve({ data: [], count: 97, error: null });

vi.mock("../lib/supabase", () => ({ supabase: { from: (t: string) => { calls.from = [[t]]; return builder; } } }));

import { usePayments, PAGE_SIZE } from "../lib/registrations";

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

it("queries the flattened view with range, order and an exact count", async () => {
  const { result } = renderHook(
    () => usePayments("a1", { page: 3, sort: [{ id: "amount", desc: true }], status: "paid", q: "ana" }),
    { wrapper }
  );
  await waitFor(() => expect(result.current.isSuccess).toBe(true));

  expect(calls.from).toEqual([["admin_payments_v"]]);
  expect(calls.range).toContainEqual([2 * PAGE_SIZE, 3 * PAGE_SIZE - 1]);
  expect(calls.order).toContainEqual(["amount", { ascending: false }]);
  expect(calls.eq).toContainEqual(["status", "paid"]);
  expect(calls.or[0][0]).toContain("ana");
  expect(result.current.data!.total).toBe(97);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter web test src/__tests__/payments-query.test.ts`
Expected: FAIL — `usePayments` takes one argument today and queries `payments`, so `calls.from` is `[["payments"]]` and `range` is empty.

- [ ] **Step 3: Rewrite `usePayments` in `src/lib/registrations.ts`**

Replace the whole existing `usePayments` function (and leave `PaymentRow` exactly as it is):

```ts
export const PAGE_SIZE = 25;

export type PaymentsQuery = {
  page: number;
  sort: { id: string; desc: boolean }[];
  status: PaymentStatus | "all";
  q: string;
};

export function usePayments(orgId: string | undefined, query: PaymentsQuery) {
  const { page, sort, status, q } = query;
  return useQuery<{ rows: PaymentRow[]; total: number }>({
    queryKey: ["org-payments", orgId, page, sort, status, q],
    enabled: !!orgId,
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      let req = supabase
        .from("admin_payments_v")
        .select(
          "registration_id,event_id,event_name,user_id,full_name,amount,platform_fee,net_to_org,method,status,created_at",
          { count: "exact" }
        )
        .eq("org_id", orgId!);

      if (status !== "all") req = req.eq("status", status);
      if (q.trim()) {
        const term = `%${q.trim()}%`;
        req = req.or(`full_name.ilike.${term},event_name.ilike.${term}`);
      }
      const s = sort[0] ?? { id: "created_at", desc: true };
      req = req.order(s.id, { ascending: !s.desc }).range(from, from + PAGE_SIZE - 1);

      const { data, error, count } = await req;
      if (error) throw error;
      return { rows: (data ?? []) as PaymentRow[], total: count ?? 0 };
    },
  });
}
```

- [ ] **Step 4: Run the query test and watch it pass**

Run: `pnpm --filter web test src/__tests__/payments-query.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Rewrite `src/routes/Payments.tsx`**

```tsx
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/DataTable";
import { useTableParams } from "@/lib/useTableParams";
import { useMyRoles } from "../lib/roles";
import { usePayments, PAGE_SIZE, type PaymentRow, type PaymentStatus } from "../lib/registrations";
import { PaymentStatusBadge } from "../components/StatusBadge";

const FILTERS = ["all", "pending", "paid", "refunded", "failed"] as const;
const peso = (c: number) => `₱${(c / 100).toLocaleString()}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function Payments() {
  const roles = useMyRoles();
  const nav = useNavigate();
  const t = useTableParams({ sort: [{ id: "created_at", desc: true }] });
  const status = (t.filters.status ?? "all") as PaymentStatus | "all";
  const pays = usePayments(roles.data?.orgId ?? undefined, { page: t.page, sort: t.sort, status, q: t.q });

  const columns = useMemo<ColumnDef<PaymentRow, unknown>[]>(() => [
    { accessorKey: "event_name", header: "Event", cell: ({ row }) => <span className="font-semibold">{row.original.event_name ?? "—"}</span> },
    { accessorKey: "full_name", header: "Runner", cell: ({ row }) => row.original.full_name ?? "—" },
    { accessorKey: "amount", header: "Amount", cell: ({ row }) => peso(row.original.amount) },
    { accessorKey: "platform_fee", header: "Fee", cell: ({ row }) => peso(row.original.platform_fee) },
    { accessorKey: "net_to_org", header: "Net", cell: ({ row }) => peso(row.original.net_to_org) },
    { accessorKey: "method", header: "Method", cell: ({ row }) => row.original.method ?? "—" },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <PaymentStatusBadge status={row.original.status} /> },
    { accessorKey: "created_at", header: "Date", cell: ({ row }) => fmtDate(row.original.created_at) },
  ], []);

  const total = pays.data?.total ?? 0;

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={status} onValueChange={(v) => t.setFilter("status", v)}>
          <SelectTrigger aria-label="Payment status" className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map((f) => (
              <SelectItem key={f} value={f}>{f === "all" ? "All payments" : f.charAt(0).toUpperCase() + f.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search payments"
            placeholder="Search runner or event…"
            className="w-[240px] pl-8"
            defaultValue={t.q}
            onChange={(e) => t.setQ(e.target.value)}
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={pays.data?.rows ?? []}
        isLoading={pays.isLoading}
        isError={pays.isError}
        onRetry={() => pays.refetch()}
        messages={{ loading: "Loading payments…", empty: "No payments yet.", error: "Couldn't load payments." }}
        onRowClick={(p) => p.event_id && nav(`/registrations?event=${p.event_id}`)}
        server={{
          pageIndex: t.page - 1,
          pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
          totalRows: total,
          onPageChange: (i) => t.setPage(i + 1),
          sorting: t.sort,
          onSortingChange: t.setSort,
        }}
      />
    </div>
  );
}
```

> The search `Input` uses `defaultValue`, not `value` — `setQ` rewrites the URL on every keystroke, and a controlled input would fight the re-render and drop characters.

- [ ] **Step 6: Rewrite `src/__tests__/payments.test.tsx`**

Same three intents as before — rows render with money columns, the status filter narrows results, a row click navigates — but the filter is now server-driven, so the assertion is that the query receives the new status rather than that rows vanish client-side.

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Payments } from "../routes/Payments";

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({ ...(await orig() as object), useNavigate: () => navigate }));
vi.mock("../lib/roles", () => ({ useMyRoles: () => ({ data: { orgId: "a1" } }) }));

const usePayments = vi.fn();
vi.mock("../lib/registrations", async (orig) => ({
  ...(await orig() as object),
  usePayments: (...a: unknown[]) => usePayments(...a),
}));
vi.mock("../components/StatusBadge", () => ({ PaymentStatusBadge: ({ status }: { status: string }) => <span>{status}</span> }));

const ROWS = [
  { registration_id: "r1", event_id: "e1", event_name: "Apo Sky Ultra", user_id: "u1", full_name: "Ana Cruz", amount: 100000, platform_fee: 10000, net_to_org: 90000, method: "gcash", status: "paid", created_at: "2026-07-01T00:00:00Z" },
];

beforeEach(() => {
  navigate.mockClear();
  usePayments.mockReset();
  usePayments.mockReturnValue({ data: { rows: ROWS, total: 1 }, isLoading: false, isError: false, refetch: vi.fn() });
});

const renderAt = (path = "/payments") => render(<MemoryRouter initialEntries={[path]}><Payments /></MemoryRouter>);

it("lists payments with money columns", () => {
  renderAt();
  expect(screen.getByText("Ana Cruz")).toBeInTheDocument();
  expect(screen.getByText("₱900")).toBeInTheDocument();   // net_to_org 90000
  expect(screen.getByText("₱1,000")).toBeInTheDocument(); // amount 100000
});

it("passes the chosen status filter to the query", async () => {
  const user = userEvent.setup();
  renderAt();
  await user.click(screen.getByLabelText("Payment status"));
  await user.click(screen.getByRole("option", { name: "Refunded" }));
  await waitFor(() =>
    expect(usePayments).toHaveBeenLastCalledWith("a1", expect.objectContaining({ status: "refunded" }))
  );
});

it("reads the initial status and page from the URL", () => {
  renderAt("/payments?status=paid&page=2");
  expect(usePayments).toHaveBeenLastCalledWith("a1", expect.objectContaining({ status: "paid", page: 2 }));
});

it("navigates to the event roster when a row is clicked", async () => {
  const user = userEvent.setup();
  renderAt();
  await user.click(screen.getByText("Ana Cruz"));
  expect(navigate).toHaveBeenCalledWith("/registrations?event=e1");
});
```

- [ ] **Step 7: Run the suite**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: **75/75** (71 − 2 replaced payments tests + 4 new payments tests + 1 query test + 1). Report the real number.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): Payments on server-side paging, sorting and search"
```

---

### Task 7: Registrations on server-side paging + detail sheet

**Files:**
- Modify: `apps/web/src/lib/registrations.ts` (rewrite `useEventRegistrations` and `useEventRegistrationCounts`, add `useRegistrationAddons`), `apps/web/src/routes/Registrations.tsx`, `apps/web/src/components/RegistrationDetail.tsx`
- Test: `apps/web/src/__tests__/registrations.test.tsx`, `apps/web/src/__tests__/registrations-hooks.test.tsx`, `apps/web/src/__tests__/registration-detail.test.tsx` (all rewritten)

**Interfaces:**
- Consumes: `admin_registrations_v`, `admin_event_reg_counts_v` (Task 4); `DataTable`, `useTableParams` (Task 5).
- Produces:
  ```ts
  // RegistrationRow drops `addons` — the list view cannot aggregate them.
  export type RegistrationRow = {
    id: string; user_id: string; category_id: string; category_label: string | null;
    full_name: string | null; bib_name: string | null; total_amount: number;
    payment_status: PaymentStatus | null; payment_method: string | null;
    created_at: string; custom_data: Record<string, unknown>;
  };
  export type RegistrationsQuery = {
    page: number;
    sort: { id: string; desc: boolean }[];
    status: PaymentStatus | "all";
    categoryId: string | "all";
    q: string;
  };
  export function useEventRegistrations(
    eventId: string | undefined,
    query: RegistrationsQuery
  ): UseQueryResult<{ rows: RegistrationRow[]; total: number }>;

  // New — the detail drawer fetches add-ons for one registration on open.
  export function useRegistrationAddons(
    registrationId: string | undefined
  ): UseQueryResult<{ name: string | null; price: number }[]>;
  ```

> **Why `addons` moves:** the flat view has one row per registration and cannot carry a variable-length add-on list. Fetching them per-registration is also strictly less work — the drawer opens for one row at a time, where the old code fetched add-ons for the entire roster up front.

- [ ] **Step 1: Rewrite the three hooks in `src/lib/registrations.ts`**

Replace `RegistrationRow`, `useEventRegistrations`, and `useEventRegistrationCounts`; add `useRegistrationAddons`. Delete the now-unused `one()` helper if nothing else references it.

```ts
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

export type RegistrationsQuery = {
  page: number;
  sort: { id: string; desc: boolean }[];
  status: PaymentStatus | "all";
  categoryId: string | "all";
  q: string;
};

export function useEventRegistrations(eventId: string | undefined, query: RegistrationsQuery) {
  const { page, sort, status, categoryId, q } = query;
  return useQuery<{ rows: RegistrationRow[]; total: number }>({
    queryKey: ["event-registrations", eventId, page, sort, status, categoryId, q],
    enabled: !!eventId,
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      let req = supabase
        .from("admin_registrations_v")
        .select(
          "id,user_id,category_id,category_label,full_name,bib_name,total_amount,payment_status,payment_method,custom_data,created_at",
          { count: "exact" }
        )
        .eq("event_id", eventId!);

      if (status !== "all") req = req.eq("payment_status", status);
      if (categoryId !== "all") req = req.eq("category_id", categoryId);
      if (q.trim()) {
        const term = `%${q.trim()}%`;
        req = req.or(`full_name.ilike.${term},bib_name.ilike.${term}`);
      }
      const s = sort[0] ?? { id: "created_at", desc: true };
      req = req.order(s.id, { ascending: !s.desc }).range(from, from + PAGE_SIZE - 1);

      const { data, error, count } = await req;
      if (error) throw error;
      return { rows: (data ?? []) as RegistrationRow[], total: count ?? 0 };
    },
  });
}

export function useRegistrationAddons(registrationId?: string) {
  return useQuery<{ name: string | null; price: number }[]>({
    queryKey: ["registration-addons", registrationId],
    enabled: !!registrationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("registration_addons")
        .select("price,addons(name)")
        .eq("registration_id", registrationId!);
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map((a) => {
        const addon = Array.isArray(a.addons) ? a.addons[0] : a.addons;
        return { name: ((addon as { name?: string })?.name) ?? null, price: a.price as number };
      });
    },
  });
}

export function useEventRegistrationCounts(orgId?: string) {
  return useQuery<Record<string, number>>({
    queryKey: ["event-registration-counts", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_event_reg_counts_v")
        .select("event_id,reg_count")
        .eq("org_id", orgId!);
      if (error) throw error;
      return Object.fromEntries(((data ?? []) as { event_id: string; reg_count: number }[]).map((r) => [r.event_id, r.reg_count]));
    },
  });
}
```

- [ ] **Step 2: Rewrite `src/__tests__/registrations-hooks.test.tsx`**

Mirror the Task 6 query test — assert the view, the range, the count, and that filters become query params. Use the same `builder` mock shape as `payments-query.test.ts`, changing the table to `admin_registrations_v` and asserting:

```ts
expect(calls.from).toEqual([["admin_registrations_v"]]);
expect(calls.eq).toContainEqual(["event_id", "e1"]);
expect(calls.eq).toContainEqual(["payment_status", "paid"]);
expect(calls.eq).toContainEqual(["category_id", "c1"]);
expect(calls.range).toContainEqual([0, PAGE_SIZE - 1]);
expect(result.current.data!.total).toBe(97);
```

driven by `useEventRegistrations("e1", { page: 1, sort: [], status: "paid", categoryId: "c1", q: "" })`.

Add a second test for the counts hook asserting `calls.from` is `[["admin_event_reg_counts_v"]]` and that the returned map is `{ e1: 4 }` when the builder resolves `{ data: [{ event_id: "e1", reg_count: 4 }], count: null, error: null }`.

- [ ] **Step 3: Run the hook tests and watch them pass**

Run: `pnpm --filter web test src/__tests__/registrations-hooks.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 4: Rewrite `src/routes/Registrations.tsx`**

The category filter list no longer comes from the loaded rows (they are one page now) — it comes from the event's categories via `useEventForEditor`, which already returns them.

```tsx
import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/DataTable";
import { useTableParams } from "@/lib/useTableParams";
import { useMyRoles } from "../lib/roles";
import { useOrgEvents, useEventForEditor } from "../lib/events";
import {
  useEventRegistrations, useEventRegistrationCounts, PAGE_SIZE,
  type RegistrationRow, type PaymentStatus,
} from "../lib/registrations";
import { RegistrationDetail } from "../components/RegistrationDetail";
import { PaymentStatusBadge } from "../components/StatusBadge";

const PAY_FILTERS = ["all", "pending", "paid", "refunded", "failed"] as const;
const peso = (c: number) => `₱${(c / 100).toLocaleString()}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function Registrations() {
  const roles = useMyRoles();
  const orgId = roles.data?.orgId ?? undefined;
  const events = useOrgEvents(orgId);
  const counts = useEventRegistrationCounts(orgId);
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const eventId = params.get("event") ?? events.data?.[0]?.id ?? undefined;

  const t = useTableParams({ sort: [{ id: "created_at", desc: true }] });
  const status = (t.filters.status ?? "all") as PaymentStatus | "all";
  const categoryId = t.filters.category ?? "all";
  const selectedId = t.filters.reg ?? null;

  const editor = useEventForEditor(eventId);
  const regs = useEventRegistrations(eventId, { page: t.page, sort: t.sort, status, categoryId, q: t.q });

  // Category ids are per-event, so a stale category filter would silently return
  // zero rows after switching events. Clear it, and any open detail, on change.
  useEffect(() => {
    t.setFilter("category", "all");
    t.setFilter("reg", "all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const rows = regs.data?.rows ?? [];
  const total = regs.data?.total ?? 0;
  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  const columns = useMemo<ColumnDef<RegistrationRow, unknown>[]>(() => [
    {
      accessorKey: "full_name",
      header: "Runner",
      cell: ({ row }) => (
        <div>
          <div className="text-sm font-semibold">{row.original.full_name ?? "—"}</div>
          {row.original.bib_name ? <div className="text-xs text-muted-foreground">{row.original.bib_name}</div> : null}
        </div>
      ),
    },
    { accessorKey: "category_label", header: "Category", cell: ({ row }) => row.original.category_label ?? "—" },
    { accessorKey: "total_amount", header: "Amount", cell: ({ row }) => peso(row.original.total_amount) },
    { accessorKey: "payment_status", header: "Payment", cell: ({ row }) => <PaymentStatusBadge status={row.original.payment_status} /> },
    { accessorKey: "created_at", header: "Registered", cell: ({ row }) => fmtDate(row.original.created_at) },
  ], []);

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={eventId ?? ""} onValueChange={(v) => setParams({ event: v })}>
          <SelectTrigger aria-label="Event" className="w-[260px]"><SelectValue placeholder="Pick an event" /></SelectTrigger>
          <SelectContent>
            {(events.data ?? []).map((ev) => (
              <SelectItem key={ev.id} value={ev.id}>
                {ev.name}{counts.data?.[ev.id] != null ? ` (${counts.data[ev.id]})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={(v) => t.setFilter("status", v)}>
          <SelectTrigger aria-label="Payment status" className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PAY_FILTERS.map((f) => (
              <SelectItem key={f} value={f}>{f === "all" ? "All payments" : f.charAt(0).toUpperCase() + f.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={categoryId} onValueChange={(v) => t.setFilter("category", v)}>
          <SelectTrigger aria-label="Category" className="w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {(editor.data?.categories ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search name" placeholder="Search name…" className="w-[200px] pl-8"
            defaultValue={t.q} onChange={(e) => t.setQ(e.target.value)} />
        </div>
      </div>

      {!eventId ? (
        <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          Pick an event to see its registrations.
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          isLoading={regs.isLoading}
          isError={regs.isError}
          onRetry={() => regs.refetch()}
          messages={{ loading: "Loading registrations…", empty: "No registrations match.", error: "Couldn't load registrations." }}
          onRowClick={(r) => t.setFilter("reg", r.id)}
          server={{
            pageIndex: t.page - 1,
            pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
            totalRows: total,
            onPageChange: (i) => t.setPage(i + 1),
            sorting: t.sort,
            onSortingChange: t.setSort,
          }}
        />
      )}

      {selected ? (
        <RegistrationDetail
          row={selected}
          onClose={() => t.setFilter("reg", "all")}
          onRefunded={() => {
            t.setFilter("reg", "all");
            regs.refetch();
            counts.refetch();
            qc.invalidateQueries({ queryKey: ["org-events"] });
          }}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Rewrite `RegistrationDetail` as a shadcn `Sheet`**

Generate nothing new — `sheet` came with Task 3. Add-ons now come from the new hook.

```tsx
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useRegistrationAddons, type RegistrationRow } from "../lib/registrations";
import { PaymentStatusBadge } from "./StatusBadge";
import { RefundModal } from "./RefundModal";

const peso = (c: number) => `₱${(c / 100).toLocaleString()}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

export function RegistrationDetail({ row, onClose, onRefunded }: {
  row: RegistrationRow; onClose: () => void; onRefunded: () => void;
}) {
  const [refunding, setRefunding] = useState(false);
  const addons = useRegistrationAddons(row.id);
  const canRefund = row.payment_status === "paid";
  const customEntries = Object.entries(row.custom_data ?? {});

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-[420px] max-w-full flex-col gap-3.5 overflow-y-auto">
        <SheetHeader className="p-0">
          <SheetTitle className="text-lg font-bold">{row.full_name ?? "—"}</SheetTitle>
          {row.bib_name ? <div className="text-[13px] text-muted-foreground">{row.bib_name}</div> : null}
        </SheetHeader>

        <div className="grid gap-2.5">
          <Row label="Category" value={row.category_label ?? "—"} />
          <Row label="Amount" value={peso(row.total_amount)} />
          <Row label="Payment" value={<PaymentStatusBadge status={row.payment_status} />} />
          {row.payment_method ? <Row label="Method" value={row.payment_method} /> : null}
          <Row label="Registered" value={fmtDate(row.created_at)} />
        </div>

        {addons.data?.length ? (
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Add-ons</div>
            {addons.data.map((a, i) => <Row key={i} label={a.name ?? "—"} value={peso(a.price)} />)}
          </div>
        ) : null}

        {customEntries.length ? (
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Registration fields</div>
            {customEntries.map(([k, v]) => <Row key={k} label={k} value={String(v)} />)}
          </div>
        ) : null}

        <div className="mt-auto flex justify-end">
          <Button
            variant={canRefund ? "destructive" : "secondary"}
            className="rounded-pill"
            disabled={!canRefund}
            onClick={() => setRefunding(true)}
          >
            {row.payment_status === "refunded" ? "Refunded" : "Refund"}
          </Button>
        </div>

        {refunding ? (
          <RefundModal
            registration={{ id: row.id, full_name: row.full_name, total_amount: row.total_amount }}
            onClose={() => setRefunding(false)}
            onDone={onRefunded}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 6: Update `registrations.test.tsx` and `registration-detail.test.tsx`**

For `registrations.test.tsx`: mock `useEventRegistrations` to return `{ data: { rows, total }, isLoading: false, isError: false, refetch }`, mock `useEventForEditor` to return categories, and keep the existing intents — rows render, the roster is scoped to the selected event, filters reach the query. Convert `fireEvent.change` on the three selects to `userEvent.click` + `getByRole("option", …)`, and assert against the mocked hook's last call rather than counting rendered rows.

For `registration-detail.test.tsx`: wrap the render in a `QueryClientProvider` (the drawer now issues its own add-ons query), mock `useRegistrationAddons` to return a fixed list, and change the container assertion from the old `aside` markup to `getByRole("dialog")`. The refund-button-disabled-unless-paid assertion is unchanged.

- [ ] **Step 7: Run the suite**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: green, typecheck clean. Report the real count.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): Registrations on server-side paging + Sheet detail drawer"
```

---

### Task 8: Events and Team on the client DataTable

**Files:**
- Modify: `apps/web/src/routes/Events.tsx`, `apps/web/src/routes/Team.tsx`
- Test: `apps/web/src/__tests__/events.test.tsx`, `events-actions.test.tsx`, `events-registrations.test.tsx`, `team-page.test.tsx`

**Interfaces:**
- Consumes: `DataTable` (client mode), `EventStatusBadge`, shadcn `DropdownMenu`, `Select`, `Button`, `AlertDialog`.
- Produces: nothing new.

- [ ] **Step 1: Generate the alert dialog**

```bash
cd apps/web && pnpm dlx shadcn@latest add alert-dialog
```

- [ ] **Step 2: Rewrite `src/routes/Events.tsx`**

Keep `fill()`, `fmtDate()`, and the modal wiring exactly as they are. Replace the grid with a `DataTable` in client mode and the `⋯` menu with `DropdownMenu`:

```tsx
const columns = useMemo<ColumnDef<AdminEventRow, unknown>[]>(() => [
  {
    accessorKey: "name",
    header: "Event",
    cell: ({ row }) => {
      const e = row.original;
      const place = formatAddress({ city_name: e.city_name, province_name: e.province_name }) || e.place;
      return (
        <div>
          <div className="text-sm font-semibold">{e.name}</div>
          {place ? <div className="text-xs text-muted-foreground">{place}</div> : null}
        </div>
      );
    },
  },
  {
    accessorKey: "event_date",
    header: "Date",
    cell: ({ row }) => {
      const e = row.original;
      return (
        <span>
          {e.event_date ? formatDateRange(e.event_date, e.end_date, fmtDate) : "—"}
          {e.original_date ? <span className="text-xs text-info"> · was {fmtDate(e.original_date)}</span> : null}
        </span>
      );
    },
  },
  { accessorKey: "status", header: "Status", cell: ({ row }) => <EventStatusBadge status={row.original.status} /> },
  { id: "categories", header: "Categories", cell: ({ row }) => row.original.categories.length },
  { id: "fill", header: "Fill", cell: ({ row }) => fill(row.original.categories) },
  { id: "regs", header: "Regs", cell: ({ row }) => counts.data?.[row.original.id] ?? 0 },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => {
      const e = row.original;
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${e.name}`}>⋯</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => nav(`/events/${e.id}/edit`)}>Edit</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => nav(`/registrations?event=${e.id}`)}>View registrations</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setModal({ kind: "reschedule", ev: e })}>Reschedule</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onSelect={() => setModal({ kind: "cancel", ev: e })}>
              Cancel event
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
], [counts.data, nav]);
```

Render it with the "+ Create event" button above:

```tsx
<div className="px-4 pb-10 pt-6 md:px-[30px]">
  <div className="mb-4 flex justify-end">
    <Button className="rounded-pill" onClick={() => nav("/events/new")}>+ Create event</Button>
  </div>
  <DataTable
    columns={columns}
    data={data ?? []}
    isLoading={isLoading}
    isError={isError}
    onRetry={() => refetch()}
    messages={{ loading: "Loading events…", empty: "No events yet.", error: "Couldn't load events." }}
  />
  {/* modals unchanged */}
</div>
```

Delete the local `GRID`, `cardStyle`, `theadStyle`, `menuItem`, and `Wrap` constants, and the `menuId` state the old menu needed.

- [ ] **Step 3: Rewrite `src/routes/Team.tsx`**

Member list becomes a `DataTable` in client mode with a role `Select` and a Remove button per row; `pendingRemove` becomes an `AlertDialog`. Keep `changeRole`, `confirmRemove`, `refresh`, and the `isOrgAdmin` guard exactly as they are, and keep the `aria-label`s (`Role for {email}`, `Remove {email}`) so the existing tests keep their queries. Replace the inline `role="dialog"` block with:

```tsx
<AlertDialog open={!!pendingRemove} onOpenChange={(o) => { if (!o) { setPendingRemove(null); setRowError(null); } }}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Remove this member?</AlertDialogTitle>
      <AlertDialogDescription>
        {pendingRemove?.email} loses access to this organization. Their account isn't deleted.
      </AlertDialogDescription>
    </AlertDialogHeader>
    {rowError ? <div role="alert" className="text-[13px] text-destructive">{rowError}</div> : null}
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={confirmRemove}>
        Remove member
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

Add a toast on success in `changeRole` and `confirmRemove`:

```ts
import { toast } from "sonner";
// on success:
toast.success("Role updated");   // changeRole
toast.success("Member removed"); // confirmRemove
```

- [ ] **Step 4: Update the four affected tests**

- `events.test.tsx`: the three state assertions (`No events yet.`, `Loading events…`, `Couldn't load events.`) and the `4/15` fill are unchanged. Add `expect(screen.getByRole("columnheader", { name: /Event/ })).toBeInTheDocument()`.
- `events-registrations.test.tsx:17`: `getByLabelText("Actions for Apo Sky Ultra")` still resolves — it is now the `DropdownMenuTrigger`. Switch the click to `userEvent.click` and `await` the menu item, since Radix renders the content in a portal after an animation frame.
- `events-actions.test.tsx`: `getByLabelText("Cancel note")` is unchanged (Task 9 converts the modal); only the path to open it changes, same as above.
- `team-page.test.tsx`: convert the role `<select>` interaction to `userEvent.click` + `getByRole("option")`, and change the remove-confirmation query to `getByRole("alertdialog")`.

- [ ] **Step 5: Run the suite**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: green, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): Events and Team on the shared DataTable"
```

---

### Task 9: Dialogs — cancel, reschedule, refund

**Files:**
- Modify: `apps/web/src/components/CancelModal.tsx`, `RescheduleModal.tsx`, `RefundModal.tsx`
- Test: `apps/web/src/__tests__/events-actions.test.tsx`, `registration-detail.test.tsx`

**Interfaces:**
- Consumes: shadcn `Dialog`, `Button`, `Input`, `Label`; `toast` from sonner.
- Produces: unchanged props on all three components — `{ event | registration, onClose, onDone }`.

- [ ] **Step 1: Generate the remaining form primitives**

```bash
cd apps/web && pnpm dlx shadcn@latest add dialog label textarea form card
```

- [ ] **Step 2: Rewrite `CancelModal` on `Dialog`**

The `cancelEvent` call, the `busy`/`error` states, and the `aria-label="Cancel note"` are unchanged.

```tsx
import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cancelEvent } from "../lib/eventWrites";

export function CancelModal({ event, onClose, onDone }: { event: { id: string; name: string }; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setError(null);
    const { error } = await cancelEvent(event.id, note);
    setBusy(false);
    if (error) { setError(error); return; }
    toast.success(`"${event.name}" cancelled`);
    onDone();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[380px]">
        <DialogHeader>
          <DialogTitle>Cancel “{event.name}”?</DialogTitle>
          <DialogDescription>Registrations are kept; refunds are handled from Payments.</DialogDescription>
        </DialogHeader>
        <Input aria-label="Cancel note" placeholder="Reason (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        {error ? <span role="alert" className="text-[13px] text-destructive">{error}</span> : null}
        <DialogFooter>
          <Button variant="outline" className="rounded-pill" onClick={onClose}>Keep it</Button>
          <Button variant="destructive" className="rounded-pill" disabled={busy} onClick={submit}>
            {busy ? "Cancelling…" : "Cancel event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Rewrite `RescheduleModal` on `Dialog`**

Same structure. Keep the `/^\d{4}-\d{2}-\d{2}$/` guard, the `rescheduleEvent(event.id, event.event_date, event.end_date, date, note)` call signature, and the `aria-label`s `New date` and `Note`. Add `toast.success("Event rescheduled")` after a successful save.

- [ ] **Step 4: Rewrite `RefundModal` on `Dialog`**

Keep the `refundRegistration(registration.id, note || undefined)` call, the `aria-label="Refund note"` and `aria-label="Confirm refund"` attributes, and the peso heading. Add `toast.success(\`Refunded ${peso}\`)` after success. **Do not change any refund logic** — this is the money path.

- [ ] **Step 5: Update the two affected tests**

Both already open the modals through the UI. Change container queries to `getByRole("dialog")`, and wrap interactions in `userEvent` so Radix's portal has mounted. The assertions — that `cancelEvent` is called with the typed note, that a failed refund surfaces its error, that the refund button is disabled unless `payment_status === "paid"` — are unchanged.

- [ ] **Step 6: Run the suite**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: green, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): cancel, reschedule and refund modals on shadcn Dialog + toasts"
```

---

### Task 10: Editor forms

**Files:**
- Modify: `apps/web/src/routes/EventEditor.tsx`, `apps/web/src/components/PsgcAddressField.tsx`, `CategoryEditor.tsx`, `AddonEditor.tsx`, `EventImagesEditor.tsx`, `CropUploader.tsx`, `InviteMemberForm.tsx`
- Test: `event-editor.test.tsx`, `events-address.test.tsx`, `psgc-address-field.test.tsx`, `event-images-editor.test.tsx`, `invite-member-form.test.tsx`, `image-upload.test.ts`

**Interfaces:**
- Consumes: shadcn `Card`, `Input`, `Textarea`, `Label`, `Select`, `Button`, `Dialog`; `toast`.
- Produces: unchanged public props on every component.

> **Constraint reminder:** the `DATE`, `END DATE`, and `FLAG-OFF` inputs stay native `<input type="date">` / `type="time"`, styled with the shadcn `Input` classes. `event-editor.test.tsx:129-132` asserts `.type`, and those assertions must keep passing unmodified.

- [ ] **Step 1: Convert `EventEditor` layout and fields**

Replace the two `card` divs with `<Card>`/`<CardHeader>`/`<CardContent>`, every `<input>` with `<Input>`, the description `<textarea>` with `<Textarea>`, each `<span style={label}>` with `<Label>`, and the STATUS `<select>` with a shadcn `<Select>` over `EVENT_STATUSES`. Keep `blank`, the seed `useEffect`, `invalid`, and the whole of `onSave` — including the create-mode navigate-with-`childErrors` branch — untouched. Convert the two footer buttons to `<Button>` with `className="rounded-pill"`, and surface a `toast.error` alongside the existing inline `error` text on a failed save.

- [ ] **Step 2: Convert `PsgcAddressField` to three shadcn `Select`s**

Keep every hook call, the `seeded` ref, `noProvinces`, and the three `pick*` functions byte-for-byte. Only the three `<select>` elements change. Radix requires a non-empty `value` on every item, so the "— Select —" placeholder becomes `<SelectValue placeholder="— Select —" />` on the trigger rather than an `<option value="">`:

```tsx
<div>
  <Label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-muted-foreground">REGION</Label>
  <Select value={regionCode || undefined} onValueChange={pickRegion}>
    <SelectTrigger aria-label="Region"><SelectValue placeholder="— Select —" /></SelectTrigger>
    <SelectContent>
      {(regions.data ?? []).map((r) => <SelectItem key={r.code} value={r.code}>{r.name}</SelectItem>)}
    </SelectContent>
  </Select>
</div>
```

Province and City follow the same shape, keeping their `disabled` conditions (`!regionCode || noProvinces` and `!(provinceCode || noProvinces)`) on `SelectTrigger`, and City keeping `value={value?.city_psgc_code ?? undefined}`.

- [ ] **Step 3: Convert `CategoryEditor` and `AddonEditor`**

Wrap each in `<Card>`, swap `<input>` for `<Input>`, and make the `+ Add` and `×` controls `<Button variant="ghost">`. Keep every `aria-label` (`Category code`, `Category label`, `Distance km`, `Base price`, `Slots`, `Remove category`, and the add-on equivalents), the `peso`/`cent` conversion helpers, and the `key={r.id ?? r.tempId}` identity.

- [ ] **Step 4: Convert `EventImagesEditor` and `CropUploader`**

`EventImagesEditor`: `<Card>` + `<Button>`; keep the `Add images`, `Featured image`, and `Remove image` labels and their disabled logic — `event-images-editor.test.tsx` asserts on all three. `CropUploader`: move the cropping UI inside a `<Dialog>` triggered by a `<Button>`; keep `react-easy-crop`, the `cropImage` call, and the `onSaved` callback unchanged, and add `toast.success("Branding updated")` on save.

- [ ] **Step 5: Convert `InviteMemberForm`**

Role `<select>` becomes a shadcn `<Select>` over `ASSIGNABLE_ROLES`/`ROLE_LABELS`; the email field becomes `<Input>`; submit becomes `<Button type="submit">`. Keep `inviteMember(orgId, email.trim(), role)`, the `role="alert"` error element, and the default role `"editor"`.

- [ ] **Step 6: Update the affected tests**

`invite-member-form.test.tsx:15` is the one hard change:

```tsx
const user = userEvent.setup();
await user.type(screen.getByLabelText("Invite email"), "crew@x.com");
await user.click(screen.getByLabelText("Role"));
await user.click(screen.getByRole("option", { name: "Marshal" }));
await user.click(screen.getByRole("button", { name: /invite/i }));
await waitFor(() => expect(inviteMember).toHaveBeenCalledWith("a1", "crew@x.com", "marshal"));
```

`psgc-address-field.test.tsx` and `events-address.test.tsx`: same conversion for Region/Province/City, asserting the same emitted `PsgcAddress` payloads. `event-editor.test.tsx`: the Status select converts the same way; **every other query stays as-is**, including the four `.type` assertions.

- [ ] **Step 7: Run the suite**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: green, typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): event editor, sub-editors and invite form on shadcn form primitives"
```

---

### Task 11: Login, Settings, and cleanup

The last inline styles go, along with the legacy token block.

**Files:**
- Modify: `apps/web/src/routes/Login.tsx`, `Settings.tsx`, `NoAccess.tsx`, `Placeholder.tsx`, `apps/web/src/App.tsx:18-21`, `apps/web/src/index.css`
- Test: `apps/web/src/__tests__/auth.test.tsx`, `settings-branding.test.tsx`, `smoke.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–10.
- Produces: zero `style={{` occurrences in `apps/web/src`.

- [ ] **Step 1: Convert `Login.tsx`**

`<Card>` wrapper, `<Label>`/`<Input>` fields, `<Button className="w-full rounded-pill">`. Keep the `aria-label="Email"` / `aria-label="Password"` attributes and the show/hide toggle's `role="switch"` + `aria-label="Show password"` — `auth.test.tsx:11-12` depends on the first two. Keep the `useEffect` redirect and `signIn(email.trim(), password)`.

- [ ] **Step 2: Convert `Settings.tsx`, `NoAccess.tsx`, `Placeholder.tsx`, and the two `RequireAdmin` loading divs**

Straight class swaps: `var(--ink-muted)` → `text-muted-foreground`, `var(--danger)` → `text-destructive`, and so on. `Settings.tsx` keeps its `role="alert"` error branch, which `settings-branding.test.tsx` asserts.

- [ ] **Step 3: Prove no inline styles survive**

Run:

```bash
grep -rn "style={{" apps/web/src --include=*.tsx | grep -v "/ui/"
```

Expected: **no output.** Anything printed must be converted before continuing.

- [ ] **Step 4: Prove no legacy token survives**

Run:

```bash
grep -rnE "var\(--(ink|canvas|parchment|surface|hairline|row-border|section|danger|nav-active)" apps/web/src
```

Expected: **no output.**

- [ ] **Step 5: Delete the legacy block from `src/index.css`**

Remove the entire `/* LEGACY … */` `:root { … }` block added in Task 1, Step 6.

- [ ] **Step 6: Run everything**

```bash
pnpm --filter web test
pnpm --filter web typecheck
pnpm test
pnpm -r typecheck
```

Expected: both suites green. Report the actual numbers — web should be well above the original 51, backend 55.

- [ ] **Step 7: Browser verification, light and dark**

Start the app and walk every route at `https://admin.racepace.lan`, toggling the theme on each: `/events`, `/events/new`, an existing `/events/:id/edit`, `/registrations`, `/payments`, `/team`, `/settings`, `/login`, `/no-access`. At each: no horizontal overflow, no unreadable contrast, no invisible focus ring. Then resize to a tablet width and confirm the sidebar collapses into the Sheet drawer.

Exercise paging for real against the hosted data (20 events across 2 orgs, seeded outside `seed.sql`): page through Payments, sort by Amount, search a runner name, and confirm the URL carries `page`/`sort`/`q` and that a reload restores the same view.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): convert Login, Settings and shells; drop the legacy token block"
```

- [ ] **Step 9: Open the PR**

```bash
git push -u origin worktree-web-shadcn-migration
gh pr create --title "Admin web: migrate to shadcn/ui + Tailwind v4" --body "$(cat <<'EOF'
Re-platforms `apps/web` onto shadcn/ui + Tailwind v4, preserving the getdesign handover look, and moves Payments and Registrations onto server-driven tables.

**Spec:** `docs/superpowers/specs/2026-08-04-web-shadcn-migration-design.md`
**Plan:** `docs/superpowers/plans/2026-08-04-web-shadcn-migration.md`

- Token contract now shared with `apps/mobile` (light + dark)
- Collapsible sidebar with lucide icons, dark-mode toggle, sonner toasts
- One `DataTable` replaces four hand-rolled CSS-grid tables
- New security-invoker views `admin_payments_v`, `admin_registrations_v`, `admin_event_reg_counts_v` — needed because `registrations.user_id` references `auth.users`, not `profiles`, so PostgREST could not sort or search by runner name
- Removes the N+1 profile lookup on both list screens

Review commit-by-commit; each commit is independently green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| §4 Token contract, legacy tokens deleted | 1 (declared), 11 (legacy removed) |
| §4 Dark mode mechanics | 1 (no-flash script), 3 (toggle) |
| §5 Tier 1 primitives | 1–2 (badge), 3 (shell), 5 (table), 8–10 (forms) |
| §5 Tier 2 domain components | 2, 3, 7, 9, 10 |
| §5 Tier 3 DataTable | 5 (built), 6–8 (adopted) |
| §6 Views + RLS caution | 4 |
| §6 Resulting hooks, N+1 removal | 6, 7 |
| §6 URL as state | 5 (`useTableParams`), 6–7 (adopted) |
| §7 Icons, collapsible sidebar, toasts, dark mode | 3, plus toasts in 8–10 |
| §8 Existing test breakage | 2, 3, 6–11 |
| §8 New tests | 4, 5, 3 (theme) |
| §9 Commit sequence | Tasks map 1:1, with the spec's commits 4 and 6 split for right-sizing |
| §9 Verification | 11 steps 3–7 |

No gap found.

**Type consistency**

`SortState` is defined once in `DataTable.tsx` and re-exported through `useTableParams`; both use `{ id, desc }`. `PAGE_SIZE` is declared once in `registrations.ts` (Task 6) and imported by Task 7's hook and both routes. `ServerPaging` field names match between the Task 5 definition and the Task 6/7 call sites. `PaymentRow` is unchanged throughout; `RegistrationRow` loses `addons` in Task 7, which is why `useRegistrationAddons` is introduced in the same task and `RegistrationDetail` is rewritten there rather than in Task 9.

**Known ordering hazard**

Task 2 removes `PaymentBadge` while `Payments.tsx` and `Registrations.tsx` still render their old grids — Step 6 of that task updates all four call sites in the same commit, so the tree never references a deleted module.

---

Plan complete and saved to `docs/superpowers/plans/2026-08-04-web-shadcn-migration.md`. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
