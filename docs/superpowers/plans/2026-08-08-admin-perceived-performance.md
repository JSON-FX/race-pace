# Admin Perceived Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every admin navigation give immediate feedback and paint its shell instantly, so no click ever reads as dead — independent of how long the data takes.

**Architecture:** The console already has navigation feedback infrastructure (`components/NavProgress.tsx`: a top progress bar plus per-link spinners, mounted in `AppShell`), but it is driven by `useLinkStatus`, which only works inside a `<Link>`. Every `router.push` navigation — the event pickers, pagination, filters, search, the `?reg=` modal — bypasses it entirely and shows nothing. This plan extracts the reporting mechanism into a hook any pending state can drive, wires the existing `useTransition` in `useTableParams` and both event pickers into it, then splits the two heaviest pages behind keyed `<Suspense>` boundaries so a skeleton appears on searchParams-only navigations (where `loading.tsx` never fires). Finally the registration modal stops round-tripping to the server for data it already holds.

**Tech Stack:** Next.js 15.5.22 (App Router), React 19.2.3, TypeScript, Tailwind v4 + shadcn/ui, Vitest + @testing-library/react, Playwright (e2e).

## Global Constraints

- Package manager is **pnpm**. Run unit tests with `pnpm --filter web test`, typecheck with `pnpm --filter web typecheck`.
- **All existing tests must keep passing.** In particular `app/(admin)/registrations/event-picker.test.tsx` asserts `push` is called exactly once with `"/registrations?event=e2", { scroll: false }` — Task 2 must not change that contract.
- Tests that render anything calling `useTableParams()` must copy this exact line at true top level (see the header comment in `lib/test-utils/mock-table-params.ts` for why it cannot be delegated to a helper):
  ```ts
  vi.mock("@/lib/use-table-params", () => ({ useTableParams: () => tableParamsMockReturn }));
  ```
- `useReportPending` (Task 1) **must remain safe to call outside `NavProgressProvider`** — it no-ops there. `lib/use-table-params.test.ts` renders the real hook with no provider, and Task 1 must not break it.
- This codebase comments the *why*, not the *what*, and comments are dense. Match that register: when a line encodes a non-obvious decision, say why. Do not add narration comments for self-evident code.
- Server Components must not import client-only modules. The section components in Tasks 4–5 are `async` Server Components; only the leaf tables/pickers are `"use client"`.
- Do **not** touch `lib/queries/*` query bodies, the middleware, or auth in this plan. Those are Sections 2–4 of the spec and land separately.

## Reference

Spec: `docs/superpowers/specs/2026-08-08-admin-ssr-performance-design.md` (Section 5).

**Already done — do not re-implement:**
- Sidebar `<Link>` prefetch (Next 15 prefetches by default) and per-link pending spinners (`LinkPending`).
- The top progress bar (`NavProgressBar`), already mounted in `AppShell`.
- Table dimming during pagination (`data-table.tsx:163` applies `opacity-60` when `params.isPending`).

The spec's "prefetch sidebar navigation" bullet is therefore already satisfied and has no task here.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `components/NavProgress.tsx` (modify) | Extract `useReportPending`; `LinkPending` consumes it | 1 |
| `components/NavProgress.test.tsx` (create) | Prove the hook reports and balances begin/end | 1 |
| `lib/use-table-params.ts` (modify) | Report its existing `isPending` to the bar | 1 |
| `app/(admin)/registrations/event-picker.tsx` (modify) | `useTransition` + pending affordance | 2 |
| `app/(admin)/registrations/event-picker.test.tsx` (modify) | Add `aria-busy` assertion; keep the existing push contract | 2 |
| `app/(admin)/payments/event-picker.tsx` (modify) | Same, via `EventCombobox` | 3 |
| `app/(admin)/payments/event-picker.test.tsx` (create) | Cover the payments picker (none exists today) | 3 |
| `components/kpi-card.tsx` (modify) | Add `KpiRowSkeleton` beside `KpiRow` | 4 |
| `app/(admin)/registrations/kpi-section.tsx` (create) | Async KPI fetch, suspendable | 4 |
| `app/(admin)/registrations/table-section.tsx` (create) | Async rows+categories fetch, suspendable | 4 |
| `app/(admin)/registrations/page.tsx` (modify) | Shell renders immediately; sections stream behind keyed Suspense | 4 |
| `app/(admin)/registrations/kpi-section.test.tsx` (create) | KPI assertions moved off `page.test.tsx` | 4 |
| `app/(admin)/registrations/table-section.test.tsx` (create) | Row/scoping assertions moved off `page.test.tsx` | 4 |
| `app/(admin)/registrations/page.test.tsx` (modify) | Keeps only branch/routing assertions | 4 |
| `app/(admin)/payments/kpi-section.tsx` (create) | Same shape as registrations | 5 |
| `app/(admin)/payments/table-section.tsx` (create) | Same shape as registrations | 5 |
| `app/(admin)/payments/page.tsx` (modify) | Same shape as registrations | 5 |
| `app/(admin)/payments/kpi-section.test.tsx` (create) | KPI assertions moved off `page.test.tsx` | 5 |
| `app/(admin)/payments/table-section.test.tsx` (create) | Row/scoping assertions moved off `page.test.tsx` | 5 |
| `app/(admin)/payments/page.test.tsx` (modify) | Keeps only the no-org branch assertions | 5 |

> Tasks 4 and 5 each split an existing `page.test.tsx`. This is forced, not stylistic: those files render the page with `render(await Page(…))`, and a client renderer cannot render the async section components that now sit inside the Suspense boundaries. See Task 4 Step 5.
| `app/(admin)/registrations/registrations-table.tsx` (modify) | Modal opens from client state; URL syncs behind it | 6 |
| `app/(admin)/registrations/registrations-table.test.tsx` (modify) | Prove the modal opens without waiting on the URL | 6 |

---

### Task 1: Route every navigation through the existing progress bar

