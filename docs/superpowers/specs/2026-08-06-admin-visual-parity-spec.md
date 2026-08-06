# Admin visual parity spec (Direction A)

**Date:** 2026-08-06
**Status:** Binding. This document, together with the mockup, is the acceptance criteria.
**Mockup (authoritative):** `docs/superpowers/specs/2026-08-06-admin-design-directions.html`, tab **A · Refined Console**.

---

## Why this document exists

PR1 shipped Direction A's *tokens* (white sidebar, `rounded-xl` cards, 44px rows, trail-green, mono
figures) but not its *composition*. The original spec extracted a table of colours and radii from the
mockup and nothing about layout, so no task brief ever mentioned a KPI row, an avatar cell, a nav
count or a breadcrumb — and every reviewer was handed a token checklist rather than the picture.
The result is faithful to the briefs and unfaithful to the design.

Two rules follow, and they are not optional:

1. **Every implementer task for a page MUST receive the mockup file path** and treat it as the
   requirement alongside this document.
2. **Every reviewer task MUST receive the same mockup path**, and "does the rendered page match the
   mockup's composition" is a review gate equal in weight to correctness. A review that confirms
   `rounded-xl` and 44px rows while missing an absent KPI row has not done its job.

Deviations from the mockup are allowed, but must be *stated and justified in the report* — never
silent.

---

## Global chrome

### Sidebar (216px)

| Element | Spec |
|---|---|
| Brand | 28px `rounded-lg` tile, `bg-primary`, white bold 13px initials `RP`; beside it `Race Pace` bold 14px over the **organization name** 10.5px `text-muted-foreground` |
| Nav item | icon 16px + label 13.5px, `rounded-lg`, 8px/10px padding |
| Nav item (active) | `bg-accent`, label `font-semibold`, icon `text-primary` |
| Count pill | right-aligned, 11px semibold, `bg-muted text-muted-foreground rounded-pill` 1px/7px; **when active** `bg-primary text-primary-foreground` |
| Counts shown on | Events (event count), Registrations (registration count) |
| Groups | main group **unlabeled**; second group labeled `PLATFORM` (10px, uppercase, `tracking-[0.08em]`, `text-muted-foreground`), super-admin only |
| Footer | 30px avatar circle (`bg-accent`, `text-accent-foreground`, 11.5px bold initials) + email local-part 12.5px bold over role 10.5px muted |

The current sidebar is the SPA's, ported. It must be rebuilt to the above. Keep the collapsible
behaviour and `SidebarMenuButton` primitives; change the composition.

### Topbar

Breadcrumb `<org name> / <page>` at 12px (`text-muted-foreground`, current page `text-foreground
font-semibold`), spacer, then a search field, min 180px, with a `⌘K` `<kbd>` on the right. The
current title-plus-role-badge treatment is replaced. The role badge moves into the sidebar footer,
where the mockup shows it.

### Card elevation

Cards are `rounded-xl` **with** a soft single-layer shadow:
`0 1px 2px rgb(16 24 40/.04), 0 1px 3px rgb(16 24 40/.06)`. Add as a `--shadow-card` token and apply
in `components/ui/card.tsx`. Its absence is why the UI reads flatter and boxier than the mockup.

---

## Page header

Every list page:

- `h1` 21px bold `tracking-[-0.02em]`
- subtitle 13px `text-muted-foreground`, figures in `font-mono tabular`
- right-aligned action cluster

| Page | Subtitle | Actions |
|---|---|---|
| Events | `N events in this organization` | `New event` (primary, Plus) |
| Registrations | `N total across M events · K pending payment` | `Export CSV` (outline, Download), `Manual entry` (primary, Plus) |
| Payments | `N transactions` | `Export CSV` (outline, Download) |
| Team | `N members` | `Invite member` (primary) |

---

## KPI row

Four cards above the toolbar on Registrations and Payments; Events keeps its simpler header.
Grid: 2 columns under 760px, 4 above. Each card `rounded-xl border` + card shadow, 14px/15px padding.

- label: 11px semibold `text-muted-foreground`, 13px lucide icon
- value: 23px bold `tracking-[-0.03em]` `font-mono tabular`
- delta: 11.5px semibold — positive `text-paid` with a trend icon, neutral `text-muted-foreground`

