# Admin Web → shadcn/ui Migration

**Status:** Approved, ready for implementation plan
**Scope:** `apps/web` (admin console) — full UI re-platform onto shadcn/ui + Tailwind v4, plus **one Supabase migration** adding two read-only views. **No `apps/mobile` changes.**
**Branch:** `worktree-web-shadcn-migration` — one branch, one PR, sequential green commits (§9)

## 1. Goals

Re-platform every UI surface in `apps/web` onto [shadcn/ui](https://ui.shadcn.com) while **preserving the current visual design**, and add real server-driven tables where the data actually grows.

1. **Every component** runs on shadcn primitives — sidebar, buttons, tables, dialogs, selects, inputs, badges, pagination.
2. **The look is preserved.** A before/after screenshot of any route in light mode should read as the same design. This is a structural migration, not a redesign.
3. **Server-side tables** — Payments and Registrations paginate, sort, and filter against Postgres instead of fetching every row.
4. **Dark mode** arrives, using the palette `apps/mobile` already ships.
5. **One token vocabulary** shared with mobile.

## 2. Non-goals

- **No redesign.** Spacing, density, type scale, and color stay as they are. Where shadcn's default geometry differs from the current handover styling, the token/CVA variant is adjusted to match the handover — not the reverse.
- **No new admin features.** Dashboard, Check-in, Organizations, Commission, and Payouts stay `<Placeholder>` stubs. Plans 14/15/16 are unaffected.
- **No business-logic changes.** The money path, RLS-gated event writes, one-Save child reconcile, and the refund flow are presentation-only refactors. `supabase/functions` is untouched.
- **No date/time picker swap.** Plan 12 deliberately chose native `<input type="date">` / `type="time"`. shadcn's Calendar+Popover is a different UX and stays out of scope. `event-editor.test.tsx` continues to assert `.type === "date"`.
- **No mobile changes.** `apps/mobile` stays on Tailwind v3 + NativeWind. Only its `global.css` is *read*, as the source of truth for token values.
- **No schema change to `registrations`.** Adding a real FK from `registrations.user_id` to `profiles` would make PostgREST embedding work, but it touches the money path. Views solve the same problem without that risk (§6).

## 3. Starting state

Measured on `2026-08-04`:

| Fact | Value |
|---|---|
| UI source | 23 files, ~1,311 LOC across `src/components` + `src/routes` |
| Tests | 23 files, ~1,016 LOC in `src/__tests__` |
| Styling | **No Tailwind.** 22-line `src/theme.css` of CSS variables + 204 inline `style={{}}` objects, 1 `className` |
| Tables | 4 hand-rolled CSS-grid `<div>` layouts driven by `GRID = "2.4fr 1.1fr …"` template strings. No `<table>` element anywhere |
| Pagination | **None.** No `.range()`, no `.limit()`, no `count` in `src/lib/*` |
| Component library | None. Only `react-easy-crop` (used by `CropUploader`) |
| Dark mode | None |

The current palette encodes the getdesign "apple" handover — trail-green `#159A55`, pill radii, SF type stack — and was matched deliberately (see the `// mirrors the handover's statusChip` comment in `src/routes/Events.tsx`).

## 4. The token contract

**Key finding:** `apps/mobile/global.css` already defines shadcn's exact variable names — `--background`, `--foreground`, `--card`, `--popover`, `--muted`, `--secondary`, `--accent`, `--primary`, `--border`, `--input`, `--ring`, `--destructive` — in **both `:root` and `.dark`**. React Native Reusables *is* shadcn for React Native, so the mobile RNR migration already established this contract.

Consequences:

- Dark mode needs **no invented values**. `--background: 11 15 13`, `--primary: 47 181 106` (trail-green lightened for dark surfaces), and the full status-tint set ship in mobile today.
- Web adopts the same names and values, so the two apps stop maintaining parallel vocabularies (`--ink`/`--canvas`/`--parchment` vs `--foreground`/`--card`/`--muted`).

**`apps/mobile/global.css` is the source of truth for token values.** Any change to a shared token must be applied to both files in the same commit, so drift shows up as a reviewable diff.

### Format

Mobile is Tailwind v3 with space-separated RGB channels (`255 255 255`). Web is Tailwind v4, which is CSS-first. The **values and names are identical**; only the declaration syntax differs. `src/index.css` replaces `src/theme.css`:

```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));

:root { --background: 255 255 255; --primary: 21 154 85;  /* … copied from mobile … */ }
.dark { --background: 11 15 13;    --primary: 47 181 106; /* … copied from mobile … */ }

@theme inline {
  --color-background: rgb(var(--background));
  --color-primary:    rgb(var(--primary));
  /* … one mapping per token … */
}
```

Opacity modifiers (`bg-primary/50`) work because Tailwind v4 composes opacity with `color-mix()`, which accepts any valid CSS color.

### Legacy tokens are deleted, not aliased

`--ink`, `--ink-muted`, `--ink-subtle`, `--ink-faint`, `--section`, `--canvas`, `--parchment`, `--surface`, `--nav-active`, `--hairline`, `--divider`, `--row-border`, `--radius`, `--radius-card`, `--radius-pill` are **removed**. Keeping both vocabularies would let new code drift back onto the old one.

Non-shadcn tokens with no shadcn equivalent carry over under their existing names, because mobile already defines them: `--paid`/`--paid-tint`, `--info`/`--info-tint`, `--amber`/`--amber-tint`, `--destructive-tint`, `--forest`.

### Dark mode mechanics

`class` strategy on `<html>`. Toggle lives in the sidebar footer next to Sign out. Persisted to `localStorage` under `rp-theme`; falls back to `prefers-color-scheme` when unset. Applied before first paint via a small inline script in `index.html` to avoid a flash.

## 5. Architecture — three tiers

**Tier 1 · `src/components/ui/*` — unmodified shadcn primitives.**
Generated by `npx shadcn@latest add`, never hand-edited, so future `add`/diff stays clean. Initial set: `button`, `table`, `dialog`, `select`, `input`, `textarea`, `label`, `badge`, `card`, `sidebar`, `sheet`, `separator`, `avatar`, `dropdown-menu`, `pagination`, `skeleton`, `form`, `sonner`, `alert`. Nothing is installed speculatively — a primitive is added when a component needs it.

Where a primitive's default geometry differs from the handover, the difference is expressed as a **CVA variant or token value**, never by editing the primitive's internals.

**Tier 2 · `src/components/*` — domain components composing Tier 1.**

| Today | Becomes |
|---|---|
| `Sidebar` (79 LOC, placeholder-square icons) | shadcn `Sidebar` block: `SidebarProvider`/`SidebarMenu`/`SidebarRail`, lucide icons, collapsible, `Sheet` on mobile. Role-gating logic unchanged |
| `TopBar` | `SidebarTrigger` + route title + org `<Badge>` + theme toggle |
| `StatusChip` (in `Events.tsx`), `PaymentBadge` | one `<Badge>` with CVA variants bound to `--paid` / `--amber` / `--info` / `--destructive` tints |
| `RescheduleModal`, `CancelModal`, `RefundModal`, `RegistrationDetail` | `<Dialog>` + `<Form>` (react-hook-form over the existing zod schemas in `src/lib/validation.ts`) |
| `PsgcAddressField` | three dependent `<Select>`s; Region→Province→City cascade logic unchanged |
| `CropUploader` | `<Dialog>` wrapper; `react-easy-crop` stays as-is |
| `CategoryEditor`, `AddonEditor`, `EventImagesEditor` | `<Card>` + `<Input>` + `<Button>`; one-Save child reconcile untouched |
| raw `<select>` / `<input>` filter bars | `<Select>` + `<Input>` with a lucide search icon |
| silent mutation outcomes | `<Toaster />` (sonner) + `toast.success` / `toast.error` |

**Tier 3 · `src/components/DataTable.tsx` — one generic table.**
TanStack Table v8 + shadcn `<Table>` + `<Pagination>`. Two modes:

- **Manual (server-driven)** — Payments, Registrations. `manualPagination`, `manualSorting`, `manualFiltering`; `pageCount` derived from the server `count`.
- **Client** — Events, Team. Bounded row counts; sorting and paging in the browser.

One component owns loading, empty, and error states for all four tables, replacing four copies of `emptyStyle` / `Loading …` / `Couldn't load` markup. Column definitions live per-route.

## 6. Data layer

### The problem

Server-side sorting and filtering **cannot** be pushed to PostgREST against the current schema:

- `supabase/migrations/20260718183018_registrations_payments.sql:6` declares `user_id uuid not null references auth.users(id)` — it references `auth.users`, **not `profiles`**. There is no FK path from a registration to a profile, which is exactly why `useEventRegistrations` and `usePayments` both issue a second `.in()` query against `profiles` and stitch names together in JS.
- `usePayments` additionally needs `event_name` two levels deep (`payments → registrations → events`), where PostgREST ordering on nested embedded resources does not work.

So `.order()` and `.ilike()` on **runner name or event name** — the two things admins actually sort and search by — are unavailable. Paginating without fixing this would produce tables you can only sort within the current page, which is worse than today's fetch-all.

### The fix — two security-invoker views

One migration, `supabase/migrations/<ts>_admin_list_views.sql`:

- **`admin_payments_v`** — `registration_id, org_id, event_id, event_name, user_id, full_name, amount, platform_fee, net_to_org, method, status, created_at`
- **`admin_registrations_v`** — `id, event_id, org_id, user_id, full_name, bib_name, category_id, category_label, total_amount, payment_status, payment_method, created_at`

Both declared `with (security_invoker = true)`, so the **existing** org-scoped RLS on `payments`, `registrations`, `events`, `categories`, and `profiles` still governs every read. The views add no new read surface — they only flatten joins the client was already performing.

`grant select` to `authenticated` only. No `insert`/`update`/`delete` grants.

> **RLS caution.** `20260724140000_scope_org_update_grant.sql` exists because hosted `organizations` had table-level grant drift. When adding these views, verify effective privileges on the hosted DB rather than assuming the migration's grants are the whole story.

### Resulting hooks

`usePayments(orgId, { page, pageSize, sort, status, q })` and `useEventRegistrations(eventId, { page, pageSize, sort, status, categoryId, q })` each become **one** query against their view with `.range()`, `.order()`, `.ilike()`, and `{ count: "exact" }`. The N+1 profile lookup disappears — it was only ever compensating for the missing join.

`useOrgEvents` and `useOrgMembers` are unchanged; those lists are bounded per org and stay client-side.

### URL as state

Page, sort, filters, and search live in the query string via `useSearchParams`, so an admin can share a link to a filtered roster. `Registrations` already reads `?event=` this way — the same mechanism extends to the rest. Search input is debounced 300 ms before it reaches the query key.

## 7. Behavioral additions

Approved during brainstorming, in scope for this PR:

- **Real lucide icons** in the sidebar, replacing the colored placeholder `<span>` squares at `src/components/Sidebar.tsx:31`.
- **Collapsible + responsive sidebar** — rail collapse on desktop, `Sheet` drawer below `md`, state persisted. The admin becomes usable on a tablet, which it currently is not.
- **Toasts** for save, refund, cancel, reschedule, and invite outcomes, which today succeed or fail with inline text or silently.
- **Dark mode** (§4).

## 8. Testing

### Existing tests

Most of the 23 files query by visible text and survive untouched. Breakage is specific:

- **Radix `Select` replaces native `<select>`.** `src/__tests__/invite-member-form.test.tsx:15` does `fireEvent.change(getByLabelText("Role"), …)`, which has no meaning without a native select. Same pattern in the Payments and Registrations filter bars and `psgc-address-field.test.tsx`. These convert to `userEvent.click` + `getByRole("option")`.
- **jsdom polyfills** required in `vitest.setup.ts` (currently one line): `ResizeObserver`, `matchMedia`, `Element.prototype.scrollIntoView`, `hasPointerCapture`, `releasePointerCapture`.
- **Dialogs portal**, so modal assertions move to `getByRole("dialog")`.
- **Real `<table>` semantics** allow `getByRole("row")` / `getByRole("columnheader")` where tests currently match raw text.

Test *intent* is preserved in every case. A test asserting "shows the empty state when there are no events" keeps asserting exactly that.

### New tests

- `DataTable`: paging controls, sort toggling, empty/loading/error states.
- `usePayments` / `useEventRegistrations`: assert `.range()` bounds and `count: "exact"` reach the client for a given page, and that filter/search values become query params rather than client-side `.filter()`.
- Theme toggle: persists to `localStorage`, applies `.dark` to `<html>`.
- Sidebar: collapse state, and that `/team` stays hidden for non-org-admins (existing `sidebar.test.tsx` behavior).
- **`supabase/tests/admin-list-views.test.ts`** — org B, authenticated, reads `admin_payments_v` and `admin_registrations_v` scoped to org A and receives **zero rows and a zero `count`**. The `count` assertion matters specifically: an exact count leaking pre-RLS totals would disclose another org's volume even with rows hidden.

## 9. Commit sequence

One branch, one PR. Each commit keeps `pnpm test` (web + backend) and `tsc --noEmit` green, so the PR is reviewable and bisectable commit-by-commit.

1. **Foundation** — Tailwind v4 + `@tailwindcss/vite`, `shadcn init`, `@/*` alias, `cn()`, token contract in `src/index.css`, jsdom polyfills. No UI changes.
2. **Shell** — `AppShell` / `Sidebar` / `TopBar` on the shadcn Sidebar block, lucide icons, `<Toaster />`, theme toggle.
3. **Database** — `admin_payments_v` + `admin_registrations_v` migration and `supabase/tests/admin-list-views.test.ts`. Pushed to the hosted project (`supabase db push --linked`, pinned CLI 2.109.1); effective grants verified on the hosted DB, not assumed from the migration.
4. **Server-side tables** — `DataTable` + Payments and Registrations on the new views, URL-synced state.
5. **Client tables** — Events and Team on `DataTable`.
6. **Forms and dialogs** — event editor, sub-editors, all four modals, `PsgcAddressField`, `CropUploader`, Login, Settings.
7. **Cleanup** — delete `theme.css`, sweep for surviving `style={{`, full dark-mode pass.

### Verification before the PR

- `pnpm -r typecheck` clean.
- Web suite and backend suite both green, with counts reported (not asserted from memory).
- Browser pass over every route at `https://admin.racepace.lan` in **light and dark**, at desktop and tablet widths: Events, EventEditor (new + edit), Registrations, Payments, Team, Settings, Login, NoAccess.
- Pagination smoke against real data — the hosted DB currently holds 20 events across 2 orgs, seeded outside `seed.sql`.

## 10. Risks

| Risk | Mitigation |
|---|---|
| **Single PR has no green checkpoint until the end** — this touches all 23 UI files, all 23 test files, and the data layer. Chosen deliberately over incremental PRs. | Seven sequential commits, each independently green (§9). If the branch becomes unreviewable, say so and split rather than pushing through quietly. |
| Visual drift from the handover as shadcn defaults leak in | Preservation is the acceptance criterion, checked per-route in the browser pass. Differences are resolved in tokens/CVA variants, not by editing Tier-1 primitives. |
| Hosted grant drift on the new views (precedent: `organizations`) | Explicit grant verification in commit 3, plus the negative RLS test. |
| Token drift between `apps/web/src/index.css` and `apps/mobile/global.css` | Mobile named as source of truth (§4); shared-token changes must touch both files in one commit. |
| Radix-in-jsdom flakiness | Polyfills land in commit 1, before any component depends on them. |
| Tailwind v3 (mobile) vs v4 (web) divergence | Accepted. The apps cannot share a config regardless — one is NativeWind. The contract that matters is variable names and values, which stay identical. |

## 11. Open questions

None. All decisions settled during brainstorming: preserve the design (not redesign); hybrid server-side paging (Payments + Registrations only); Tailwind v4; three-tier layering; icons + collapsible sidebar + toasts + dark mode all in scope; one branch and one PR; database migration included.
