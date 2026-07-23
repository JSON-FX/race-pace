# My Races Tab Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the mobile My Races tab into three segmented groups (Registered / Completed / Unpaid), add a pushed receipt screen for completed events, and let users hard-delete an unpaid registration.

**Architecture:** Pure grouping logic lives in a standalone, clock-injected module (`lib/myRacesGroups.ts`); the screen (`app/(tabs)/races.tsx`) is rewritten to drive a `ToggleGroup` segmented control over that grouping and render a shared `RaceCard`. A new route `app/registration/[registrationId].tsx` shows the payment receipt, fed by an expanded shared `REG_SELECT`. Cancel is a Supabase row delete gated by a new, narrowly-scoped RLS policy. Everything is built from existing `components/ui/` primitives.

**Tech Stack:** Expo (SDK 57) + expo-router, React Native, NativeWind (Tailwind), React Native Reusables (`components/ui/`), `@rn-primitives/*`, TanStack Query, hosted Supabase (`@supabase/supabase-js`), Jest + `@testing-library/react-native`.

## Global Constraints

- **Package manager:** `pnpm@9.7.0`, Node `>=20`.
- **Working directory for all `jest`/file paths below:** the worktree's `apps/mobile/` (`.claude/worktrees/my-races-redesign/apps/mobile`), unless a step says otherwise. Supabase CLI steps run from the worktree root.
- **Test runner:** `pnpm exec jest <pattern>` (the `apps/mobile` `test` script is `jest`). The root `pnpm test` is Vitest for the shared package — do not use it for mobile.
- **Supabase is HOSTED** (project ref `ytwdrsmclwghwktpupqd`). CLI is the pinned dev dependency — invoke as `pnpm exec supabase …` from the worktree root. Migrations live in `supabase/migrations/` and are applied to the linked project.
- **Copy/UX rules:** sentence case, no ALL-CAPS labels except the existing small section eyebrows; trail-green primary `#159A55` comes from tokens — never hardcode colors, use NativeWind classes (`bg-primary`, `text-amber`, `bg-muted`, etc.).
- **Reuse the component library** (`ToggleGroup`, `Card`, `Badge`, `Button`, `Dialog`, `Text`, `Icon`) — no new UI dependency.
- **Dates compare lexically** as ISO `YYYY-MM-DD` strings — no `Date` parsing in the split. Any test that renders `races.tsx` (which reads the real clock) must pin it with `jest.useFakeTimers().setSystemTime(...)`.
- **TDD, DRY, YAGNI, frequent commits.** Every task ends with a passing test and a commit.

---

## Prerequisites (once, before Task 1)

- [ ] **P1: Install dependencies in the worktree**

The worktree has no `node_modules` yet. From the worktree root (`.claude/worktrees/my-races-redesign`):

Run: `pnpm install`
Expected: completes, linking the workspace packages (`@race-pace/shared`, `apps/mobile`).

- [ ] **P2: Confirm the baseline mobile suite is green**

Run (from `apps/mobile`): `pnpm exec jest my-races`
Expected: the existing `__tests__/my-races.test.tsx` passes (2 tests). This is the suite Task 8 rewrites.

---

## Task 1: Shared formatters — `todayIsoNow`, `paymentMethodLabel`

**Files:**
- Modify: `apps/mobile/lib/format.ts`
- Test: `apps/mobile/__tests__/format.test.ts` (create)

**Interfaces:**
- Produces: `todayIsoNow(): string` (local calendar date as `"YYYY-MM-DD"`); `paymentMethodLabel(method: string | null | undefined): string`.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/format.test.ts`:

```ts
import { paymentMethodLabel, todayIsoNow } from "../lib/format";

describe("paymentMethodLabel", () => {
  it("maps known PayMongo methods to display labels", () => {
    expect(paymentMethodLabel("card")).toBe("Card");
    expect(paymentMethodLabel("gcash")).toBe("GCash");
    expect(paymentMethodLabel("maya")).toBe("Maya");
  });
  it("falls back to a dash when the method is missing", () => {
    expect(paymentMethodLabel(null)).toBe("—");
    expect(paymentMethodLabel(undefined)).toBe("—");
  });
  it("passes through an unknown method verbatim", () => {
    expect(paymentMethodLabel("grab_pay")).toBe("grab_pay");
  });
});