`NavProgress.tsx` already contains exactly the right effect — inside `LinkPending`, coupled to `useLinkStatus`. Extract it so any boolean can drive the bar, then feed `useTableParams`'s existing (currently under-used) `isPending` into it. After this task, pagination, sorting, filters, search and "Clear all" all show the top bar; they show nothing today.

**Files:**
- Modify: `apps/web/components/NavProgress.tsx`
- Modify: `apps/web/lib/use-table-params.ts`
- Test: `apps/web/components/NavProgress.test.tsx` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `useReportPending(pending: boolean): void`, exported from `@/components/NavProgress`. No-ops outside `NavProgressProvider`. Tasks 2 and 3 both import it.

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/NavProgress.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavProgressProvider, NavProgressBar, useReportPending } from "./NavProgress";

function Reporter({ pending }: { pending: boolean }) {
  useReportPending(pending);
  return null;
}

/** Two independent reporters plus a toggle for each, so a test can assert the
 *  counter semantics the bar depends on: the bar must stay up while ANY
 *  reporter is pending, which a boolean (rather than a count) would get wrong. */
function Harness() {
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  return (
    <NavProgressProvider>
      <NavProgressBar />
      <Reporter pending={a} />
      <Reporter pending={b} />
      <button onClick={() => setA((v) => !v)}>toggle a</button>
      <button onClick={() => setB((v) => !v)}>toggle b</button>
    </NavProgressProvider>
  );
}

const bar = () => screen.queryByRole("progressbar", { name: "Loading page" });