| Page | Cards |
|---|---|
| Registrations | Total (count, `+N this week`) · Paid (count, `X% conversion`) · Gross revenue (peso, `+X% MoM`) · Refunds (peso, `N requests · K pending`) |
| Payments | Gross (peso) · Platform fees (peso) · Net to org (peso) · Refunded (peso) |

**These are real aggregates, not props threaded from the page rows.** They describe the whole
filtered set, not the current page. Compute them server-side alongside the list query. Money must be
sourced the same way the table sources it — never recomputed client-side — so the cards can never
disagree with the ledger or with the table beneath them.

---

## Toolbar and filter chips

Toolbar row: search input (min 210px, `rounded-lg`, leading Search icon) · one faceted filter button
per `FilterDef` (active shows a `bg-primary` count badge) · a dashed `+ Add filter` affordance ·
spacer · `Columns` button with a `SlidersHorizontal` icon.

Chip row beneath: one `rounded-pill` chip per active filter reading `<Label>: <Value>` with an `✕`,
plus a ghost `Clear all`. Already implemented — verify it matches visually.

---

## Table cell composition

| Column | Spec |
|---|---|
| Select | 38px checkbox column, present wherever the page has bulk actions |
| Runner / Member | 30px avatar circle with initials, then **name** bold 13px over **email** 11.5px `text-muted-foreground` |
| Bib | `font-mono tabular`; em-dash `—` when unassigned |
| Dates | `font-mono tabular text-muted-foreground`, `MMM D, HH:mm` |
| Money | `font-mono tabular`; Net column `font-semibold` |
| Status | dot badge — 5px leading dot in `currentColor`, `rounded-pill`, tinted background |
| Chevron | trailing 12px `text-muted-foreground` `›` on row-navigable tables |

Registrations columns, in order: select · Runner · Category · Bib · Registered · Amount · Status ·
chevron. The shipped table is missing select, Bib, the avatar/email cell and the chevron.

**Do not place a column that renders its own `<a>` before the primary link column** — row click
targets the first anchor in DOM order.

---

## Bulk selection

`DataTable` already supports `bulkActions` + `getRowId` (both-or-neither at the type level;
selection is page-local, wiped on any page/per/q/filter change, and ids are intersected against the
rendered rows). No page passes them yet. Wire:

| Page | Actions |
|---|---|
| Registrations | Send email · Assign bibs · Mark checked-in · Cancel (destructive) |
| Payments | none for now — refunds stay per-row through the existing modal |

Every bulk action needs server-side authorization in its Server Action; UI gating is not
authorization. Destructive actions confirm via `AlertDialog` and surface the server's error rather
than swallowing it.

---

## Export CSV

A Route Handler per page (`/registrations/export`, `/payments/export`) that:

- reads the **same `searchParams`** as the page, so the export matches exactly what is on screen —
  parse with `parseTableParams`, reuse the same query builder
- streams rather than buffering the whole result set
- runs under the caller's session so RLS applies; it must never use a service-role key
- ignores `page`/`per` (export the whole filtered set, not the visible page)
- sets `Content-Disposition: attachment` with a filename carrying the page and date

It is not a client-side dump of loaded rows — that would export one page and mislead.

---

## ⌘K command palette

Deferred at original spec time; now in scope. `components/ui/command.tsx` is already installed.
`⌘K`/`Ctrl+K` opens a `CommandDialog` over the topbar search: navigate to any page, and jump to an
event by name (server-searched, debounced). Escape closes; results are keyboard-navigable; the
trigger is the topbar field so it is discoverable by mouse too.

---

## Out of scope

Dashboard, Check-in, Organizations, Commission and Payouts keep their coming-soon state — PR2/PR3.
The mockup's Direction B and C treatments are not being built.

---

## Decided: org editors may read runner emails (2026-08-06)

`admin_registration_emails` and `admin_cancel_registration` gate on `auth_can_admin_org`, which
accepts `role in ('editor','admin')`. Editors can therefore enumerate every runner's email address
for every event in their org, and cancel registrations.

This was raised as a product decision rather than inherited silently, and the answer is **keep it**:
editors are event operators who legitimately need runner contact information, and the same helper
already gates registration reads, payment reads, storage writes and `admin-refund`. Narrowing these
two RPCs alone would have made them diverge from every other admin surface.

Recorded here so a future reader finds a decision rather than an accident.