describe("todayIsoNow", () => {
  afterEach(() => jest.useRealTimers());
  it("returns the pinned local date as YYYY-MM-DD", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-23T09:00:00"));
    expect(todayIsoNow()).toBe("2026-07-23");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec jest format.test`
Expected: FAIL — `paymentMethodLabel`/`todayIsoNow` are not exported.

- [ ] **Step 3: Add the helpers**

Append to `apps/mobile/lib/format.ts`:

```ts
/** Local calendar date as ISO "YYYY-MM-DD". Uses `new Date()` so tests can pin it
 *  with fake timers. (The Events screen has an inline copy; not refactored here.) */
export function todayIsoNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** PayMongo payment-method code -> display label. */
export function paymentMethodLabel(method: string | null | undefined): string {
  switch (method) {
    case "card": return "Card";
    case "gcash": return "GCash";
    case "maya": return "Maya";
    default: return method ? method : "—";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec jest format.test`
Expected: PASS (5 assertions across 3 + 1 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/format.ts apps/mobile/__tests__/format.test.ts
git commit -m "feat(mobile): add todayIsoNow and paymentMethodLabel formatters"
```

---

## Task 2: Grouping module — `lib/myRacesGroups.ts`

**Files:**
- Create: `apps/mobile/lib/myRacesGroups.ts`
- Test: `apps/mobile/__tests__/my-races-groups.test.ts` (create)

**Interfaces:**
- Consumes: `RegistrationRow` type from `lib/registration.ts` (existing; fields used: `status`, `eventStatus`, `eventDate`).
- Produces:
  - `type SegmentKey = "registered" | "completed" | "unpaid"`
  - `type MyRacesGroups = { registered: RegistrationRow[]; completed: RegistrationRow[]; unpaid: RegistrationRow[]; counts: { registered: number; completed: number; unpaid: number } }`
  - `groupMyRaces(rows: RegistrationRow[], todayIso: string): MyRacesGroups`
  - `defaultSegment(groups: MyRacesGroups): SegmentKey`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/my-races-groups.test.ts`:

```ts
import { groupMyRaces, defaultSegment } from "../lib/myRacesGroups";
import type { RegistrationRow } from "../lib/registration";

const TODAY = "2026-07-23";

function row(overrides: Partial<RegistrationRow> = {}): RegistrationRow {
  return {
    id: "r1", status: "paid", total_amount: 120000, ticket_token: "a.b", org_id: "o1",
    eventName: "Test Race", categoryLabel: "21K", categoryDistance: 21, checkoutUrl: null,
    eventStatus: "open", eventDate: "2026-10-18", originalDate: null, statusNote: null,
    payment: null,
    ...overrides,
  };
}

describe("groupMyRaces", () => {
  it("puts a paid, future-dated race in registered", () => {
    const g = groupMyRaces([row({ id: "a", status: "paid", eventDate: "2026-10-18" })], TODAY);
    expect(g.registered.map((r) => r.id)).toEqual(["a"]);
    expect(g.completed).toHaveLength(0);
  });
  it("puts a paid, past-dated race in completed", () => {
    const g = groupMyRaces([row({ id: "a", status: "paid", eventDate: "2026-01-10" })], TODAY);
    expect(g.completed.map((r) => r.id)).toEqual(["a"]);
    expect(g.registered).toHaveLength(0);
  });
  it("treats a paid race whose event status is 'completed' as completed even if dated ahead", () => {
    const g = groupMyRaces([row({ id: "a", status: "paid", eventStatus: "completed", eventDate: "2026-12-31" })], TODAY);
    expect(g.completed.map((r) => r.id)).toEqual(["a"]);
  });
  it("treats a paid race with no event date as registered", () => {
    const g = groupMyRaces([row({ id: "a", status: "paid", eventDate: null })], TODAY);
    expect(g.registered.map((r) => r.id)).toEqual(["a"]);
  });
  it("puts refunded races in completed", () => {
    const g = groupMyRaces([row({ id: "a", status: "refunded", eventDate: "2026-10-18" })], TODAY);
    expect(g.completed.map((r) => r.id)).toEqual(["a"]);
  });
  it("puts pending races in unpaid", () => {
    const g = groupMyRaces([row({ id: "a", status: "pending" })], TODAY);
    expect(g.unpaid.map((r) => r.id)).toEqual(["a"]);
  });
  it("excludes cancelled races from every group", () => {
    const g = groupMyRaces([row({ id: "a", status: "cancelled" })], TODAY);
    expect(g.registered).toHaveLength(0);
    expect(g.completed).toHaveLength(0);
    expect(g.unpaid).toHaveLength(0);
  });
  it("reports counts", () => {
    const g = groupMyRaces([
      row({ id: "a", status: "paid", eventDate: "2026-10-18" }),
      row({ id: "b", status: "paid", eventDate: "2026-01-01" }),
      row({ id: "c", status: "pending" }),
    ], TODAY);
    expect(g.counts).toEqual({ registered: 1, completed: 1, unpaid: 1 });
  });
});

describe("defaultSegment", () => {
  it("defaults to registered", () => {
    const g = groupMyRaces([row({ status: "paid", eventDate: "2026-10-18" })], TODAY);
    expect(defaultSegment(g)).toBe("registered");
  });
  it("falls back to unpaid when registered is empty but unpaid isn't", () => {
    const g = groupMyRaces([row({ status: "pending" })], TODAY);
    expect(defaultSegment(g)).toBe("unpaid");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec jest my-races-groups`
Expected: FAIL — `../lib/myRacesGroups` cannot be found.

- [ ] **Step 3: Write the module**

Create `apps/mobile/lib/myRacesGroups.ts`:

```ts
import type { RegistrationRow } from "./registration";

export type SegmentKey = "registered" | "completed" | "unpaid";

export type MyRacesGroups = {
  registered: RegistrationRow[];
  completed: RegistrationRow[];
  unpaid: RegistrationRow[];
  counts: { registered: number; completed: number; unpaid: number };
};

/** Split registrations into the three My Races segments. Pure — `todayIso`
 *  ("YYYY-MM-DD") is injected so the split is deterministic and testable.
 *  ISO dates compare lexically, so no Date parsing is needed. */
export function groupMyRaces(rows: RegistrationRow[], todayIso: string): MyRacesGroups {
  const registered: RegistrationRow[] = [];
  const completed: RegistrationRow[] = [];
  const unpaid: RegistrationRow[] = [];

  for (const r of rows) {
    if (r.status === "pending") {
      unpaid.push(r);
    } else if (r.status === "refunded") {
      completed.push(r);
    } else if (r.status === "paid") {
      const isPast = r.eventStatus === "completed" || (r.eventDate != null && r.eventDate < todayIso);
      (isPast ? completed : registered).push(r);
    }
    // "cancelled" (cancel hard-deletes) and any unknown status are excluded.
  }

  return {
    registered,
    completed,
    unpaid,
    counts: { registered: registered.length, completed: completed.length, unpaid: unpaid.length },
  };
}

/** Initial segment: Registered, unless it's empty and there are unpaid items to act on. */
export function defaultSegment(groups: MyRacesGroups): SegmentKey {
  if (groups.counts.registered === 0 && groups.counts.unpaid > 0) return "unpaid";
  return "registered";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec jest my-races-groups`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/myRacesGroups.ts apps/mobile/__tests__/my-races-groups.test.ts
git commit -m "feat(mobile): add pure groupMyRaces split for the My Races segments"
```

---

## Task 3: Expand `REG_SELECT` + `payment` mapping + `cancelRegistration`

**Files:**
- Modify: `apps/mobile/lib/registration.ts`
- Test: `apps/mobile/__tests__/registration-hooks.test.tsx:1-40` (extend the existing mock + assertion)
- Test: `apps/mobile/__tests__/registration-cancel.test.ts` (create)

**Interfaces:**
- Produces:
  - `type RegistrationPayment = { createdAt: string | null; method: string | null; amount: number | null; platformFee: number | null; netToOrg: number | null; provider: string | null; providerRef: string | null; status: string | null }`
  - `RegistrationRow` gains `payment: RegistrationPayment | null`
  - `cancelRegistration(rid: string): Promise<void>`
- Consumes: existing `supabase` client, existing `REG_SELECT`/`mapReg`.

- [ ] **Step 1: Extend the hooks test (payment mapping) and add the cancel test**

In `apps/mobile/__tests__/registration-hooks.test.tsx`, extend the mocked `payments` row and add a payment assertion. Replace the `payments: [...]` line inside `mockMaybeSingle` with:

```ts
    payments: [{
      checkout_url: "http://x/functions/v1/fake-checkout?rid=r1",
      created_at: "2026-03-06T02:15:00Z", method: "gcash", amount: 120000,
      platform_fee: 6000, net_to_org: 114000, provider: "paymongo",
      provider_ref: "cs_abc123", status: "paid",
    }],
```

And extend the existing `toMatchObject` assertion (add a sibling assertion after it):

```ts
    expect(result.current.data?.payment).toMatchObject({
      createdAt: "2026-03-06T02:15:00Z", method: "gcash", amount: 120000,
      platformFee: 6000, netToOrg: 114000, provider: "paymongo", providerRef: "cs_abc123", status: "paid",
    });
```

Create `apps/mobile/__tests__/registration-cancel.test.ts`:

```ts
const mockEq = jest.fn().mockResolvedValue({ error: null });
const mockDelete = jest.fn(() => ({ eq: mockEq }));
jest.mock("../lib/supabase", () => ({
  supabase: { from: jest.fn(() => ({ delete: mockDelete })) },
  FunctionsHttpError: class {},
}));

import { cancelRegistration } from "../lib/registration";
import { supabase } from "../lib/supabase";

describe("cancelRegistration", () => {
  beforeEach(() => jest.clearAllMocks());

  it("deletes the registration row by id", async () => {
    await cancelRegistration("r1");
    expect(supabase.from).toHaveBeenCalledWith("registrations");
    expect(mockDelete).toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalledWith("id", "r1");
  });

  it("throws when Supabase returns an error", async () => {
    mockEq.mockResolvedValueOnce({ error: { message: "denied" } });
    await expect(cancelRegistration("r1")).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run both tests to verify they fail**

Run: `pnpm exec jest registration-cancel registration-hooks`
Expected: FAIL — `cancelRegistration` is not exported; `data.payment` is `undefined`.

- [ ] **Step 3: Implement the query expansion, mapping, and cancel**

In `apps/mobile/lib/registration.ts`:

1. Replace the `REG_SELECT` constant with the payment-expanded select:

```ts
const REG_SELECT =
  "id,status,total_amount,ticket_token,org_id,events(name,status,event_date,original_date,status_note),categories(label,distance_km),payments(checkout_url,created_at,method,amount,platform_fee,net_to_org,provider,provider_ref,status)";
```

2. Add the payment type and extend `RegistrationRow` (place `RegistrationPayment` above `RegistrationRow`, add the `payment` field to the type):

```ts
export type RegistrationPayment = {
  createdAt: string | null; method: string | null; amount: number | null;
  platformFee: number | null; netToOrg: number | null; provider: string | null;
  providerRef: string | null; status: string | null;
};
```

Add to `RegistrationRow` (after `statusNote`):

```ts
  payment: RegistrationPayment | null;
```

3. In `mapReg`, after the existing `checkoutUrl` line, add the mapped `payment` object to the returned literal:

```ts
    payment: payment
      ? {
          createdAt: payment.created_at ?? null, method: payment.method ?? null,
          amount: payment.amount ?? null, platformFee: payment.platform_fee ?? null,
          netToOrg: payment.net_to_org ?? null, provider: payment.provider ?? null,
          providerRef: payment.provider_ref ?? null, status: payment.status ?? null,
        }
      : null,
```

4. Add the cancel function at the end of the file:

```ts
/** Permanently delete an unpaid (pending) registration. The RLS policy
 *  `registrations_delete_own_pending` restricts this to the owner's own
 *  pending rows; the pending payment and addons cascade away. Not for paid
 *  registrations — those are refunded admin-side, never deleted here. */
export async function cancelRegistration(rid: string): Promise<void> {
  const { error } = await supabase.from("registrations").delete().eq("id", rid);
  if (error) throw error;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec jest registration-cancel registration-hooks`
Expected: PASS — payment mapping asserted, cancel delete chain asserted, error path throws.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/registration.ts apps/mobile/__tests__/registration-hooks.test.tsx apps/mobile/__tests__/registration-cancel.test.ts
git commit -m "feat(mobile): expand registration query with payment fields and add cancelRegistration"
```

---

## Task 4: RLS migration — allow cancelling own pending registration

**Files:**
- Create: `supabase/migrations/20260723120000_registrations_cancel_own_pending.sql`

**Interfaces:**
- Produces: a `delete` grant + policy enabling `cancelRegistration` (Task 3) for the row owner on `status = 'pending'` rows only.

> This task changes the **hosted** database. It has no Jest test (RLS runs in Postgres, not the RN test env); verification is applying the SQL cleanly and confirming the policy exists. Correctness of the JS caller is already covered by Task 3.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260723120000_registrations_cancel_own_pending.sql`:

```sql
-- Let a runner cancel (delete) their own registration while it is still unpaid.
-- Pending registrations never took a category slot (increment_slot runs only on
-- payment confirmation), so no slot bookkeeping is needed here. Deleting the row
-- cascades to its pending payment and addons (both ON DELETE CASCADE).
grant delete on registrations to authenticated;

create policy "registrations_delete_own_pending" on registrations
  for delete using (auth.uid() = user_id and status = 'pending');
```

- [ ] **Step 2: Apply the migration to the linked project**

Run (from the worktree root): `pnpm exec supabase db push`
Expected: the CLI lists `20260723120000_registrations_cancel_own_pending.sql` as pending and applies it to project `ytwdrsmclwghwktpupqd` without error.

- [ ] **Step 3: Verify the policy exists**

Run (from the worktree root):
`pnpm exec supabase db query --linked "select policyname, cmd from pg_policies where tablename = 'registrations' order by policyname;"`
Expected: the output includes `registrations_delete_own_pending | DELETE` alongside the existing `registrations_read_own` and admin read policies.

> If `supabase db query` is unavailable in this CLI build, run the same `select` through the Supabase MCP `execute_sql` tool (project `ytwdrsmclwghwktpupqd`) or the SQL editor in the dashboard.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260723120000_registrations_cancel_own_pending.sql
git commit -m "feat(db): allow deleting own pending registration via scoped RLS policy"
```

---

## Task 5: `Badge` variants — `unpaid`, `refunded`

**Files:**
- Modify: `apps/mobile/components/ui/badge.tsx`
- Test: `apps/mobile/__tests__/badge-variants.test.tsx` (create)

**Interfaces:**
- Produces: two new `Badge` `variant` values — `unpaid` (amber tint) and `refunded` (info/blue tint) — reusing the `amber-tint`/`text-amber` and `info-tint`/`text-info` tokens already used by the `almost_full`/`rescheduled` variants.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/badge-variants.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";
import { Badge } from "../components/ui/badge";
import { Text } from "../components/ui/text";

describe("Badge new variants", () => {
  it("renders an unpaid badge", () => {
    render(<Badge variant="unpaid"><Text>Unpaid</Text></Badge>);
    expect(screen.getByText("Unpaid")).toBeOnTheScreen();
  });
  it("renders a refunded badge", () => {
    render(<Badge variant="refunded"><Text>Refunded</Text></Badge>);
    expect(screen.getByText("Refunded")).toBeOnTheScreen();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec jest badge-variants`
Expected: FAIL — TypeScript rejects `variant="unpaid"` / `"refunded"` (not assignable), the test file won't compile.

- [ ] **Step 3: Add the variants**

In `apps/mobile/components/ui/badge.tsx`, add two entries to `badgeVariants` → `variants.variant` (after the `paid:` line):

```ts
        unpaid: 'bg-amber-tint border-transparent',
        refunded: 'bg-info-tint border-transparent',
```

And two matching entries to `badgeTextVariants` → `variants.variant` (after the `paid:` line):

```ts
      unpaid: 'text-amber',
      refunded: 'text-info',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec jest badge-variants`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/ui/badge.tsx apps/mobile/__tests__/badge-variants.test.tsx
git commit -m "feat(mobile): add unpaid and refunded Badge variants"
```

---

## Task 6: `RaceCard` component

**Files:**
- Create: `apps/mobile/components/RaceCard.tsx`
- Test: `apps/mobile/__tests__/race-card.test.tsx` (create)

**Interfaces:**
- Consumes: `Card`, `Badge` (incl. Task 5 variants), `Button`, `Icon`, `Text`.
- Produces:
  - `type RaceCardVariant = "registered" | "completed" | "refunded" | "unpaid"`
  - `RaceCard(props: { variant: RaceCardVariant; title: string; meta?: string | null; distanceKm?: number | null; onPress?: () => void; onPay?: () => void; onCancel?: () => void })`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/race-card.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react-native";
import { RaceCard } from "../components/RaceCard";

describe("RaceCard", () => {
  it("shows title, meta, distance and a status badge", () => {
    render(<RaceCard variant="registered" title="Kalatungan Skyrun" meta="21K · Oct 18" distanceKm={21} />);
    expect(screen.getByText("Kalatungan Skyrun")).toBeOnTheScreen();
    expect(screen.getByText("21K · Oct 18")).toBeOnTheScreen();
    expect(screen.getByText("21")).toBeOnTheScreen();
    expect(screen.getByText("Registered")).toBeOnTheScreen();
  });

  it("fires onPress when the card body is tapped", () => {
    const onPress = jest.fn();
    render(<RaceCard variant="completed" title="Mt. Apo Sky Race" distanceKm={50} onPress={onPress} />);
    expect(screen.getByText("Completed")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Mt. Apo Sky Race"));
    expect(onPress).toHaveBeenCalled();
  });

  it("renders pay and cancel actions only for the unpaid variant", () => {
    const onPay = jest.fn();
    const onCancel = jest.fn();
    render(<RaceCard variant="unpaid" title="Sierra Madre Challenge" distanceKm={21} onPay={onPay} onCancel={onCancel} />);
    expect(screen.getByText("Unpaid")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Complete payment"));
    fireEvent.press(screen.getByText("Cancel"));
    expect(onPay).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec jest race-card`
Expected: FAIL — `../components/RaceCard` cannot be found.

- [ ] **Step 3: Write the component**

Create `apps/mobile/components/RaceCard.tsx`:

```tsx
import { View, Pressable } from "react-native";
import { ChevronRight, CreditCard } from "lucide-react-native";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";

export type RaceCardVariant = "registered" | "completed" | "refunded" | "unpaid";

const BADGE: Record<RaceCardVariant, { variant: "paid" | "completed" | "refunded" | "unpaid"; label: string }> = {
  registered: { variant: "paid", label: "Registered" },
  completed: { variant: "completed", label: "Completed" },
  refunded: { variant: "refunded", label: "Refunded" },
  unpaid: { variant: "unpaid", label: "Unpaid" },
};

export function RaceCard({
  variant, title, meta, distanceKm, onPress, onPay, onCancel,
}: {
  variant: RaceCardVariant;
  title: string;
  meta?: string | null;
  distanceKm?: number | null;
  onPress?: () => void;
  onPay?: () => void;
  onCancel?: () => void;
}) {
  const badge = BADGE[variant];
  const green = variant === "registered";
  const isUnpaid = variant === "unpaid";
  const showChevron = variant === "completed" || variant === "refunded";

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card className="mb-3 rounded-[14px] p-4 shadow-none shadow-transparent">
        <View className="flex-row items-center gap-3.5">
          <View className={`h-[46px] w-[46px] items-center justify-center rounded-[13px] ${green ? "bg-secondary" : "bg-muted"}`}>
            <Text className={`text-[13px] font-bold leading-[15px] ${green ? "text-primary" : "text-muted-foreground"}`}>{distanceKm ?? "—"}</Text>
            <Text className={`text-[9px] font-bold ${green ? "text-primary" : "text-muted-foreground"}`}>KM</Text>
          </View>
          <View className="flex-1">
            <Text className="text-[15px] font-semibold text-foreground">{title}</Text>
            {meta ? <Text className="mt-0.5 text-xs text-muted-foreground">{meta}</Text> : null}
          </View>
          <Badge variant={badge.variant}><Text>{badge.label}</Text></Badge>
          {showChevron ? <Icon as={ChevronRight} size={18} className="text-muted-foreground" /> : null}
        </View>

        {isUnpaid ? (
          <View className="mt-3 flex-row gap-2">
            <Button className="h-auto flex-1 flex-row gap-1.5 py-2.5" onPress={onPay} accessibilityRole="button">
              <Icon as={CreditCard} size={16} className="text-primary-foreground" />
              <Text className="text-[13px] font-semibold text-primary-foreground">Complete payment</Text>
            </Button>
            <Button variant="outline" className="h-auto py-2.5" onPress={onCancel} accessibilityRole="button">
              <Text className="text-[13px] font-semibold text-destructive">Cancel</Text>
            </Button>
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec jest race-card`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/RaceCard.tsx apps/mobile/__tests__/race-card.test.tsx
git commit -m "feat(mobile): add shared RaceCard for the My Races segments"
```

---

## Task 7: Receipt route — `app/registration/[registrationId].tsx`

**Files:**
- Create: `apps/mobile/app/registration/[registrationId].tsx`
- Test: `apps/mobile/__tests__/registration-receipt.test.tsx` (create)

**Interfaces:**
- Consumes: `useRegistration` (returns `RegistrationRow` incl. `payment` from Task 3), `longDate` + `paymentMethodLabel` (Task 1), `formatPeso`, `Badge` (Task 5 variants), `Icon`, `Text`.
- Produces: the default-exported `RegistrationReceipt` screen at route `/registration/[registrationId]`.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/registration-receipt.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react-native";

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => ({ registrationId: "r1abcdef99" }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

let mockReg: any;
jest.mock("../lib/registration", () => ({ useRegistration: () => mockReg }));

import RegistrationReceipt from "../app/registration/[registrationId]";

describe("Registration receipt", () => {
  it("shows the payment breakdown, the deferred check-in row, and links to the race pass", () => {
    mockReg = {
      isLoading: false,
      data: {
        id: "r1abcdef99", status: "paid", eventName: "Mt. Apo Sky Race",
        categoryLabel: "Sky Race", categoryDistance: 50,
        payment: { createdAt: "2026-03-06T02:15:00Z", method: "gcash", amount: 120000, platformFee: 6000, netToOrg: 114000, provider: "paymongo", providerRef: "cs_abc123", status: "paid" },
      },
    };
    render(<RegistrationReceipt />);
    expect(screen.getByText("Mt. Apo Sky Race")).toBeOnTheScreen();
    expect(screen.getByText("Completed")).toBeOnTheScreen();
    expect(screen.getByText("GCash")).toBeOnTheScreen();
    expect(screen.getByText("Mar 6, 2026")).toBeOnTheScreen();
    expect(screen.getByText("cs_abc123")).toBeOnTheScreen();
    expect(screen.getByText("Not recorded yet")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("View race pass"));
    expect(mockPush).toHaveBeenCalledWith("/ticket/r1abcdef99");
  });

  it("shows a Refunded badge and hides the race pass link for a refunded registration", () => {
    mockReg = {
      isLoading: false,
      data: {
        id: "r1abcdef99", status: "refunded", eventName: "Cordillera Run",
        categoryLabel: "21K", categoryDistance: 21,
        payment: { createdAt: "2025-11-01T00:00:00Z", method: "card", amount: 90000, platformFee: 4500, netToOrg: 85500, provider: "paymongo", providerRef: null, status: "refunded" },
      },
    };
    render(<RegistrationReceipt />);
    expect(screen.getByText("Refunded")).toBeOnTheScreen();
    expect(screen.queryByText("View race pass")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec jest registration-receipt`
Expected: FAIL — `../app/registration/[registrationId]` cannot be found.

- [ ] **Step 3: Write the screen**

Create `apps/mobile/app/registration/[registrationId].tsx`:

```tsx
import { View, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MapPinCheck, QrCode } from "lucide-react-native";
import { formatPeso } from "@race-pace/shared";
import { useRegistration } from "../../lib/registration";
import { longDate, paymentMethodLabel } from "../../lib/format";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";

export default function RegistrationReceipt() {
  const { registrationId } = useLocalSearchParams<{ registrationId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reg = useRegistration(registrationId);
  const ref = registrationId.slice(0, 8).toUpperCase();

  if (reg.isLoading && !reg.data) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator className="text-primary" />
      </View>
    );
  }

  const p = reg.data?.payment ?? null;
  const refunded = reg.data?.status === "refunded";
  const reference = p?.providerRef || ref;
  const subtitle = [reg.data?.categoryDistance ? `${reg.data.categoryDistance}K` : null, reg.data?.categoryLabel]
    .filter(Boolean)
    .join(" · ");

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: insets.top + 6, paddingHorizontal: 22, paddingBottom: insets.bottom + 30 }}
      showsVerticalScrollIndicator={false}
    >
      <Pressable onPress={() => router.back()} accessibilityRole="button" className="py-2">
        <Text className="text-[15px] font-medium text-primary">‹ My Races</Text>
      </Pressable>

      <Text className="mt-1 text-[22px] font-bold tracking-[-0.3px] text-foreground">{reg.data?.eventName ?? "Race"}</Text>
      <View className="mt-1.5 flex-row items-center gap-2">
        {subtitle ? <Text className="text-[13px] text-muted-foreground">{subtitle}</Text> : null}
        <Badge variant={refunded ? "refunded" : "completed"}><Text>{refunded ? "Refunded" : "Completed"}</Text></Badge>
      </View>

      <Text className="mb-2 mt-[22px] text-[11px] font-semibold tracking-[0.4px] text-muted-foreground">PAYMENT</Text>
      <View className="rounded-[14px] border border-border bg-card px-4">
        <Row label="Paid on" value={p?.createdAt ? longDate(p.createdAt.slice(0, 10)) : "—"} />
        <Row label="Method" value={paymentMethodLabel(p?.method)} />
        <Row label="Amount" value={p?.amount != null ? formatPeso(p.amount) : "—"} />
        <Row label="Platform fee" value={p?.platformFee != null ? formatPeso(p.platformFee) : "—"} />
        <Row label="Reference" value={reference} mono last />
      </View>

      <Text className="mb-2 mt-[18px] text-[11px] font-semibold tracking-[0.4px] text-muted-foreground">RACE DAY</Text>
      <View className="flex-row items-center justify-between rounded-[14px] border border-border bg-card p-4">
        <View className="flex-row items-center gap-2.5">
          <Icon as={MapPinCheck} size={18} className="text-muted-foreground" />
          <Text className="text-[13px] text-muted-foreground">Check-in</Text>
        </View>
        <Text className="text-[12px] text-muted-foreground">Not recorded yet</Text>
      </View>

      {reg.data?.status === "paid" ? (
        <Pressable
          onPress={() => router.push(`/ticket/${registrationId}`)}
          accessibilityRole="button"
          className="mt-3 flex-row items-center justify-center gap-2 rounded-[12px] border border-border py-3"
        >
          <Icon as={QrCode} size={17} className="text-primary" />
          <Text className="text-[14px] font-semibold text-primary">View race pass</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function Row({ label, value, mono, last }: { label: string; value: string; mono?: boolean; last?: boolean }) {
  return (
    <View className={`flex-row items-center justify-between py-3 ${last ? "" : "border-b border-border"}`}>
      <Text className="text-[13px] text-muted-foreground">{label}</Text>
      <Text className="text-[13px] font-semibold text-foreground" style={mono ? { fontFamily: "Courier" } : undefined}>{value}</Text>
    </View>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec jest registration-receipt`
Expected: PASS (2 tests). (`longDate("2026-03-06")` → `"Mar 6, 2026"`.)

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/registration/[registrationId].tsx apps/mobile/__tests__/registration-receipt.test.tsx
git commit -m "feat(mobile): add completed-registration receipt screen"
```

---

## Task 8: Rewrite `app/(tabs)/races.tsx` — segmented layout + cancel dialog

**Files:**
- Modify (rewrite): `apps/mobile/app/(tabs)/races.tsx`
- Test: `apps/mobile/__tests__/my-races.test.tsx` (rewrite)

**Interfaces:**
- Consumes: `useMyRegistrations`, `cancelRegistration`, `RegistrationRow` (Task 3); `groupMyRaces`, `defaultSegment`, `SegmentKey` (Task 2); `todayIsoNow`, `shortDate` (Task 1 + existing); `formatPeso`; `RaceCard` (Task 6); `ToggleGroup`/`ToggleGroupItem`, `Dialog*`, `Button`, `Text`; `useGlobalRefresh`, `ticketCache`.
- Produces: the rewritten default-exported `MyRaces` screen.

- [ ] **Step 1: Rewrite the test**

Replace the entire contents of `apps/mobile/__tests__/my-races.test.tsx` with:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { PortalHost } from "@rn-primitives/portal";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../lib/ticketCache", () => ({ cacheMyRaces: jest.fn(), getCachedMyRaces: jest.fn().mockResolvedValue([]) }));
jest.mock("../lib/useGlobalRefresh", () => ({ useGlobalRefresh: () => ({ refreshing: false, onRefresh: jest.fn() }) }));

const mockInvalidate = jest.fn();
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));

let mockMyRegResult: any;
const mockCancel = jest.fn().mockResolvedValue(undefined);
jest.mock("../lib/registration", () => ({
  useMyRegistrations: () => mockMyRegResult,
  cancelRegistration: (...args: any[]) => mockCancel(...args),
}));

import MyRaces from "../app/(tabs)/races";
import { getCachedMyRaces } from "../lib/ticketCache";

function row(o: any) {
  return {
    id: "r", status: "paid", total_amount: 120000, ticket_token: "a.b", org_id: "o1",
    eventName: "Race", categoryLabel: "21K", categoryDistance: 21, checkoutUrl: null,
    eventStatus: "open", eventDate: "2026-10-18", originalDate: null, statusNote: null, payment: null, ...o,
  };
}

function renderScreen() {
  return render(<><MyRaces /><PortalHost /></>);
}

describe("My Races (segmented)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date("2026-07-23T12:00:00"));
  });
  afterEach(() => jest.useRealTimers());

  it("defaults to Registered and shows segment counts", async () => {
    mockMyRegResult = {
      data: [
        row({ id: "reg1", status: "paid", eventName: "Kalatungan Skyrun", eventDate: "2026-10-18" }),
        row({ id: "done1", status: "paid", eventName: "Mt. Apo Sky Race", eventDate: "2026-01-10" }),
        row({ id: "pay1", status: "pending", eventName: "Sierra Madre Challenge" }),
      ],
      isLoading: false, isError: false, refetch: jest.fn(),
    };
    renderScreen();
    expect(await screen.findByText("Registered 1")).toBeOnTheScreen();
    expect(screen.getByText("Completed 1")).toBeOnTheScreen();
    expect(screen.getByText("Unpaid 1")).toBeOnTheScreen();
    // Registered is active by default.
    expect(screen.getByText("Kalatungan Skyrun")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Kalatungan Skyrun"));
    expect(mockPush).toHaveBeenCalledWith("/ticket/reg1");
  });

  it("switches to Completed and routes a completed card to its receipt", async () => {
    mockMyRegResult = {
      data: [row({ id: "done1", status: "paid", eventName: "Mt. Apo Sky Race", eventDate: "2026-01-10" })],
      isLoading: false, isError: false, refetch: jest.fn(),
    };
    renderScreen();
    fireEvent.press(await screen.findByLabelText("Completed"));
    fireEvent.press(screen.getByText("Mt. Apo Sky Race"));
    expect(mockPush).toHaveBeenCalledWith("/registration/done1");
  });

  it("cancels an unpaid registration through the confirm dialog", async () => {
    mockMyRegResult = {
      data: [row({ id: "pay1", status: "pending", eventName: "Sierra Madre Challenge" })],
      isLoading: false, isError: false, refetch: jest.fn(),
    };
    renderScreen();
    // Registered empty + unpaid present -> defaults to Unpaid.
    fireEvent.press(await screen.findByText("Cancel"));
    expect(screen.getByText("Cancel this registration?")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Cancel registration"));
    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith("pay1"));
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ["my-registrations"] });
  });

  it("falls back to cached races when offline", async () => {
    mockMyRegResult = { data: undefined, isLoading: false, isError: true, refetch: jest.fn() };
    (getCachedMyRaces as jest.Mock).mockResolvedValueOnce([
      { rid: "rc1", token: "a.b", eventName: "Cotabato Skyrace 42", categoryLabel: "42K", runnerName: "", status: "paid", orgId: "o1" },
    ]);
    renderScreen();
    expect(await screen.findByText("Cotabato Skyrace 42")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Cotabato Skyrace 42"));
    expect(mockPush).toHaveBeenCalledWith("/ticket/rc1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec jest my-races.test`
Expected: FAIL — the current screen has no segments (`"Registered 1"` not found).

- [ ] **Step 3: Rewrite the screen**

Replace the entire contents of `apps/mobile/app/(tabs)/races.tsx` with:

```tsx
import { useEffect, useMemo, useState } from "react";
import { View, FlatList, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { formatPeso } from "@race-pace/shared";
import { useMyRegistrations, cancelRegistration, type RegistrationRow } from "../../lib/registration";
import { useGlobalRefresh } from "../../lib/useGlobalRefresh";
import { cacheMyRaces, getCachedMyRaces, type CachedTicket } from "../../lib/ticketCache";
import { groupMyRaces, defaultSegment, type SegmentKey } from "../../lib/myRacesGroups";
import { shortDate, todayIsoNow } from "../../lib/format";
import { RaceCard } from "../../components/RaceCard";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

const SEGMENTS: { key: SegmentKey; label: string }[] = [
  { key: "registered", label: "Registered" },
  { key: "completed", label: "Completed" },
  { key: "unpaid", label: "Unpaid" },
];

const EMPTY_COPY: Record<SegmentKey, { title: string; body: string }> = {
  registered: { title: "No upcoming races", body: "Races you've paid for show up here until race day." },
  completed: { title: "No completed races", body: "Finished races land here with your receipt." },
  unpaid: { title: "Nothing to pay", body: "Registrations awaiting payment show up here." },
};

function cachedToRows(cached: CachedTicket[]): RegistrationRow[] {
  return cached.map((c) => ({
    id: c.rid, status: c.status, total_amount: 0, ticket_token: c.token, org_id: c.orgId,
    eventName: c.eventName, categoryLabel: c.categoryLabel, categoryDistance: null, checkoutUrl: null,
    eventStatus: null, eventDate: null, originalDate: null, statusNote: null, payment: null,
  }));
}

export default function MyRaces() {
  const { data, isLoading, isError, refetch } = useMyRegistrations();
  const { refreshing, onRefresh } = useGlobalRefresh();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [cached, setCached] = useState<CachedTicket[] | null>(null);
  const [segment, setSegment] = useState<SegmentKey | null>(null);
  const [pendingCancel, setPendingCancel] = useState<RegistrationRow | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  useEffect(() => { getCachedMyRaces().then(setCached).catch(() => setCached([])); }, []);

  useEffect(() => {
    if (data) {
      cacheMyRaces(data.map((r) => ({
        rid: r.id, token: r.ticket_token, eventName: r.eventName, categoryLabel: r.categoryLabel,
        runnerName: "", status: r.status, orgId: r.org_id,
      })));
    }
  }, [data]);

  const rows: RegistrationRow[] = data ?? (cached ? cachedToRows(cached) : []);
  const groups = useMemo(() => groupMyRaces(rows, todayIsoNow()), [rows]);
  const activeSegment: SegmentKey = segment ?? defaultSegment(groups);

  if (!data && (cached === null || isLoading)) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator className="text-primary" />
      </View>
    );
  }
  if (isError && !data && rows.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Pressable onPress={() => refetch()} accessibilityRole="button">
          <Text className="text-destructive">Couldn't load. Tap to retry.</Text>
        </Pressable>
      </View>
    );
  }

  async function confirmCancel() {
    if (!pendingCancel) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelRegistration(pendingCancel.id);
      await queryClient.invalidateQueries({ queryKey: ["my-registrations"] });
      setPendingCancel(null);
    } catch {
      setCancelError("Couldn't cancel. Try again.");
    } finally {
      setCancelling(false);
    }
  }

  function renderCard(item: RegistrationRow) {
    if (activeSegment === "unpaid") {
      const meta = [item.categoryLabel, item.total_amount ? `${formatPeso(item.total_amount)} due` : null].filter(Boolean).join(" · ");
      return (
        <RaceCard
          variant="unpaid" title={item.eventName} meta={meta} distanceKm={item.categoryDistance}
          onPress={() => router.push(`/pay/${item.id}`)}
          onPay={() => router.push(`/pay/${item.id}`)}
          onCancel={() => { setCancelError(null); setPendingCancel(item); }}
        />
      );
    }
    const meta = [item.categoryLabel, item.eventDate ? shortDate(item.eventDate) : null].filter(Boolean).join(" · ");
    if (activeSegment === "completed") {
      const refunded = item.status === "refunded";
      return (
        <RaceCard
          variant={refunded ? "refunded" : "completed"} title={item.eventName} meta={meta} distanceKm={item.categoryDistance}
          onPress={() => router.push(`/registration/${item.id}`)}
        />
      );
    }
    return (
      <RaceCard
        variant="registered" title={item.eventName} meta={meta} distanceKm={item.categoryDistance}
        onPress={() => router.push(`/ticket/${item.id}`)}
      />
    );
  }

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={groups[activeSegment]}
        keyExtractor={(r) => r.id}
        contentContainerClassName="px-[22px] pt-2 pb-8"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View>
            <Text className="mb-3 text-3xl font-bold tracking-[-0.5px] text-foreground">My races</Text>
            <View className="mb-2 flex-row rounded-[12px] bg-muted p-[3px]">
              <ToggleGroup
                type="single"
                value={activeSegment}
                onValueChange={(v) => { if (v) setSegment(v as SegmentKey); }}
                className="flex-1 flex-row"
              >
                {SEGMENTS.map((s) => {
                  const active = activeSegment === s.key;
                  const count = groups.counts[s.key];
                  return (
                    <ToggleGroupItem
                      key={s.key}
                      value={s.key}
                      accessibilityLabel={s.label}
                      className={cn("flex-1 rounded-[9px] py-2", active ? "bg-primary" : "bg-transparent")}
                    >
                      <Text
                        className={cn(
                          "text-center text-[12.5px]",
                          active
                            ? "font-semibold text-primary-foreground"
                            : s.key === "unpaid" && count > 0
                              ? "font-semibold text-amber"
                              : "text-muted-foreground"
                        )}
                      >
                        {s.label} {count}
                      </Text>
                    </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View className="items-center pt-16">
            <View className="h-[74px] w-[74px] items-center justify-center rounded-full bg-muted">
              <Text className="text-[30px] text-muted-foreground">⚑</Text>
            </View>
            <Text className="mt-[18px] text-lg font-semibold text-foreground">{EMPTY_COPY[activeSegment].title}</Text>
            <Text className="mt-1.5 max-w-[230px] text-center text-sm text-muted-foreground">{EMPTY_COPY[activeSegment].body}</Text>
            <Pressable
              className="mt-5 rounded-full bg-primary px-[26px] py-[13px]"
              onPress={() => router.push("/(tabs)/events")}
              accessibilityRole="button"
            >
              <Text className="text-[15px] font-semibold text-primary-foreground">Browse events</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => renderCard(item)}
      />

      <Dialog open={pendingCancel !== null} onOpenChange={(o) => { if (!o) { setPendingCancel(null); setCancelError(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this registration?</DialogTitle>
            <DialogDescription>
              This removes {pendingCancel?.eventName}{pendingCancel?.categoryLabel ? ` · ${pendingCancel.categoryLabel}` : ""} from your races. It can't be undone.
            </DialogDescription>
          </DialogHeader>
          {cancelError ? <Text className="text-center text-[13px] text-destructive">{cancelError}</Text> : null}
          <DialogFooter>
            <Button variant="destructive" onPress={confirmCancel} disabled={cancelling} accessibilityRole="button">
              <Text className="font-semibold text-white">{cancelling ? "Cancelling…" : "Cancel registration"}</Text>
            </Button>
            <Button variant="outline" onPress={() => { setPendingCancel(null); setCancelError(null); }} accessibilityRole="button">
              <Text className="font-semibold text-foreground">Keep it</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </View>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec jest my-races.test`
Expected: PASS (4 tests: default/counts, completed→receipt, cancel flow, offline).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/\(tabs\)/races.tsx apps/mobile/__tests__/my-races.test.tsx
git commit -m "feat(mobile): rewrite My Races into segmented Registered/Completed/Unpaid with cancel"
```

---

## Task 9: Full-suite + type verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole mobile test suite**

Run (from `apps/mobile`): `pnpm exec jest`
Expected: PASS — all suites green, including the ones this plan added/changed (`format`, `my-races-groups`, `registration-hooks`, `registration-cancel`, `badge-variants`, `race-card`, `registration-receipt`, `my-races`).

- [ ] **Step 2: Typecheck the workspace**

Run (from the worktree root): `pnpm -r typecheck`
Expected: PASS (or, if `apps/mobile` has no `typecheck` script, it is skipped — in that case run `pnpm exec tsc --noEmit -p apps/mobile/tsconfig.json` from `apps/mobile` and expect no errors).

- [ ] **Step 3: Visually confirm on the simulator (manual)**

Launch the app (see the project's run flow) and walk the three segments, tap a completed card into the receipt, and run a cancel on an unpaid registration. Confirm the segment counts, the amber Unpaid emphasis, and that a cancelled row disappears after confirm.

> No commit — verification only. If anything fails, fix under the owning task's test before proceeding.

---

## Self-Review (completed while writing)

**Spec coverage:**
- §3 segmented layout + default-segment heuristic → Task 8 (`SEGMENTS`, `defaultSegment`).
- §4.1 grouping incl. refunded/null-date/cancelled → Task 2.
- §4.3 query expansion + `paymentMethodLabel` + `formatPeso`/`longDate` → Tasks 1 + 3 + 7.
- §4.4 offline cache preserved → Task 8 (`cachedToRows`).
- Receipt route → Task 7.
- §6 cancel = delete (RLS policy + `cancelRegistration` + Dialog) → Tasks 3 + 4 + 8.
- Reusable-library usage (ToggleGroup/Card/Badge/Button/Dialog/Skeleton) → Tasks 5–8. *Note:* the spec mentioned `Skeleton` loading rows; this plan keeps the existing centered `ActivityIndicator` for load (smaller change, same behavior as today) — Skeleton rows are deferred as optional polish, not a spec requirement gap in behavior.
- §7 error/empty states → Task 8 (per-segment empty copy, retry).
- §8 testing incl. pinned clock → Tasks 2, 8, plus per-unit tests.

**Placeholder scan:** none — every step carries full code or exact commands.

**Type consistency:** `RegistrationRow.payment` / `RegistrationPayment` (Task 3) are consumed with the same field names in Tasks 7 and 8; `SegmentKey`, `groupMyRaces`, `defaultSegment` (Task 2) match their use in Task 8; `RaceCardVariant` values (`registered`/`completed`/`refunded`/`unpaid`) match the `Badge` variants added in Task 5 and the calls in Task 8.