describe("useReportPending", () => {
  it("shows the bar while pending and hides it when it clears", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(bar()).not.toBeInTheDocument();

    await user.click(screen.getByText("toggle a"));
    expect(bar()).toBeInTheDocument();

    await user.click(screen.getByText("toggle a"));
    expect(bar()).not.toBeInTheDocument();
  });

  // The regression this pins: with a boolean instead of a counter, resolving
  // the FIRST of two overlapping navigations would clear the bar while the
  // second is still in flight.
  it("keeps the bar up until every reporter has cleared", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText("toggle a"));
    await user.click(screen.getByText("toggle b"));
    expect(bar()).toBeInTheDocument();

    await user.click(screen.getByText("toggle a"));
    expect(bar()).toBeInTheDocument();

    await user.click(screen.getByText("toggle b"));
    expect(bar()).not.toBeInTheDocument();
  });

  // useTableParams calls this hook, and lib/use-table-params.test.ts renders
  // that hook with no provider anywhere in the tree.
  it("is safe to call with no provider mounted", () => {
    expect(() => render(<Reporter pending />)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter web test NavProgress
```

Expected: FAIL — `useReportPending` is not exported from `./NavProgress`.

- [ ] **Step 3: Extract the hook in `components/NavProgress.tsx`**

Add this export directly above `LinkPending`:

```tsx
/**
 * Reports an arbitrary pending state to the nav bar.
 *
 * Extracted from <LinkPending> so navigations that are NOT <Link> clicks can
 * drive the same bar: the event pickers and every `useTableParams` write
 * (pagination, sort, filters, search) go through `router.push`, which
 * `useLinkStatus` cannot see. Without this they were completely silent —
 * the operator clicked and the page sat there.
 *
 * Safe with no provider mounted: it simply does nothing, so a hook as widely
 * used as `useTableParams` can call it unconditionally.
 */
export function useReportPending(pending: boolean) {
  const ctx = React.useContext(NavProgressCtx);

  React.useEffect(() => {
    if (!ctx || !pending) return;
    ctx.begin();
    // Cleanup runs when `pending` flips false OR the caller unmounts
    // mid-navigation — the common case, since the new page replaces the old
    // tree. Without balancing on unmount the counter leaks and the bar sticks.
    return () => ctx.end();
  }, [pending, ctx]);
}
```

Then replace `LinkPending`'s body so it consumes the hook rather than duplicating the effect:

```tsx
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  useReportPending(pending);

  if (!pending) return null;

  return (
    <span
      role="status"
      aria-label="Loading page"
      className={cn(
        "ml-auto size-3 shrink-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary",
        // Spinning conveys nothing a reduced-motion user asked to see; the ring
        // still marks WHICH item is loading, which is the useful part.
        "motion-reduce:animate-none",
        className,
      )}
    />
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter web test NavProgress
```

Expected: PASS (3 tests).

- [ ] **Step 5: Wire `useTableParams` to the bar**

In `apps/web/lib/use-table-params.ts`, add the import:

```ts
import { useReportPending } from "@/components/NavProgress";
```

and immediately after the `useTransition` line, add:

```ts
  const [isPending, startTransition] = useTransition();
  // Surfaces pagination / sort / filter / search navigations on the shared top
  // progress bar. `isPending` was already computed and returned here, but only
  // DataTable consumed it (to dim the card) — the navigation itself was
  // otherwise silent. No-ops outside NavProgressProvider.
  useReportPending(isPending);
```

- [ ] **Step 6: Verify the whole suite still passes**

```bash
pnpm --filter web test && pnpm --filter web typecheck
```

Expected: PASS. Pay attention to `lib/use-table-params.test.ts` — it renders the real hook with no provider, which the third test in Step 1 exists to protect.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/NavProgress.tsx apps/web/components/NavProgress.test.tsx apps/web/lib/use-table-params.ts
git commit -m "feat(admin): drive the nav progress bar from any pending state

Extracts useReportPending from LinkPending so router.push navigations can
show the same bar useLinkStatus already gives <Link> clicks. Wires
useTableParams' existing isPending into it, so pagination, sort, filters
and search stop being silent."
```

---

### Task 2: Pending state on the Registrations event picker

`app/(admin)/registrations/event-picker.tsx:20` calls `router.push` bare — no transition, no indicator. This is the specific dead click that started this work.

**Files:**
- Modify: `apps/web/app/(admin)/registrations/event-picker.tsx`
- Test: `apps/web/app/(admin)/registrations/event-picker.test.tsx` (modify)

**Interfaces:**
- Consumes: `useReportPending(pending: boolean): void` from `@/components/NavProgress` (Task 1).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Append this case inside the existing `describe("EventPicker", …)` block in `app/(admin)/registrations/event-picker.test.tsx`. Leave the existing test untouched — it pins the reset-on-switch contract.

```tsx
  it("marks the trigger idle before a switch", async () => {
    render(<EventPicker events={events} value="e1" />);
    // aria-busy must be present and false at rest: asserting only the pending
    // state would pass against a component that never sets the attribute at
    // all, since getByRole would simply not find a busy element either way.
    expect(screen.getByRole("combobox", { name: "Event" })).toHaveAttribute("aria-busy", "false");
  });
```

> Note on scope: the pending=true state is deliberately NOT unit-tested here. `startTransition` resolves synchronously under jsdom with a mocked router, so any assertion on the busy state would be testing the mock's timing, not the component. Step 6 verifies it in a real browser instead. Task 1's test already covers the reporting mechanism deterministically.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter web test registrations/event-picker
```

Expected: FAIL — `Expected the element to have attribute aria-busy="false"` (the attribute is absent).

- [ ] **Step 3: Implement**

Replace the whole of `app/(admin)/registrations/event-picker.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useReportPending } from "@/components/NavProgress";

export function EventPicker({ events, value }: {
  events: { id: string; name: string; count: number }[];
  value: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // Without a transition this push was completely silent: the browser holds the
  // OLD page until the server responds, so switching events read as a click
  // that never landed. `isPending` drives both the shared top bar and the
  // trigger's own busy state below.
  const [isPending, startTransition] = useTransition();
  useReportPending(isPending);

  return (
    <Select
      value={value}
      onValueChange={(id) => {
        // Category ids are per-event, so carrying a category filter across a
        // switch would silently return zero rows. Drop every other param and
        // start clean on the new event.
        startTransition(() => {
          router.push(`${pathname}?event=${id}`, { scroll: false });
        });
      }}
    >
      <SelectTrigger
        aria-label="Event"
        // Named on the trigger rather than announced via a live region: this
        // is the control the operator just acted on, so the busy state belongs
        // where their attention already is.
        aria-busy={isPending}
        className="h-9 w-[280px] rounded-lg data-[busy=true]:opacity-70"
        data-busy={isPending}
      >
        <SelectValue placeholder="Pick an event" />
      </SelectTrigger>
      <SelectContent>
        {events.map((e) => (
          <SelectItem key={e.id} value={e.id}>
            {e.name} <span className="tabular text-muted-foreground">({e.count})</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter web test registrations/event-picker
```

Expected: PASS (2 tests). The pre-existing push-contract test must still pass — `startTransition` does not change how `push` is called.

- [ ] **Step 5: Run the full suite**

```bash
pnpm --filter web test && pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 6: Verify in a real browser**

Load `https://admin.racepace.lan/registrations`, change the event in the dropdown, and confirm: the top progress bar appears immediately on select, the trigger dims while loading, and both clear when the new event's rows land.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(admin)/registrations/event-picker.tsx" "apps/web/app/(admin)/registrations/event-picker.test.tsx"
git commit -m "feat(admin): pending state on the registrations event picker

The bare router.push showed nothing at all while the server re-rendered."
```

---

### Task 3: Pending state on the Payments event picker

Same defect, different control — this one is an `EventCombobox`, which already accepts a `disabled` prop.

**Files:**
- Modify: `apps/web/app/(admin)/payments/event-picker.tsx`
- Test: `apps/web/app/(admin)/payments/event-picker.test.tsx` (create — none exists)

**Interfaces:**
- Consumes: `useReportPending` from `@/components/NavProgress` (Task 1); `EventCombobox` from `@/components/EventCombobox` (existing, unchanged).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/(admin)/payments/event-picker.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaymentsEventPicker } from "./event-picker";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/payments",
  useSearchParams: () => new URLSearchParams("status=paid&page=3"),
}));

const events = [
  { id: "e1", name: "Dahilayan Sky Ultra 2026", count: 12 },
  { id: "e2", name: "Davao Sunrise Run 2026", count: 4 },
];

beforeEach(() => {
  push.mockClear();
});

describe("PaymentsEventPicker", () => {
  // Unlike the Registrations picker (which resets everything), this one
  // PRESERVES status/method/search and drops only pagination — page 3 of the
  // whole org is rarely page 3 of one event.
  it("keeps other filters and drops the page when scoping to an event", async () => {
    const user = userEvent.setup();
    render(<PaymentsEventPicker events={events} value="all" />);

    await user.click(screen.getByRole("combobox", { name: "Filter payments by event" }));
    await user.click(await screen.findByRole("option", { name: /Davao Sunrise Run 2026/ }));

    expect(push).toHaveBeenCalledTimes(1);
    const [url] = push.mock.calls[0] as [string, unknown];
    expect(url).toContain("status=paid");
    expect(url).toContain("event=e2");
    expect(url).not.toContain("page");
  });

  it("marks the trigger idle before a switch", () => {
    render(<PaymentsEventPicker events={events} value="all" />);
    expect(screen.getByRole("combobox", { name: "Filter payments by event" }))
      .toHaveAttribute("aria-busy", "false");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter web test payments/event-picker
```

Expected: the first test PASSES (that behaviour already exists), the second FAILS — no `aria-busy` attribute.

- [ ] **Step 3: Implement**

In `app/(admin)/payments/event-picker.tsx`, add the imports:

```tsx
import { useTransition } from "react";
import { useReportPending } from "@/components/NavProgress";
```

Add inside the component, after `const search = useSearchParams();`:

```tsx
  // Same silence as the Registrations picker — see its comment. Combobox
  // selection stays ENABLED while pending rather than disabled: disabling
  // would yank focus out of a control the operator may be about to re-use,
  // and a mis-scoped event is cheap to correct only if the picker is reachable.
  const [isPending, startTransition] = useTransition();
  useReportPending(isPending);
```

Wrap the existing `router.push` call at the end of `onSelect`:

```tsx
        const qs = next.toString();
        startTransition(() => {
          router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
        });
```

And pass the busy state through to the combobox:

```tsx
    <EventCombobox
      events={options}
      value={value}
      label="Filter payments by event"
      className="w-[240px]"
      placeholder="All events"
      busy={isPending}
      onSelect={(id) => { /* unchanged body */ }}
    />
```

Then add the `busy` prop to `apps/web/components/EventCombobox.tsx`. In `EventComboboxProps` add:

```tsx
  /** Renders the trigger as busy during a pending navigation. Distinct from
   *  `disabled`: the control stays operable, it just reports that the last
   *  selection is still in flight. */
  busy?: boolean;
```

Destructure it (`events, value, onSelect, placeholder = "Choose an event…", label, className, disabled, busy,`) and set it on the trigger `<Button>`:

```tsx
          aria-label={label}
          aria-busy={!!busy}
          disabled={disabled}
          className={cn(
            "h-9 justify-between gap-2 rounded-lg font-semibold",
            busy && "opacity-70",
            className,
          )}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter web test payments/event-picker
```

Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite**

```bash
pnpm --filter web test && pnpm --filter web typecheck
```

Expected: PASS. `EventCombobox` is also used by `app/(admin)/check-in/event-switcher.tsx`; `busy` is optional so that call site is unaffected — confirm its tests still pass.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(admin)/payments/event-picker.tsx" "apps/web/app/(admin)/payments/event-picker.test.tsx" apps/web/components/EventCombobox.tsx
git commit -m "feat(admin): pending state on the payments event picker

Adds an optional busy prop to EventCombobox; check-in's switcher is unaffected."
```

---

### Task 4: Stream the Registrations page behind keyed Suspense

Today the page awaits **every** query before emitting a single byte, and `loading.tsx` never fires for a searchParams-only navigation, so changing the event or the page shows nothing at all. Splitting the two expensive reads into suspendable sections lets the header, KPI skeleton and picker paint after ~2 round trips instead of ~6, and — because the boundary is keyed on the serialized params — a skeleton reappears on *every* param change.

**Files:**
- Modify: `apps/web/components/kpi-card.tsx` (add `KpiRowSkeleton`)
- Create: `apps/web/app/(admin)/registrations/kpi-section.tsx`
- Create: `apps/web/app/(admin)/registrations/table-section.tsx`
- Modify: `apps/web/app/(admin)/registrations/page.tsx`

**Interfaces:**
- Consumes: nothing from Tasks 1–3.
- Produces:
  - `KpiRowSkeleton({ cards }: { cards?: number }): JSX.Element` from `@/components/kpi-card` — Task 5 reuses it.
  - `RegistrationsKpiSection({ eventId, params }: { eventId: string; params: TableParams }): Promise<JSX.Element>`
  - `RegistrationsTableSection({ eventId, params }: { eventId: string; params: TableParams }): Promise<JSX.Element>`

- [ ] **Step 1: Add the KPI skeleton**

Append to `apps/web/components/kpi-card.tsx`:

```tsx
/** Placeholder for <KpiRow> while its aggregates are in flight. Same grid, same
 *  card chrome and the same 14/15px padding as KpiCard, so nothing shifts when
 *  the real numbers land — the reason this mirrors the card rather than being a
 *  plain grey block. */
export function KpiRowSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div
      className="mb-[18px] grid grid-cols-2 gap-3 min-[760px]:grid-cols-4"
      role="status"
      aria-label="Loading summary"
    >
      {Array.from({ length: cards }).map((_, i) => (
        <Card key={i} className="gap-0 rounded-xl border px-[15px] py-[14px] shadow-card">
          <div className="h-3 w-20 animate-pulse rounded bg-muted" />
          <div className="mt-[9px] h-6 w-24 animate-pulse rounded bg-muted" />
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create the KPI section**

Create `apps/web/app/(admin)/registrations/kpi-section.tsx`. Move the four `<KpiCard>` elements verbatim out of `page.tsx`, **including their existing comments** — the omitted-MoM-delta and omitted-pending-refunds rationales are load-bearing and must not be lost in the move.

```tsx
import { ClipboardList, CheckCircle2, Wallet, Undo2 } from "lucide-react";
import { getRegistrationAggregates } from "@/lib/queries/registrations";
import { KpiCard, KpiRow } from "@/components/kpi-card";
import { peso } from "@/lib/format";
import type { TableParams } from "@/lib/table-params";

/** The KPI row, split out of page.tsx so it can suspend independently of the
 *  table. Both read the SAME event and filters — see getRegistrationAggregates'
 *  doc comment for why the cards come from an RPC over the shared view rather
 *  than a sum over the table's rows. */
export async function RegistrationsKpiSection({ eventId, params }: {
  eventId: string;
  params: TableParams;
}) {
  const aggregates = await getRegistrationAggregates(eventId, params);

  return (
    <KpiRow>
      <KpiCard
        icon={ClipboardList}
        label="Total"
        value={aggregates.total.toLocaleString()}
        delta={{
          text: `+${aggregates.newThisWeek.toLocaleString()} this week`,
          tone: aggregates.newThisWeek > 0 ? "positive" : "neutral",
        }}
      />
      <KpiCard
        icon={CheckCircle2}
        label="Paid"
        value={aggregates.paid.toLocaleString()}
        delta={{
          text: `${aggregates.total > 0 ? ((aggregates.paid / aggregates.total) * 100).toFixed(1) : "0.0"}% conversion`,
          tone: "neutral",
        }}
      />
      {/* MoM delta omitted — see task-v2-report.md ("Deltas shipped vs
          omitted"): a month-over-month comparison needs a second
          time-windowed query with an ambiguous boundary (calendar month vs.
          rolling 30d) and reads as noise against this org's sparse,
          single-month seed data. Rather than fabricate a plausible-looking
          percentage, the card renders the value alone. */}
      <KpiCard icon={Wallet} label="Gross revenue" value={peso(aggregates.grossCents)} />
      <KpiCard
        icon={Undo2}
        label="Refunds"
        value={peso(aggregates.refundedCents)}
        delta={{
          // Deliberately NOT "· K pending": there is no refund-approval queue
          // in this schema yet (refunds run through refund_registration_tx,
          // supabase/migrations/20260723100000_money_txn_rpcs.sql, one atomic
          // transition straight to 'refunded' — the queue is Payments A2, not
          // yet built). "0 pending" would assert the system tracks pending
          // refunds and found none; it doesn't track them at all, so the
          // question is unanswerable, not answered-zero.
          text: `${aggregates.refundCount.toLocaleString()} request${aggregates.refundCount === 1 ? "" : "s"}`,
          tone: "neutral",
        }}
      />
    </KpiRow>
  );
}
```

- [ ] **Step 3: Create the table section**

Create `apps/web/app/(admin)/registrations/table-section.tsx`:

```tsx
import { listEventRegistrations, listEventCategories } from "@/lib/queries/registrations";
import type { TableParams } from "@/lib/table-params";
import { RegistrationsTable } from "./registrations-table";

/** Rows + the category filter's options, split out of page.tsx so the page
 *  shell and event picker can paint before either lands. These two are fetched
 *  together (not in separate boundaries) because a table whose category filter
 *  arrives after its rows would let an operator act on a half-built toolbar. */
export async function RegistrationsTableSection({ eventId, params }: {
  eventId: string;
  params: TableParams;
}) {
  const [{ rows, total }, categories] = await Promise.all([
    listEventRegistrations(eventId, params),
    listEventCategories(eventId),
  ]);

  return (
    <RegistrationsTable
      rows={rows} total={total} page={params.page} per={params.per}
      sort={params.sort} activeFilters={params.filters} q={params.q} categories={categories}
    />
  );
}
```

- [ ] **Step 4: Rewrite the page to stream**

In `apps/web/app/(admin)/registrations/page.tsx`, remove everything that moved into the two sections, then replace the data-fetching block and the render body.

Imports to **delete** (all now unused in the page — leaving them will fail lint):
- from `@/lib/queries/registrations`: `listEventRegistrations`, `listEventCategories`, `getRegistrationAggregates` (keep `listOrgEventOptions`, `getOrgRegistrationCount`, `getOrgPendingRegistrationCount`)
- from `lucide-react`: `ClipboardList`, `CheckCircle2`, `Wallet`, `Undo2` (keep `Download`, `Plus`)
- from `@/components/kpi-card`: `KpiCard`, `KpiRow` — replaced by `KpiRowSkeleton`
- `peso` from `@/lib/format`

Keep `TableEmptyState`, `Card`, the `Tooltip*` imports and `NoOrgScope` — the no-events and no-org branches still use them.

Replace the single `Promise.all` of five calls with this — the three remaining reads run as one parallel burst instead of `listOrgEventOptions` blocking the rest:

```tsx
  // One burst, not a chain: the event list is needed to resolve `eventId`
  // below, and the two org-wide counts feed the subtitle. Nothing here depends
  // on anything else here. The row and aggregate reads have moved into the
  // suspended sections so they no longer hold up the shell.
  const [events, orgTotal, orgPending] = await Promise.all([
    listOrgEventOptions(orgId),
    // Subtitle figures are deliberately ORG-wide, not scoped to the selected
    // event/filters — see each function's doc comment.
    getOrgRegistrationCount(orgId),
    getOrgPendingRegistrationCount(orgId),
  ]);
```

Keep the existing `eventId` resolution, the `if (!eventId)` early return, and the `exportHref` construction exactly as they are — they sit after this burst and are unchanged.

Add the imports:

```tsx
import { Suspense } from "react";
import { DataTableSkeleton, TableEmptyState } from "@/components/data-table";
import { KpiRowSkeleton } from "@/components/kpi-card";
import { RegistrationsKpiSection } from "./kpi-section";
import { RegistrationsTableSection } from "./table-section";
```

Derive the boundary key just after `exportHref`:

```tsx
  // Keying both boundaries on the resolved params is what makes a skeleton
  // appear on a searchParams-only navigation. `loading.tsx` fires only when the
  // route SEGMENT changes, so switching event, paging, sorting or filtering
  // otherwise leaves the old table on screen with no indication anything is
  // happening. Changing the key remounts the boundary, which re-shows the
  // fallback. Reuses serializeTableParams so the key can never drift from the
  // params the sections are actually handed.
  const sectionKey = serializeTableParams(
    { ...params, filters: { ...params.filters, event: eventId } },
    DEFAULTS,
  ).toString();
```

Then replace the `<KpiRow>…</KpiRow>` block and the `<RegistrationsTable …/>` element with:

```tsx
      <Suspense key={`kpi-${sectionKey}`} fallback={<KpiRowSkeleton />}>
        <RegistrationsKpiSection eventId={eventId} params={params} />
      </Suspense>

      <div className="mb-3">
        <EventPicker events={events} value={eventId} />
      </div>

      <Suspense key={`table-${sectionKey}`} fallback={<DataTableSkeleton rows={8} columns={6} />}>
        <RegistrationsTableSection eventId={eventId} params={params} />
      </Suspense>
```

- [ ] **Step 5: Move the affected assertions out of `page.test.tsx` into section tests**

This step is mandatory and is **not** a matter of adding an `await`. `app/(admin)/registrations/page.test.tsx` renders the page like this:

```tsx
const ui = await RegistrationsPage({ searchParams: Promise.resolve({}) });
render(ui);
```

That awaits the async page and hands the resulting JSX to testing-library's **client** renderer. After this task that JSX contains `<Suspense><RegistrationsKpiSection …/></Suspense>`, and `RegistrationsKpiSection` is an async function component — which the client renderer cannot render at all. Those tests will throw, not merely race.

Split the file along the same seam as the code:

**Keep in `page.test.tsx`** — everything about what the *page* still decides:
- the `NoOrgScope` branch and its `expect(…).not.toHaveBeenCalled()` assertions (the page returns early, so no Suspense is involved and this still renders fine)
- the no-events empty state
- event-id resolution and the `exportHref` contract

**Move** the KPI-value assertions and the `getRegistrationAggregates` / `listEventRegistrations` scoping assertions into two new files that render the sections directly. The same await-then-render trick works there, because these components actually resolve:

Create `apps/web/app/(admin)/registrations/kpi-section.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { parseTableParams } from "@/lib/table-params";

const getRegistrationAggregates = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queries/registrations", () => ({ getRegistrationAggregates }));

import { RegistrationsKpiSection } from "./kpi-section";

beforeEach(() => getRegistrationAggregates.mockReset());

describe("RegistrationsKpiSection", () => {
  it("renders the cards from the aggregates reader, scoped to the given event and filters", async () => {
    getRegistrationAggregates.mockResolvedValue({
      total: 4, paid: 2, grossCents: 480000, refundCount: 1, refundedCents: 120000, newThisWeek: 2,
    });
    const params = parseTableParams({}, { sort: [], filters: { status: "all", category: "all" } });

    render(await RegistrationsKpiSection({ eventId: "ev-1", params }));

    expect(getRegistrationAggregates).toHaveBeenCalledWith(
      "ev-1",
      expect.objectContaining({ filters: expect.objectContaining({ status: "all", category: "all" }) }),
    );
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("+2 this week")).toBeInTheDocument();
    expect(screen.getByText("50.0% conversion")).toBeInTheDocument();
    expect(screen.getByText("₱4,800")).toBeInTheDocument();
  });

  // Pins the degrade-gracefully posture: getRegistrationAggregates returns
  // zeroes rather than throwing when the RPC fails, and the row must render
  // those zeroes rather than collapsing to nothing.
  it("renders zeroed cards, not a blank row, when the filtered set is empty", async () => {
    getRegistrationAggregates.mockResolvedValue({
      total: 0, paid: 0, grossCents: 0, refundCount: 0, refundedCents: 0, newThisWeek: 0,
    });
    const params = parseTableParams({}, { sort: [], filters: { status: "all", category: "all" } });

    render(await RegistrationsKpiSection({ eventId: "ev-1", params }));

    expect(screen.getAllByText("₱0").length).toBe(2);
    expect(screen.getByText("0.0% conversion")).toBeInTheDocument();
  });
});
```

Create `apps/web/app/(admin)/registrations/table-section.test.tsx` with the same shape, mocking `listEventRegistrations` and `listEventCategories`, asserting both are called with `"ev-1"` and the parsed params, and that a returned row's name reaches the DOM. Copy the mock-hoisting pattern above, and remember the `useTableParams` mock line from Global Constraints — `RegistrationsTable` calls it.

Then delete the moved cases from `page.test.tsx`. Do not delete any assertion outright; every one should exist in exactly one of the three files afterwards.

- [ ] **Step 5b: Run the tests**

```bash
pnpm --filter web test registrations && pnpm --filter web typecheck
```

Expected: PASS across `page.test.tsx`, `kpi-section.test.tsx`, `table-section.test.tsx`, and the untouched `registrations-table.test.tsx`.

- [ ] **Step 6: Verify the streaming behaviour in a real browser**

This is the step that proves the task worked. On `https://admin.racepace.lan/registrations`:

1. Hard-reload — the header and KPI skeleton must appear **before** the table.
2. Change the event — a table skeleton must appear, not a frozen old table.
3. Click page 2 — same.
4. Type in the search box — same.

> If the fallback does **not** appear on steps 2–4, the cause is React keeping already-visible content during a `startTransition`. The keyed remount is expected to defeat that, but verify rather than assume. If fallbacks genuinely don't show, do **not** remove the transition (it is what prevents a full-page flash) — the top progress bar from Task 1 still covers "did my click register?", and the correct follow-up is to record the finding in the plan and move on. Report what you observe either way.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/kpi-card.tsx "apps/web/app/(admin)/registrations/"
git commit -m "feat(admin): stream the registrations page behind keyed Suspense

Header and picker paint after ~2 round trips instead of ~6, and a keyed
boundary makes skeletons appear on searchParams-only navigations where
loading.tsx never fires."
```

---

### Task 5: Stream the Payments page behind keyed Suspense

Same treatment, same shape. Payments has no `?event=`-driven default-resolution step, so its page body is simpler.

**Files:**
- Create: `apps/web/app/(admin)/payments/kpi-section.tsx`
- Create: `apps/web/app/(admin)/payments/table-section.tsx`
- Modify: `apps/web/app/(admin)/payments/page.tsx`

**Interfaces:**
- Consumes: `KpiRowSkeleton` from `@/components/kpi-card` (Task 4).
- Produces: `PaymentsKpiSection` and `PaymentsTableSection`, both `({ orgId, params }: { orgId: string; params: TableParams })`.

> Note the prop difference from Task 4: Payments queries are scoped by **`orgId`**, not `eventId` (the event is one of `params.filters`). Do not copy Task 4's signature.

- [ ] **Step 1: Create the KPI section**

Create `apps/web/app/(admin)/payments/kpi-section.tsx`:

```tsx
import { Wallet, Percent, Landmark, Undo2 } from "lucide-react";
import { getPaymentAggregates } from "@/lib/queries/payments";
import { KpiCard, KpiRow } from "@/components/kpi-card";
import { peso } from "@/lib/format";
import type { TableParams } from "@/lib/table-params";

/** No delta line on any Payments card — the binding spec's KPI table
 *  (docs/superpowers/specs/2026-08-06-admin-visual-parity-spec.md, "KPI row")
 *  lists only a peso value for Gross/Platform fees/Net to org/Refunded, and the
 *  mockup's tab A content view is the Registrations page, not Payments, so
 *  there is no `.kpi` delta markup to match here.
 *
 *  Same org + same filters as the table. Gross/fee/net come straight off
 *  admin_payments_v's own columns — see getPaymentAggregates' doc comment for
 *  why net is never recomputed as amount - fee here. */
export async function PaymentsKpiSection({ orgId, params }: {
  orgId: string;
  params: TableParams;
}) {
  const aggregates = await getPaymentAggregates(orgId, params);

  return (
    <KpiRow>
      <KpiCard icon={Wallet} label="Gross" value={peso(aggregates.grossCents)} />
      <KpiCard icon={Percent} label="Platform fees" value={peso(aggregates.feeCents)} />
      <KpiCard icon={Landmark} label="Net to org" value={peso(aggregates.netCents)} />
      <KpiCard icon={Undo2} label="Refunded" value={peso(aggregates.refundedCents)} />
    </KpiRow>
  );
}
```

- [ ] **Step 2: Create the table section**

Create `apps/web/app/(admin)/payments/table-section.tsx`:

```tsx
import { listOrgPayments, listOrgPaymentMethods } from "@/lib/queries/payments";
import type { TableParams } from "@/lib/table-params";
import { PaymentsTable } from "./payments-table";

/** Rows plus the Method filter's options. The methods list is org-scoped but
 *  deliberately UNfiltered — the filter has to keep offering the other methods
 *  once one is selected. See its doc comment. */
export async function PaymentsTableSection({ orgId, params }: {
  orgId: string;
  params: TableParams;
}) {
  const [{ rows, total }, methods] = await Promise.all([
    listOrgPayments(orgId, params),
    listOrgPaymentMethods(orgId),
  ]);

  return (
    <PaymentsTable
      rows={rows} total={total} page={params.page} per={params.per}
      sort={params.sort} activeFilters={params.filters} q={params.q} methods={methods}
    />
  );
}
```

- [ ] **Step 3: Rewrite the page**

`app/(admin)/payments/page.tsx` currently renders a subtitle reading `{total} transaction(s)`, where `total` came from the table query. That value now lives inside the suspended section and is no longer available in the page.

**Decision — the count is dropped from the subtitle.** The event *name* stays in the page (it needs `events`, which the page still has), but `{total} transaction(s)` goes away. Rationale: the count came from the table query, which now streams, so keeping it in the page would either re-run the query a second time or force a third Suspense boundary around one line of text. The KPI cards directly beneath already carry the scoped figures, and a count that disagrees with the cards for a beat is worse than no count.

> This is a visible product change, not just a refactor — the Payments header loses a number it shows today. It was accepted deliberately when the plan was written. If you would rather keep it, the alternative is a third boundary wrapping just the subtitle, fed by a count-only query; that is a real option, just more machinery than the line earns. Do not silently reinstate it by re-running the table query in the page.

Replace the fetch block with:

```tsx
  // Only the event list is needed before the shell can paint — the picker
  // renders from it and the subtitle names the active event. Rows, methods and
  // aggregates have moved into the suspended sections below.
  const events = await listOrgEventOptions(orgId);
```

Replace the subtitle `<p>` with:

```tsx
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {activeEvent !== ALL_EVENTS ? (
              // Name the scope in words next to the cards. The KPI cards change
              // silently otherwise, and "₱2,100 gross" for one event looks
              // identical to "₱2,100 gross" for the whole organization.
              <>Showing <span className="font-semibold text-foreground">
                {events.find((e) => e.id === activeEvent)?.name ?? "this event"}
              </span></>
            ) : "Across all events"}
          </p>
```

Add the imports and boundaries exactly as in Task 4, with `orgId` in place of `eventId`:

```tsx
import { Suspense } from "react";
import { DataTableSkeleton } from "@/components/data-table";
import { KpiRowSkeleton } from "@/components/kpi-card";
import { PaymentsKpiSection } from "./kpi-section";
import { PaymentsTableSection } from "./table-section";
```

```tsx
  const sectionKey = serializeTableParams({ ...params }, DEFAULTS).toString();
```

```tsx
      <Suspense key={`kpi-${sectionKey}`} fallback={<KpiRowSkeleton />}>
        <PaymentsKpiSection orgId={orgId} params={params} />
      </Suspense>

      <Suspense key={`table-${sectionKey}`} fallback={<DataTableSkeleton rows={8} columns={6} />}>
        <PaymentsTableSection orgId={orgId} params={params} />
      </Suspense>
```

Remove the now-unused `listOrgPayments` / `getPaymentAggregates` / `listOrgPaymentMethods` / `KpiCard` / `KpiRow` / `peso` imports.

- [ ] **Step 4: Split `payments/page.test.tsx` the same way Task 4 split the registrations one**

Identical mechanism, identical reason — `app/(admin)/payments/page.test.tsx` does `render(await PaymentsPage(…))`, which cannot render the async section components now sitting inside the Suspense boundaries. Re-read Task 4 Step 5 before starting; do not improvise a different split.

**Keep in `page.test.tsx`:** the `NoOrgScope` branch (returns early, no Suspense) and its `not.toHaveBeenCalled()` assertions.

**Move to `apps/web/app/(admin)/payments/kpi-section.test.tsx`:** the KPI-value assertions — `"Gross"` / `₱6,000`, `"Platform fees"` / `₱300`, `"Net to org"` / `₱4,560`, `"Refunded"` / `₱1,200`, the four-`₱0` empty case — plus the `getPaymentAggregates` scoping assertion. Render with `render(await PaymentsKpiSection({ orgId: "org-1", params }))`.

**Move to `apps/web/app/(admin)/payments/table-section.test.tsx`:** the `listOrgPayments` scoping assertion and `expect(listOrgPaymentMethods.mock.lastCall).toEqual(["org-1"])` — the test proving the method options are read org-scoped and unfiltered.

The subtitle needs no test change: `page.test.tsx` does not assert on the `"N transactions"` copy today (verified — no `transaction` match in that file or under `e2e/`). Do not add one for the new copy.

- [ ] **Step 4b: Run the tests**

```bash
pnpm --filter web test payments && pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 5: Verify in a real browser**

On `https://admin.racepace.lan/payments`: hard-reload and confirm the header paints before the cards; then change the event picker, page, and filter, confirming a skeleton each time.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(admin)/payments/"
git commit -m "feat(admin): stream the payments page behind keyed Suspense

Drops the transaction count from the subtitle: it lived in the table query,
which now streams, and a count that disagrees with the KPI cards for a beat
is worse than no count."
```

---

### Task 6: Open the registration modal instantly

`RegistrationDetail` renders entirely from the `row` object already in `rows` on the client, yet opening it costs a full server round trip (~3.3s measured) because the open state is derived from `?reg=` in the URL. Keep the URL — it is what makes a registration linkable — but stop *waiting* on it.

**Files:**
- Modify: `apps/web/app/(admin)/registrations/registrations-table.tsx`
- Test: `apps/web/app/(admin)/registrations/registrations-table.test.tsx` (modify)

**Interfaces:**
- Consumes: `useTableParams().setFilter` (existing; already wrapped in a transition internally).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Add to `app/(admin)/registrations/registrations-table.test.tsx`. The existing mock returns a static `activeFilters`, so the URL never actually updates in this test — which is precisely the condition being asserted: the modal must open *without* it.

```tsx
  it("opens the detail modal without waiting for the URL to update", async () => {
    const user = userEvent.setup();
    // activeFilters has NO `reg` key and the mocked setFilter never writes one
    // back, so a modal that waits on the URL can never open here. That is the
    // regression this pins: before, `reg` was read straight from activeFilters
    // and opening cost a full server round trip.
    render(
      <RegistrationsTable
        rows={rows} total={2} page={1} per={25} sort={[]}
        activeFilters={{}} q="" categories={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /View Maria Josefa Santos/ }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // Still syncs the URL behind the modal, so the registration stays linkable.
    expect(tableParamsSpies.setFilter).toHaveBeenCalledWith("reg", "r1");
  });

  it("closes the modal without waiting for the URL either", async () => {
    const user = userEvent.setup();
    // Opposite direction: `reg` IS in the URL and the mock will never clear it.
    render(
      <RegistrationsTable
        rows={rows} total={2} page={1} per={25} sort={[]}
        activeFilters={{ reg: "r1" }} q="" categories={[]}
      />,
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(tableParamsSpies.setFilter).toHaveBeenCalledWith("reg", "all");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter web test registrations-table
```

Expected: FAIL — the first case times out finding the dialog (open state is derived purely from `activeFilters.reg`), and the second finds the dialog still present after Close.

- [ ] **Step 3: Implement**

In `app/(admin)/registrations/registrations-table.tsx`, add `useEffect` to the React import, then replace the `selectedId` / `selected` derivation:

```tsx
  // The URL stays the source of truth — `?reg=<id>` is what makes a
  // registration linkable, and a cold load of that URL still resolves
  // server-side. But the modal must not WAIT for it: RegistrationDetail renders
  // entirely from a row already in `rows`, so the ~3.3s round trip bought
  // literally nothing.
  //
  // A tri-state override, not a plain `string | null`: closing has to be
  // expressible as "override to nothing" and distinguished from "no override",
  // or Close would leave the modal up until the URL caught up — the exact
  // latency being removed, just in the other direction.
  const [override, setOverride] = useState<{ id: string | null } | null>(null);
  const urlRegId = activeFilters.reg ?? null;

  // Drop the override once the URL agrees — and, just as importantly, when it
  // DISAGREES: a Back button press moves `urlRegId` without going through
  // openReg/closeReg, and a stale override would pin the modal open against it.
  useEffect(() => { setOverride(null); }, [urlRegId]);

  const selectedId = override ? override.id : urlRegId;
  const selected = selectedId ? rows.find((r) => r.id === selectedId) ?? null : null;

  const openReg = useCallback((id: string) => {
    setOverride({ id });        // paints this frame
    setFilter("reg", id);       // catches the URL up in the background
  }, [setFilter]);

  const closeReg = useCallback(() => {
    setOverride({ id: null });
    // "all" is setFilter's own sentinel for "remove this key".
    setFilter("reg", "all");
  }, [setFilter]);
```

Add `useCallback` to the React import. Change the Runner cell's `onClick` from `setFilter("reg", row.original.id)` to `openReg(row.original.id)`, and change the memo dependency from `[setFilter]` to `[openReg]` (`openReg` is `useCallback`-wrapped over the already-stable `setFilter`, so the memo still genuinely memoizes).

Finally, point the modal's handlers at `closeReg`:

```tsx
        <RegistrationDetail
          row={selected}
          onClose={closeReg}
          onRefunded={closeReg}
        />
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter web test registrations-table
```

Expected: PASS, including the pre-existing cases in that file.

- [ ] **Step 5: Run the full suite**

```bash
pnpm --filter web test && pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 6: Verify the linkability contract by hand**

The whole point is that the URL still works. On `https://admin.racepace.lan/registrations`:

1. Click a runner — the modal opens **immediately**, with no wait.
2. The address bar gains `?reg=<uuid>` a moment later.
3. Copy that URL into a new tab — the modal opens on load.
4. Press Back with the modal open — it closes.
5. Press Forward — it reopens.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(admin)/registrations/registrations-table.tsx" "apps/web/app/(admin)/registrations/registrations-table.test.tsx"
git commit -m "feat(admin): open the registration modal without a round trip

RegistrationDetail renders from a row already on the client, so the ~3.3s
server round trip bought nothing. Client state opens it; ?reg= still syncs
behind it, so the URL stays linkable and Back/Forward still work."
```

---

## Verification

After all six tasks, confirm against the spec's Section 5 acceptance criteria:

```bash
pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web test:e2e
```

Then, in a browser on `https://admin.racepace.lan`:

| Check | Expected |
|---|---|
| Change event dropdown (Registrations) | Top bar appears instantly; table skeleton replaces rows |
| Change event picker (Payments) | Same |
| Click page 2 | Top bar + skeleton |
| Type a search term | Top bar + skeleton |
| Click a runner row | Modal opens with **no** perceptible delay; URL gains `?reg=` after |
| Paste a `?reg=` URL in a new tab | Modal opens on load |
| Back/Forward with modal open | Closes / reopens correctly |
| Sidebar navigation | Unchanged — still shows bar + per-link spinner |

Record the dev-server `GET /registrations … in Nms` line before and after. Note that this plan does **not** reduce that number much — it moves work behind a boundary so the shell paints first. The absolute latency is Sections 2–4 of the spec, not this plan. Do not report a wall-clock improvement this plan did not deliver.
