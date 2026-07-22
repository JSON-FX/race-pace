# Event Cards UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add event date ranges, an address + paid-joined-count line, dropdown positioning/scroll fixes, lighter profile text, a global pull-to-refresh, and a real app icon, per [docs/specs/2026-07-22-event-cards-ux-polish-design.md](../specs/2026-07-22-event-cards-ux-polish-design.md).

**Architecture:** Additive-only Postgres migration (`events.end_date`) feeds a new pure `formatDateRange` helper in `packages/shared`, consumed by both `apps/mobile` (restructured `EventCard`) and `apps/web` (admin editor + list). Mobile also gets a shared `useGlobalRefresh` hook wired into all four data screens, two fixes to the shared `components/ui/select.tsx` primitive, and regenerated app-icon assets.

**Tech Stack:** React Native (Expo, NativeWind, React Native Reusables) + Jest/RTL for `apps/mobile`; React + Vite + Vitest/RTL for `apps/web`; Zod for shared validation; Supabase Postgres for the schema change; `sharp` (temporary devDependency) for one-time icon asset generation.

## Global Constraints

- Already on branch `feat/event-cards-ux-polish` (created off `main`) — every task commits to this branch, never to `main` directly.
- "+N joined" counts **paid registrations only** (`categories.slots_taken`, which increments only at `status = 'paid'`) — never all-registrations.
- The app icon's flattened background is **white** (`#FFFFFF`), not dark forest or brand-green.
- The `align="end"` dropdown-position fix is scoped to **Profile's `SelectRow` only** — `PsgcAddressPicker`'s triggers are already full-width and don't need it.
- The bounded-`ScrollView` scroll fix goes in the **shared** `apps/mobile/components/ui/select.tsx` primitive, benefiting every dropdown app-wide.
- The profile text-weight change (`RVALUE`) touches **field values only** — labels, the header name, BIB badge, and RACES/BLOOD/SHIRT stats keep their existing weight.
- Pull-to-refresh is **one shared hook** (`useGlobalRefresh`) wired into all four data screens (Events, My Races, Organizations, Profile) — no per-screen bespoke refresh logic.
- Date ranges render as a **plain en-dash join** (e.g. "Sep 1 – Sep 3") — no same-month/year elision.
- Items #4 (featured image) and #10 (event-page carousel) are **already shipped** (Plan 11) — out of scope, no tasks here touch `EventGallery` or the card's hero image.
- Splash screen (`splash-icon.png`) and the web favicon are **not** touched — icon work is scoped to the home-screen icon only.

---

## Task 1: `packages/shared` — `formatDateRange` helper

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/index.test.ts`

**Interfaces:**
- Produces: `formatDateRange(startIso: string | null, endIso: string | null, formatOne: (iso: string) => string): string` — exported from `@race-pace/shared`. Used by Task 4 (mobile `EventCard`), and Task 11 (admin `Events.tsx`).

- [ ] **Step 1: Write the failing test**

Open `packages/shared/src/index.test.ts` and add this `describe` block at the end of the file (after the existing `formatAddress` block):

```ts
describe("formatDateRange", () => {
  const fmt = (iso: string) => iso; // identity formatter — isolates range-composition logic from date formatting
  it("returns '' when there is no start date", () => {
    expect(formatDateRange(null, null, fmt)).toBe("");
  });
  it("returns just the start date when there is no end date", () => {
    expect(formatDateRange("2026-09-01", null, fmt)).toBe("2026-09-01");
  });
  it("collapses to a single date when end equals start", () => {
    expect(formatDateRange("2026-09-01", "2026-09-01", fmt)).toBe("2026-09-01");
  });
  it("joins start and end with an en dash when they differ", () => {
    expect(formatDateRange("2026-09-01", "2026-09-03", fmt)).toBe("2026-09-01 – 2026-09-03");
  });
});
```

Add `formatDateRange` to the existing `import` line at the top of the file so the test file compiles (it will fail at the type/reference level until Step 3):

```ts
import {
  customDataSchema, formatPeso, formatAddress, formatDateRange, registrationInputSchema, type FormField,
  PROFILE_KEYS, isProfileKey, BLOOD_TYPES, SHIRT_SIZES, GENDERS,
} from "./index";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/shared/src/index.test.ts`
Expected: FAIL — `formatDateRange` is not exported from `./index` (TypeScript/Vitest reports it as `undefined`, so calling it throws).

- [ ] **Step 3: Write minimal implementation**

Open `packages/shared/src/index.ts` and add this function at the end of the file, after `formatAddress`:

```ts
/** Compose a date range from two ISO dates using the caller's own single-date
 *  formatter, so "same month/year" logic never needs to live in shared code.
 *  No end date, or end === start, collapses to a single formatted date. */
export function formatDateRange(
  startIso: string | null,
  endIso: string | null,
  formatOne: (iso: string) => string
): string {
  if (!startIso) return "";
  if (!endIso || endIso === startIso) return formatOne(startIso);
  return `${formatOne(startIso)} – ${formatOne(endIso)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/shared/src/index.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  13 passed (13)` (9 existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/index.test.ts
git commit -m "feat(shared): add formatDateRange helper"
```

---

## Task 2: Backend — `events.end_date` migration

**Files:**
- Create: `supabase/migrations/<timestamp>_events_date_range.sql`

**Interfaces:**
- Produces: `events.end_date` (nullable `date` column). Used by Task 3 (mobile query), Task 10/11 (admin query + writes).

- [ ] **Step 1: Generate the migration file**

Run: `supabase migration new events_date_range`
Expected: prints the created path, e.g. `Created new migration at supabase/migrations/20260722193000_events_date_range.sql` — use that real timestamped filename for the rest of this task (the placeholder `<timestamp>` above is only for the file list).

- [ ] **Step 2: Write the migration**

Open the generated file and write:

```sql
-- Optional multi-day event support. null = single-day event, identical to
-- today's behavior — no backfill needed.
alter table events add column if not exists end_date date;
```

- [ ] **Step 3: Apply and verify against the linked project**

Run: `supabase db push`
Expected: prompts to confirm, then reports the new migration applied (e.g. `Applying migration 20260722193000_events_date_range.sql... Finished`).

Run: `supabase db query --linked "select column_name, is_nullable from information_schema.columns where table_name = 'events' and column_name = 'end_date'"`
Expected: one row — `end_date | YES`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(db): add nullable events.end_date for multi-day events"
```

---

## Task 3: Mobile data layer — `end_date` + paid-only `joined_count`

**Files:**
- Modify: `apps/mobile/lib/events.ts`
- Test: `apps/mobile/__tests__/events-hooks.test.tsx`

**Interfaces:**
- Consumes: `end_date` column from Task 2.
- Produces: `EventRow.end_date: string | null`, `EventRow.joined_count: number`. Used by Task 4 (`EventCard`).

- [ ] **Step 1: Write the failing test**

Open `apps/mobile/__tests__/events-hooks.test.tsx` and add this test at the end of the `describe("useMarketplaceEvents", ...)` block (after the existing `it(...)`):

```tsx
  it("passes end_date through and sums slots_taken across categories into joined_count", async () => {
    mockOrder.mockResolvedValueOnce({
      data: [{
        id: "e2", org_id: "o1", name: "Trail Fest", status: "open", gallery: null,
        event_date: "2026-09-01", end_date: "2026-09-03",
        categories: [{ slots_taken: 40 }, { slots_taken: 88 }],
        organizations: { name: "Race Pace", brand_color: "#159A55" },
      }],
      error: null,
    });
    const { result } = renderHook(() => useMarketplaceEvents(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toMatchObject({ id: "e2", end_date: "2026-09-03", joined_count: 128 });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter mobile test -- __tests__/events-hooks.test.tsx`
Expected: FAIL — `joined_count` is `undefined` (or the whole `toMatchObject` fails since `end_date`/`joined_count` aren't yet produced by `mapEvent`).

- [ ] **Step 3: Write minimal implementation**

In `apps/mobile/lib/events.ts`, update the `EventRow` type (add `end_date` after `event_date`, `joined_count` before `org_name`):

```ts
export type EventRow = {
  id: string; org_id: string; name: string; place: string | null; region: string | null;
  event_date: string | null; end_date: string | null; elevation_gain_m: number | null; cutoff_hours: number | null;
  status: string; hero_image_url: string | null; description: string | null;
  gallery: string[]; original_date: string | null; status_note: string | null;
  city_psgc_code: string | null; region_name: string | null; province_name: string | null; city_name: string | null; venue: string | null;
  joined_count: number; org_name?: string; org_color?: string | null;
};
```

Update `EVENT_COLS` to add `end_date` and the `categories(slots_taken)` join:

```ts
const EVENT_COLS =
  "id,org_id,name,place,region,event_date,end_date,elevation_gain_m,cutoff_hours,status,hero_image_url,description,gallery,original_date,status_note,city_psgc_code,region_name,province_name,city_name,venue,categories(slots_taken)";
```

Update `mapEvent` to compute `joined_count`:

```ts
function mapEvent(r: any): EventRow {
  const joined_count = ((r.categories ?? []) as { slots_taken: number }[]).reduce((sum, c) => sum + c.slots_taken, 0);
  return { ...r, gallery: r.gallery ?? [], joined_count, org_name: r.organizations?.name, org_color: r.organizations?.brand_color };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter mobile test -- __tests__/events-hooks.test.tsx`
Expected: `Tests: 2 passed, 2 total`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/events.ts apps/mobile/__tests__/events-hooks.test.tsx
git commit -m "feat(mobile): fetch end_date + paid-only joined_count for events"
```

---

## Task 4: Mobile `EventCard` — address, date range, joined-count lines

**Files:**
- Modify: `apps/mobile/components/EventCard.tsx`
- Modify: `apps/mobile/app/event/[id].tsx`
- Test: `apps/mobile/__tests__/event-card.test.tsx`
- Test: `apps/mobile/__tests__/event-address.test.tsx`

**Interfaces:**
- Consumes: `EventRow.end_date`, `EventRow.joined_count` (Task 3); `formatDateRange` (Task 1).

- [ ] **Step 1: Write the failing tests**

Open `apps/mobile/__tests__/event-card.test.tsx`. Add `end_date: null` and `joined_count: 0` to the `base` fixture (required fields on `EventRow` now):

```tsx
const base: EventRow = {
  id: "e1", org_id: "o1", name: "Highland Trail Run", place: null, region: null,
  event_date: "2026-11-14", end_date: null, elevation_gain_m: null, cutoff_hours: null, status: "open",
  hero_image_url: null, description: null, gallery: [], original_date: null, status_note: null,
  city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null,
  joined_count: 0, org_name: "Race Pace", org_color: "#159A55",
};
```

Add these tests at the end of the file:

```tsx
it("shows address and date range as separate lines", () => {
  render(<EventCard event={{ ...base, place: "Digos City", event_date: "2026-09-01", end_date: "2026-09-03" }} onPress={() => {}} />);
  expect(screen.getByText("Digos City")).toBeOnTheScreen();
  expect(screen.getByText("Sep 1 – Sep 3")).toBeOnTheScreen();
});

it("prefixes a cancelled event's date range with 'was'", () => {
  render(<EventCard event={{ ...base, status: "cancelled", event_date: "2026-09-01", end_date: "2026-09-03" }} onPress={() => {}} />);
  expect(screen.getByText("was Sep 1 – Sep 3")).toBeOnTheScreen();
});

it("shows the joined count only when greater than zero", () => {
  render(<EventCard event={{ ...base, joined_count: 128 }} onPress={() => {}} />);
  expect(screen.getByText("+128 joined")).toBeOnTheScreen();
});

it("hides the joined line when nobody has joined yet", () => {
  render(<EventCard event={{ ...base, joined_count: 0 }} onPress={() => {}} />);
  expect(screen.queryByText(/joined/)).toBeNull();
});
```

Now open `apps/mobile/__tests__/event-address.test.tsx` and update its two existing assertions to expect address and date as **separate** text nodes instead of one combined string:

```tsx
describe("Event address display", () => {
  it("card shows formatAddress when PSGC present", () => {
    render(<EventCard event={{ ...base, city_name: "Digos City", province_name: "Davao del Sur", place: "Mt Apo" }} onPress={() => {}} />);
    expect(screen.getByText("Digos City, Davao del Sur")).toBeOnTheScreen();
    expect(screen.getByText("Nov 14")).toBeOnTheScreen();
  });
  it("card falls back to legacy place when no PSGC", () => {
    render(<EventCard event={{ ...base, city_name: null, place: "Mt Apo" }} onPress={() => {}} />);
    expect(screen.getByText("Mt Apo")).toBeOnTheScreen();
    expect(screen.getByText("Nov 14")).toBeOnTheScreen();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter mobile test -- __tests__/event-card.test.tsx __tests__/event-address.test.tsx`
Expected: FAIL — `event-card.test.tsx` fails on the new `it` blocks (no separate lines/joined-count rendered yet); `event-address.test.tsx` fails because the card still renders the old combined `"Digos City, Davao del Sur · Nov 14"` string, not two separate texts.

- [ ] **Step 3: Write minimal implementation**

Replace the contents of `apps/mobile/components/EventCard.tsx`:

```tsx
import { useState } from "react";
import { View, Pressable, Image } from "react-native";
import { formatAddress, formatDateRange } from "@race-pace/shared";
import type { EventRow } from "../lib/events";
import { ElevationHero } from "./ElevationHero";
import { OrgAvatar } from "./OrgAvatar";
import { StatusBadge, eventStatusKind } from "./StatusBadge";
import { shortDate } from "../lib/format";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";

export function EventCard({ event, showOrg = true, onPress }: { event: EventRow; showOrg?: boolean; onPress: () => void }) {
  const cancelled = eventStatusKind(event) === "cancelled";
  const address = formatAddress(event) || event.place;
  const dateRange = event.event_date ? formatDateRange(event.event_date, event.end_date, shortDate) : "";
  const dateLabel = dateRange ? (cancelled ? `was ${dateRange}` : dateRange) : "";
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card className="rounded-[18px] border border-border overflow-hidden bg-card mb-4 gap-0 py-0 shadow-none shadow-transparent">
        <View>
          {event.hero_image_url && !imgFailed ? (
            <Image testID="event-card-image" source={{ uri: event.hero_image_url }} style={{ height: 132, width: "100%" }} resizeMode="cover" onError={() => setImgFailed(true)} />
          ) : (
            <ElevationHero height={132} />
          )}
          <View className="absolute top-3 left-3"><StatusBadge event={event} /></View>
        </View>
        <View className="p-[14px] px-4">
          <Text className="text-[17px] font-semibold tracking-[-0.2px] text-foreground" numberOfLines={1}>{event.name}</Text>
          {address ? <Text className="text-[13px] text-muted-foreground mt-[3px]">{address}</Text> : null}
          {dateLabel ? <Text className="text-[13px] text-muted-foreground mt-0.5">{dateLabel}</Text> : null}
          {event.joined_count > 0 ? <Text className="text-[12px] text-muted-foreground mt-0.5">+{event.joined_count} joined</Text> : null}
          {showOrg && event.org_name ? (
            <View className="flex-row items-center gap-[9px] mt-[13px] pt-3 border-t border-divider">
              <OrgAvatar name={event.org_name} color={event.org_color} size={24} />
              <Text className="text-[13px] text-muted-foreground">{event.org_name}</Text>
            </View>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}
```

Now open `apps/mobile/app/event/[id].tsx` and update the import + the date line in the `meta` array. Change:

```ts
import { formatPeso } from "@race-pace/shared";
```
to:
```ts
import { formatPeso, formatDateRange } from "@race-pace/shared";
```

Change:
```ts
    event.event_date && `⚑ ${longDate(event.event_date)}`,
```
to:
```ts
    event.event_date && `⚑ ${formatDateRange(event.event_date, event.end_date, longDate)}`,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter mobile test -- __tests__/event-card.test.tsx __tests__/event-address.test.tsx`
Expected: `Test Suites: 2 passed, 2 total`, `Tests: 9 passed, 9 total` (3 existing + 4 new in `event-card.test.tsx`; 2 updated in `event-address.test.tsx`).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/EventCard.tsx apps/mobile/app/event/\[id\].tsx apps/mobile/__tests__/event-card.test.tsx apps/mobile/__tests__/event-address.test.tsx
git commit -m "feat(mobile): stack address/date-range/joined-count on EventCard"
```

---

## Task 5: Mobile dropdown scroll fix — bounded `ScrollView` in `SelectContent`

**Files:**
- Modify: `apps/mobile/components/ui/select.tsx`
- Test: `apps/mobile/__tests__/psgc-picker.test.tsx`

**Interfaces:**
- No new exports — internal rendering fix to the existing `SelectContent` component used by every `<Select>` in the app.

- [ ] **Step 1: Write the failing test**

Open `apps/mobile/__tests__/psgc-picker.test.tsx` and add this test at the end of the `describe("PsgcAddressPicker", ...)` block:

```tsx
  it("wraps a long city list in a bounded, scrollable container", async () => {
    mockCities = Array.from({ length: 40 }, (_, i) => ({ code: `c${i}`, name: `City ${i}` }));
    renderPicker();
    await openAndPick("Region", "Davao Region");
    await openAndPick("Province", "Davao del Sur");

    fireEvent.press(screen.getByLabelText("City"));
    expect(await screen.findByText("City 39")).toBeOnTheScreen();
    const scroller = screen.getByTestId("select-native-scroll");
    expect(scroller.props.style).toMatchObject({ maxHeight: expect.any(Number) });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter mobile test -- __tests__/psgc-picker.test.tsx`
Expected: FAIL — `Unable to find an element with testID: select-native-scroll`.

- [ ] **Step 3: Write minimal implementation**

Open `apps/mobile/components/ui/select.tsx`. Update the React Native import to add `ScrollView` and `useWindowDimensions`:

```ts
import { Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
```

In the `SelectContent` function, add the window-height read at the top of the function body (right after the destructured props):

```tsx
function SelectContent({
  className,
  children,
  position = 'popper',
  portalHost,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & {
    className?: string;
    portalHost?: string;
  }) {
  const { height: windowHeight } = useWindowDimensions();
  return (
```

Then replace the `SelectPrimitive.Viewport` block:

```tsx
                <SelectPrimitive.Viewport
                  className={cn(
                    'p-1',
                    position === 'popper' &&
                    cn(
                      'w-full',
                      Platform.select({
                        web: 'h-[var(--radix-select-trigger-height)] min-w-[var(--radix-select-trigger-width)]',
                      })
                    )
                  )}>
                  {children}
                </SelectPrimitive.Viewport>
```

with:

```tsx
                <SelectPrimitive.Viewport
                  className={cn(
                    'p-1',
                    position === 'popper' &&
                    cn(
                      'w-full',
                      Platform.select({
                        web: 'h-[var(--radix-select-trigger-height)] min-w-[var(--radix-select-trigger-width)]',
                      })
                    )
                  )}>
                  {Platform.OS === 'web' ? (
                    children
                  ) : (
                    // RNR's native Viewport is a no-op Fragment — real scrolling only
                    // exists on web. Without this, a long option list (e.g. PSGC
                    // cities) renders at full height with nothing to scroll.
                    <ScrollView testID="select-native-scroll" style={{ maxHeight: windowHeight * 0.5 }} showsVerticalScrollIndicator nestedScrollEnabled>
                      {children}
                    </ScrollView>
                  )}
                </SelectPrimitive.Viewport>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter mobile test -- __tests__/psgc-picker.test.tsx`
Expected: `Tests: 8 passed, 8 total` (7 existing + 1 new).

- [ ] **Step 5: Run the full mobile suite to confirm no other Select usage regressed**

Run: `pnpm --filter mobile test`
Expected: all suites pass (same total as before this task, plus the 1 new test).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/components/ui/select.tsx apps/mobile/__tests__/psgc-picker.test.tsx
git commit -m "fix(mobile): bound + scroll long native Select option lists"
```

---

## Task 6: Mobile — `useGlobalRefresh` hook

**Files:**
- Create: `apps/mobile/lib/useGlobalRefresh.ts`
- Test: `apps/mobile/__tests__/use-global-refresh.test.ts`

**Interfaces:**
- Produces: `useGlobalRefresh(): { refreshing: boolean; onRefresh: () => Promise<void> }`. Used by Task 7 (Events/Orgs/Races) and Task 8 (Profile).

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/use-global-refresh.test.ts`:

```ts
import { renderHook, act } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useGlobalRefresh } from "../lib/useGlobalRefresh";

it("refetches active queries and toggles refreshing back off", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const spy = jest.spyOn(client, "refetchQueries").mockResolvedValue(undefined as never);
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  const { result } = renderHook(() => useGlobalRefresh(), { wrapper });
  expect(result.current.refreshing).toBe(false);

  await act(async () => {
    await result.current.onRefresh();
  });

  expect(spy).toHaveBeenCalledWith({ type: "active" });
  expect(result.current.refreshing).toBe(false);
});

it("clears refreshing even when the refetch rejects (e.g. offline)", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  jest.spyOn(client, "refetchQueries").mockRejectedValue(new Error("network error"));
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  const { result } = renderHook(() => useGlobalRefresh(), { wrapper });

  await act(async () => {
    await expect(result.current.onRefresh()).rejects.toThrow("network error");
  });

  expect(result.current.refreshing).toBe(false); // finally still clears it — no stuck spinner
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter mobile test -- __tests__/use-global-refresh.test.ts`
Expected: FAIL — `Cannot find module '../lib/useGlobalRefresh'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/mobile/lib/useGlobalRefresh.ts`:

```ts
import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

/** One shared pull-to-refresh implementation for every data screen: refetches
 *  whatever queries are currently mounted, so new screens adopt it with no
 *  per-screen query-key wiring. */
export function useGlobalRefresh() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await qc.refetchQueries({ type: "active" });
    } finally {
      setRefreshing(false);
    }
  }, [qc]);
  return { refreshing, onRefresh };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter mobile test -- __tests__/use-global-refresh.test.ts`
Expected: `Tests: 2 passed, 2 total`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/useGlobalRefresh.ts apps/mobile/__tests__/use-global-refresh.test.ts
git commit -m "feat(mobile): add shared useGlobalRefresh pull-to-refresh hook"
```

---

## Task 7: Mobile — wire pull-to-refresh into Events, Orgs, My Races

**Files:**
- Modify: `apps/mobile/app/(tabs)/events.tsx`
- Modify: `apps/mobile/app/(tabs)/orgs.tsx`
- Modify: `apps/mobile/app/(tabs)/races.tsx`
- Test: `apps/mobile/__tests__/marketplace-search.test.tsx`
- Test: `apps/mobile/__tests__/orgs.test.tsx`
- Test: `apps/mobile/__tests__/my-races.test.tsx`

**Interfaces:**
- Consumes: `useGlobalRefresh` (Task 6).

- [ ] **Step 1: Add the mock these tests now need**

Each of the three screens will call `useGlobalRefresh()`, which needs a real `QueryClientProvider` ancestor — these tests don't provide one (they mock the data hook directly instead, per this codebase's established pattern). Add a mock to each file so rendering the screen doesn't throw.

In `apps/mobile/__tests__/marketplace-search.test.tsx`, add after the existing `jest.mock("../lib/events", ...)` block:

```tsx
jest.mock("../lib/useGlobalRefresh", () => ({ useGlobalRefresh: () => ({ refreshing: false, onRefresh: jest.fn() }) }));
```

In `apps/mobile/__tests__/orgs.test.tsx`, add the same line after its `jest.mock("../lib/events", ...)` block:

```tsx
jest.mock("../lib/useGlobalRefresh", () => ({ useGlobalRefresh: () => ({ refreshing: false, onRefresh: jest.fn() }) }));
```

In `apps/mobile/__tests__/my-races.test.tsx`, add the same line after its `jest.mock("../lib/registration", ...)` block:

```tsx
jest.mock("../lib/useGlobalRefresh", () => ({ useGlobalRefresh: () => ({ refreshing: false, onRefresh: jest.fn() }) }));
```

- [ ] **Step 2: Run tests to verify they still pass (mock added, screens unchanged so far)**

Run: `pnpm --filter mobile test -- __tests__/marketplace-search.test.tsx __tests__/orgs.test.tsx __tests__/my-races.test.tsx`
Expected: all pass (the new mocks are inert until the screens actually import the hook).

- [ ] **Step 3: Wire `RefreshControl` into each screen**

In `apps/mobile/app/(tabs)/events.tsx`, change the import line:
```tsx
import { View, TextInput, FlatList, ActivityIndicator, Pressable } from "react-native";
```
to:
```tsx
import { View, TextInput, FlatList, ActivityIndicator, Pressable, RefreshControl } from "react-native";
```
Add the import and hook call (after the existing `useMarketplaceEvents` line):
```tsx
import { useGlobalRefresh } from "../../lib/useGlobalRefresh";
```
```tsx
export default function Marketplace() {
  const { data, isLoading, isError, refetch } = useMarketplaceEvents();
  const { refreshing, onRefresh } = useGlobalRefresh();
  const router = useRouter();
```
Add `refreshControl` to the `FlatList` (alongside `showsVerticalScrollIndicator`):
```tsx
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
```

In `apps/mobile/app/(tabs)/orgs.tsx`, change:
```tsx
import { View, TextInput, FlatList, Pressable, ActivityIndicator } from "react-native";
```
to:
```tsx
import { View, TextInput, FlatList, Pressable, ActivityIndicator, RefreshControl } from "react-native";
```
Add the import and hook call:
```tsx
import { useGlobalRefresh } from "../../lib/useGlobalRefresh";
```
```tsx
export default function Orgs() {
  const { data, isLoading, isError, refetch } = useOrgs();
  const { refreshing, onRefresh } = useGlobalRefresh();
  const router = useRouter();
```
Add `refreshControl` to the `FlatList`:
```tsx
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
```

In `apps/mobile/app/(tabs)/races.tsx`, change:
```tsx
import { View, FlatList, Pressable, ActivityIndicator } from "react-native";
```
to:
```tsx
import { View, FlatList, Pressable, ActivityIndicator, RefreshControl } from "react-native";
```
Add the import and hook call:
```tsx
import { useGlobalRefresh } from "../../lib/useGlobalRefresh";
```
```tsx
export default function MyRaces() {
  const { data, isLoading, isError, refetch } = useMyRegistrations();
  const { refreshing, onRefresh } = useGlobalRefresh();
  const router = useRouter();
```
Add `refreshControl` to the `FlatList`:
```tsx
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
```

- [ ] **Step 4: Run tests to verify they still pass**

Run: `pnpm --filter mobile test -- __tests__/marketplace-search.test.tsx __tests__/orgs.test.tsx __tests__/my-races.test.tsx`
Expected: all pass, same counts as Step 2.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/\(tabs\)/events.tsx apps/mobile/app/\(tabs\)/orgs.tsx apps/mobile/app/\(tabs\)/races.tsx apps/mobile/__tests__/marketplace-search.test.tsx apps/mobile/__tests__/orgs.test.tsx apps/mobile/__tests__/my-races.test.tsx
git commit -m "feat(mobile): pull-to-refresh on Events, Orgs, My Races"
```

---

## Task 8: Mobile Profile — dropdown position, text weight, react-query-backed refresh

**Files:**
- Modify: `apps/mobile/lib/profile.ts`
- Modify: `apps/mobile/app/(tabs)/profile.tsx`
- Test: `apps/mobile/__tests__/profile.test.tsx`

**Interfaces:**
- Consumes: `useGlobalRefresh` (Task 6).
- Produces: `useProfile(userId?: string)` in `lib/profile.ts` — a `useQuery`-backed wrapper around `getProfile`.

- [ ] **Step 1: Update the test's mocks for the upcoming refactor**

Open `apps/mobile/__tests__/profile.test.tsx`. Replace the `jest.mock("../lib/profile", ...)` block:

```tsx
jest.mock("../lib/profile", () => ({
  getProfile: jest.fn().mockResolvedValue({ id: "u1", full_name: "JR Dela Cruz", bib_name: "JR", date_of_birth: "1990-05-15", gender: "Male", blood_type: "O+", shirt_size: "M", emergency_contact: "Jane 0917", city_name: "Digos City", province_name: "Davao del Sur", city_psgc_code: "c1" }),
  upsertProfile: (...a: unknown[]) => mockUpsert(...a),
}));
```

with:

```tsx
jest.mock("../lib/profile", () => ({
  useProfile: () => ({
    data: { id: "u1", full_name: "JR Dela Cruz", bib_name: "JR", date_of_birth: "1990-05-15", gender: "Male", blood_type: "O+", shirt_size: "M", emergency_contact: "Jane 0917", city_name: "Digos City", province_name: "Davao del Sur", city_psgc_code: "c1" },
    isLoading: false,
  }),
  upsertProfile: (...a: unknown[]) => mockUpsert(...a),
}));
jest.mock("../lib/useGlobalRefresh", () => ({ useGlobalRefresh: () => ({ refreshing: false, onRefresh: jest.fn() }) }));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter mobile test -- __tests__/profile.test.tsx`
Expected: FAIL — `profile.tsx` still calls `getProfile` directly, which is no longer exported by the mock, so the effect throws / the screen never populates (`screen.getByText("picked:Digos City")` times out).

- [ ] **Step 3: Add `useProfile` to `lib/profile.ts`**

Open `apps/mobile/lib/profile.ts`. Add the import at the top:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
```

Add this export at the end of the file:

```ts
export function useProfile(userId?: string) {
  return useQuery({
    queryKey: ["profile", userId],
    queryFn: () => getProfile(userId!),
    enabled: !!userId,
  });
}
```

- [ ] **Step 4: Refactor `profile.tsx` to use `useProfile` + wire in pull-to-refresh**

Open `apps/mobile/app/(tabs)/profile.tsx`. Update the imports: change

```tsx
import { useState } from "react";
import { View, ScrollView, Pressable, Alert, Image, ActivityIndicator, TextInput, Modal, ActionSheetIOS, Platform } from "react-native";
```

to

```tsx
import { useEffect, useRef, useState } from "react";
import { View, ScrollView, Pressable, Alert, Image, ActivityIndicator, TextInput, Modal, ActionSheetIOS, Platform, RefreshControl } from "react-native";
```

Change:
```tsx
import { getProfile, upsertProfile } from "../../lib/profile";
```
to:
```tsx
import { useProfile, upsertProfile } from "../../lib/profile";
```

Add this import alongside the others:
```tsx
import { useGlobalRefresh } from "../../lib/useGlobalRefresh";
```

Inside the `Profile()` component, replace:

```tsx
  const uid = session?.user.id;
  const myRaces = useMyRegistrations();
```

with:

```tsx
  const uid = session?.user.id;
  const profileQuery = useProfile(uid);
  const { refreshing, onRefresh } = useGlobalRefresh();
  const myRaces = useMyRegistrations();
```

Replace the fetch effect:

```tsx
  useEffect(() => {
    if (!uid) return;
    getProfile(uid).then((p) => {
      if (!p) { setSaved(snapshot({})); return; }
      const [en, ep] = splitEmergency(p.emergency_contact);
      setFullName(p.full_name ?? ""); setBibName(p.bib_name ?? "");
      setAddress(p.city_psgc_code ? { city_psgc_code: p.city_psgc_code, city_name: p.city_name ?? null, province_name: p.province_name ?? null, region_name: null } : null);
      setDob(p.date_of_birth ?? ""); setGender(p.gender ?? ""); setShirtSize(p.shirt_size ?? "");
      setBloodType(p.blood_type ?? ""); setEmgName(en); setEmgPhone(ep);
      setAvatarUrl(p.avatar_url ?? null); setCoverUrl(p.cover_url ?? null);
      setSaved(snapshot({ fullName: p.full_name, bibName: p.bib_name, dob: p.date_of_birth, gender: p.gender, shirtSize: p.shirt_size, bloodType: p.blood_type, emgName: en, emgPhone: ep, city: p.city_psgc_code }));
    });
  }, [uid]);
```

with:

```tsx
  // Seed local editable state from the fetched profile once per uid — not on
  // every subsequent pull-to-refresh refetch, which would otherwise clobber
  // in-progress unsaved edits.
  const seededFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!uid || profileQuery.isLoading || seededFor.current === uid) return;
    seededFor.current = uid;
    const p = profileQuery.data;
    if (!p) { setSaved(snapshot({})); return; }
    const [en, ep] = splitEmergency(p.emergency_contact);
    setFullName(p.full_name ?? ""); setBibName(p.bib_name ?? "");
    setAddress(p.city_psgc_code ? { city_psgc_code: p.city_psgc_code, city_name: p.city_name ?? null, province_name: p.province_name ?? null, region_name: null } : null);
    setDob(p.date_of_birth ?? ""); setGender(p.gender ?? ""); setShirtSize(p.shirt_size ?? "");
    setBloodType(p.blood_type ?? ""); setEmgName(en); setEmgPhone(ep);
    setAvatarUrl(p.avatar_url ?? null); setCoverUrl(p.cover_url ?? null);
    setSaved(snapshot({ fullName: p.full_name, bibName: p.bib_name, dob: p.date_of_birth, gender: p.gender, shirtSize: p.shirt_size, bloodType: p.blood_type, emgName: en, emgPhone: ep, city: p.city_psgc_code }));
  }, [uid, profileQuery.data, profileQuery.isLoading]);
```

Add `refreshControl` to the `ScrollView` (alongside its existing `onScroll`):

```tsx
        onScroll={(e) => setOverCover(e.nativeEvent.contentOffset.y < 150)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
```

- [ ] **Step 5: Apply the dropdown-position and text-weight fixes**

In the same file, change the `RVALUE` constant:

```ts
const RVALUE = "text-[15px] font-semibold text-foreground";
```

to:

```ts
const RVALUE = "text-[15px] text-foreground";
```

In the `SelectRow` function, change:

```tsx
        <SelectContent>
          {options.map((o) => <SelectItem key={o} value={o} label={o} />)}
        </SelectContent>
```

to:

```tsx
        <SelectContent align="end">
          {options.map((o) => <SelectItem key={o} value={o} label={o} />)}
        </SelectContent>
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter mobile test -- __tests__/profile.test.tsx`
Expected: `Tests: 2 passed, 2 total`.

- [ ] **Step 7: Run the full mobile suite**

Run: `pnpm --filter mobile test`
Expected: all suites pass.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/lib/profile.ts apps/mobile/app/\(tabs\)/profile.tsx apps/mobile/__tests__/profile.test.tsx
git commit -m "fix(mobile): profile dropdown position/weight + query-backed refresh"
```

---

## Task 9: Mobile — home-screen icon from `topnav-logo.png`

**Files:**
- Create (temporary, removed at the end of this task): `scripts/generate-app-icon.mjs`
- Modify: `apps/mobile/assets/icon.png`
- Modify: `apps/mobile/assets/android-icon-foreground.png`
- Modify: `apps/mobile/assets/android-icon-background.png`
- Modify: `apps/mobile/assets/android-icon-monochrome.png`
- Modify: `apps/mobile/app.json`

**Interfaces:** none (build assets only, no code).

- [ ] **Step 1: Add `sharp` as a temporary root devDependency**

Run: `pnpm add -D -w sharp`
Expected: adds `sharp` to the root `package.json`'s `devDependencies` and installs successfully.

- [ ] **Step 2: Write the generation script**

Create `scripts/generate-app-icon.mjs`:

```js
// One-time generator for the Race Pace app icon, from the transparent
// assets/topnav-logo.png mark. Run once, then delete (see Task 9 Step 4).
import sharp from "sharp";

const SRC = "apps/mobile/assets/topnav-logo.png";
const OUT = "apps/mobile/assets";

// Trim the mark's own transparent margin down to its real bounding box —
// the source canvas has asymmetric empty space that would otherwise leave
// the mark off-center once resized into a square icon.
const trimmedRgba = await sharp(SRC).trim().png().toBuffer();

// 1) Main icon.png — opaque white square, mark centered with even padding.
await sharp(trimmedRgba)
  .flatten({ background: "#ffffff" })
  .resize(760, 760, { fit: "contain", background: "#ffffff" })
  .extend({ top: 132, bottom: 132, left: 132, right: 132, background: "#ffffff" })
  .png()
  .toFile(`${OUT}/icon.png`);

// 2) Android adaptive foreground — transparent, mark scaled to the ~66% safe zone.
await sharp(trimmedRgba)
  .resize(676, 676, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .extend({ top: 174, bottom: 174, left: 174, right: 174, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(`${OUT}/android-icon-foreground.png`);

// 3) Android adaptive background — flat white, same canvas size.
await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#ffffff" } })
  .png()
  .toFile(`${OUT}/android-icon-background.png`);

// 4) Android monochrome — solid-white silhouette using the mark's own alpha as a mask
//    (Android tints this layer with the user's chosen theme color at runtime).
const safeZone = await sharp(trimmedRgba)
  .resize(676, 676, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .extend({ top: 174, bottom: 174, left: 174, right: 174, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .ensureAlpha()
  .toBuffer();
const alphaMask = await sharp(safeZone).extractChannel(3).toBuffer();
await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#ffffff" } })
  .joinChannel(alphaMask)
  .png()
  .toFile(`${OUT}/android-icon-monochrome.png`);

for (const f of ["icon.png", "android-icon-foreground.png", "android-icon-background.png", "android-icon-monochrome.png"]) {
  const m = await sharp(`${OUT}/${f}`).metadata();
  console.log(f, JSON.stringify({ width: m.width, height: m.height, hasAlpha: m.hasAlpha }));
}
```

- [ ] **Step 3: Run it and verify the output**

Run: `node scripts/generate-app-icon.mjs`
Expected output (order may vary):
```
icon.png {"width":1024,"height":1024,"hasAlpha":false}
android-icon-foreground.png {"width":1024,"height":1024,"hasAlpha":true}
android-icon-background.png {"width":1024,"height":1024,"hasAlpha":false}
android-icon-monochrome.png {"width":1024,"height":1024,"hasAlpha":true}
```

Visually confirm `icon.png` looks right (green runner mark, centered, opaque white background) by opening it in an image viewer or editor.

- [ ] **Step 4: Remove the temporary script and dependency**

Run:
```bash
rm scripts/generate-app-icon.mjs
pnpm remove -D -w sharp
```
Expected: `package.json`'s `devDependencies` no longer lists `sharp`; the script file is gone. The four regenerated PNGs under `apps/mobile/assets/` remain.

- [ ] **Step 5: Update `app.json`'s adaptive icon background color**

Open `apps/mobile/app.json`. Change:

```json
      "adaptiveIcon": {
        "backgroundColor": "#E6F4FE",
```

to:

```json
      "adaptiveIcon": {
        "backgroundColor": "#FFFFFF",
```

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/assets/icon.png apps/mobile/assets/android-icon-foreground.png apps/mobile/assets/android-icon-background.png apps/mobile/assets/android-icon-monochrome.png apps/mobile/app.json package.json pnpm-lock.yaml
git commit -m "feat(mobile): brand the home-screen icon from topnav-logo.png"
```

---

## Task 10: Admin — `end_date` schema + validation + editor input

**Files:**
- Modify: `apps/web/src/lib/events.ts`
- Modify: `apps/web/src/lib/eventWrites.ts`
- Modify: `apps/web/src/lib/validation.ts`
- Modify: `apps/web/src/routes/EventEditor.tsx`
- Test: `apps/web/src/__tests__/event-editor.test.tsx`

**Interfaces:**
- Consumes: `end_date` column (Task 2).
- Produces: `EditorEvent.end_date`, `EventDraft.end_date: string | null`. Used by Task 11.

- [ ] **Step 1: Write the failing test**

Open `apps/web/src/__tests__/event-editor.test.tsx`. Add `end_date: null,` to the two existing `event: {...}` fixtures that currently omit it — in `"allows saving a cancelled event instead of dead-ending on the status validator"`:

```tsx
      event: {
        id: "e1", org_id: "a1", name: "Apo Sky Ultra",
        city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null,
        event_date: null, end_date: null, flag_off: null, status: "cancelled",
        elevation_gain_m: null, cutoff_hours: null, description: null, hero_image_url: null, gallery: [],
      },
```

and in `"carries hero_image_url + gallery through to save"`:

```tsx
      event: {
        id: "e1", org_id: "a1", name: "Apo",
        city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null,
        event_date: null, end_date: null, flag_off: null, status: "open",
        elevation_gain_m: null, cutoff_hours: null, description: null,
        hero_image_url: "https://cdn/hero.png", gallery: ["https://cdn/g1.png"],
      },
```

Update `"carries PSGC address + venue + date/time through to save"` to set a real range and assert it saves + renders an END DATE input:

```tsx
it("carries PSGC address + venue + date range through to save", async () => {
  mockUseParams.mockReturnValue({ id: "e1" });
  mockUseEventForEditor.mockReturnValue({
    data: {
      event: {
        id: "e1", org_id: "a1", name: "Apo",
        city_psgc_code: "112603", region_name: "Davao Region", province_name: "Davao del Sur", city_name: "City of Digos", venue: "Camp Sabros",
        event_date: "2026-11-14", end_date: "2026-11-16", flag_off: "04:00", status: "open",
        elevation_gain_m: null, cutoff_hours: null, description: null, hero_image_url: null, gallery: [],
      },
      categories: [],
      addons: [],
    },
    isLoading: false,
  });
  render(<MemoryRouter><EventEditor /></MemoryRouter>);
  expect(await screen.findByLabelText("Region")).toBeInTheDocument();
  expect(screen.getByLabelText("Venue")).toBeInTheDocument();
  expect((screen.getByLabelText("Date") as HTMLInputElement).type).toBe("date");
  expect((screen.getByLabelText("End date") as HTMLInputElement).type).toBe("date");
  expect((screen.getByLabelText("End date") as HTMLInputElement).value).toBe("2026-11-16");
  expect((screen.getByLabelText("Flag-off") as HTMLInputElement).type).toBe("time");
  expect(screen.queryByLabelText("Place")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Save event"));
  await waitFor(() => expect(mockSave).toHaveBeenCalled());
  expect(mockSave.mock.calls[0]![0].event).toMatchObject({
    city_psgc_code: "112603", region_name: "Davao Region", province_name: "Davao del Sur", city_name: "City of Digos",
    venue: "Camp Sabros", event_date: "2026-11-14", end_date: "2026-11-16", flag_off: "04:00",
  });
});

it("blocks save when the end date is before the start date", async () => {
  mockUseParams.mockReturnValue({ id: "e1" });
  mockUseEventForEditor.mockReturnValue({
    data: {
      event: {
        id: "e1", org_id: "a1", name: "Apo",
        city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null,
        event_date: "2026-11-14", end_date: null, flag_off: null, status: "open",
        elevation_gain_m: null, cutoff_hours: null, description: null, hero_image_url: null, gallery: [],
      },
      categories: [],
      addons: [],
    },
    isLoading: false,
  });
  render(<MemoryRouter><EventEditor /></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText("End date"), { target: { value: "2026-11-10" } });
  fireEvent.click(screen.getByText("Save event"));
  expect(await screen.findByText("End date can't be before the start date.")).toBeInTheDocument();
  expect(mockSave).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test -- src/__tests__/event-editor.test.tsx`
Expected: FAIL — no "End date" label exists yet; the renamed test's `event` object also doesn't type-check against `EditorEvent` until Step 3 adds the field.

- [ ] **Step 3: Update the shared types + validation**

In `apps/web/src/lib/events.ts`, add `end_date` to `AdminEventRow` (after `event_date`):

```ts
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
```

Add `end_date` to the `useOrgEvents` select string:

```ts
        .select("id,name,place,city_name,province_name,event_date,end_date,status,original_date,categories(slots_taken,slots_total)")
```

Add `end_date` to `EditorEvent` (after `event_date`):

```ts
export type EditorEvent = {
  id: string; org_id: string; name: string;
  city_psgc_code: string | null; region_name: string | null; province_name: string | null; city_name: string | null; venue: string | null;
  event_date: string | null; end_date: string | null; flag_off: string | null; status: string;
  elevation_gain_m: number | null; cutoff_hours: number | null; description: string | null;
  hero_image_url: string | null; gallery: string[];
};
```

Add `end_date` to the `useEventForEditor` select string:

```ts
        .select("id,org_id,name,city_psgc_code,region_name,province_name,city_name,venue,event_date,end_date,flag_off,status,elevation_gain_m,cutoff_hours,description,hero_image_url,gallery")
```

In `apps/web/src/lib/eventWrites.ts`, add `end_date` to `EventDraft` (after `event_date`):

```ts
export type EventDraft = {
  id?: string; org_id: string; name: string;
  city_psgc_code: string | null; region_name: string | null; province_name: string | null; city_name: string | null; venue: string | null;
  event_date: string | null; end_date: string | null; flag_off: string | null; status: string;
  elevation_gain_m: number | null; cutoff_hours: number | null; description: string | null;
  hero_image_url: string | null; gallery: string[];
};
```

Add `end_date: e.end_date,` to `EVENT_COLS` (after `event_date: e.event_date,`):

```ts
const EVENT_COLS = (e: EventDraft) => ({
  org_id: e.org_id, name: e.name,
  city_psgc_code: e.city_psgc_code, region_name: e.region_name, province_name: e.province_name, city_name: e.city_name, venue: e.venue,
  event_date: e.event_date, end_date: e.end_date, flag_off: e.flag_off, status: e.status,
  elevation_gain_m: e.elevation_gain_m, cutoff_hours: e.cutoff_hours,
  description: e.description, hero_image_url: e.hero_image_url, gallery: e.gallery,
});
```

In `apps/web/src/lib/validation.ts`, add `end_date: dateStr,` to `eventInputSchema` (after `event_date: dateStr,`):

```ts
export const eventInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  city_psgc_code: z.string().nullable(),
  region_name: z.string().nullable(),
  province_name: z.string().nullable(),
  city_name: z.string().nullable(),
  venue: z.string().nullable(),
  event_date: dateStr,
  end_date: dateStr,
  flag_off: timeStr,
  status: z.enum(EVENT_STATUSES),
  elevation_gain_m: intNonNeg.nullable(),
  cutoff_hours: intNonNeg.nullable(),
  description: z.string().nullable(),
  hero_image_url: z.string().nullable(),
  gallery: z.array(z.string()).default([]),
});
```

Note: `end_date` is **not** wrapped in a Zod `.refine()` — `EventEditor.tsx` calls `eventInputSchema.omit({ status: true })`, and `.refine()` would return a `ZodEffects` that no longer has `.omit()`. The start/end ordering check is added as a plain conditional in the editor's existing hand-rolled `invalid` check instead (Step 4).

- [ ] **Step 4: Update `EventEditor.tsx`**

Open `apps/web/src/routes/EventEditor.tsx`. Add `end_date: null,` to the `blank` draft:

```ts
const blank: EventDraft = { org_id: "", name: "", city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null, event_date: null, end_date: null, flag_off: null, status: "draft", elevation_gain_m: null, cutoff_hours: null, description: null, hero_image_url: null, gallery: [] };
```

Update the `invalid` check to add the date-order rule right after the existing schema check:

```ts
  const invalid = useMemo(() => {
    // Status isn't validated here: "cancelled" (set only via the Cancel modal) is
    // intentionally outside EVENT_STATUSES, and the dropdown already restricts input
    // to valid values — validating it here would permanently block Save on a
    // cancelled event with a misleading "fix the event fields" message.
    if (!eventInputSchema.omit({ status: true }).safeParse({ ...event }).success) return "Fix the event fields (name is required, valid date/time).";
    if (event.end_date && event.event_date && event.end_date < event.event_date) return "End date can't be before the start date.";
    for (const c of cats) if (!categoryInputSchema.safeParse(c).success) return "Fix the category rows (code, label, non-negative price/slots).";
    for (const a of addons) if (!addonInputSchema.safeParse(a).success) return "Fix the add-on rows (name, non-negative price).";
    return null;
  }, [event, cats, addons]);
```

Change the date/flag-off/status grid from 3 columns to 4, adding an END DATE field:

```tsx
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
              <div><span style={label}>DATE</span><input aria-label="Date" type="date" style={input} value={event.event_date ?? ""} onChange={(e) => set({ event_date: e.target.value || null })} /></div>
              <div><span style={label}>END DATE</span><input aria-label="End date" type="date" style={input} value={event.end_date ?? ""} onChange={(e) => set({ end_date: e.target.value || null })} /></div>
              <div><span style={label}>FLAG-OFF</span><input aria-label="Flag-off" type="time" style={input} value={event.flag_off ?? ""} onChange={(e) => set({ flag_off: e.target.value || null })} /></div>
              <div><span style={label}>STATUS</span>
                <select aria-label="Status" style={input} value={event.status} onChange={(e) => set({ status: e.target.value })}>
                  {EVENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter web test -- src/__tests__/event-editor.test.tsx`
Expected: `Tests: 6 passed, 6 total` (the 5 existing tests — two of which you just edited — plus the 1 new "blocks save when the end date is before the start date" test).

- [ ] **Step 6: Run the web typecheck**

Run: `pnpm --filter web typecheck`
Expected: no errors (confirms every `EditorEvent`/`EventDraft`/`AdminEventRow` literal across the codebase now includes `end_date`).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/events.ts apps/web/src/lib/eventWrites.ts apps/web/src/lib/validation.ts apps/web/src/routes/EventEditor.tsx apps/web/src/__tests__/event-editor.test.tsx
git commit -m "feat(web): end_date schema, validation, and editor input"
```

---

## Task 11: Admin — Events list range display + reschedule delta-shift

**Files:**
- Modify: `apps/web/src/routes/Events.tsx`
- Modify: `apps/web/src/components/RescheduleModal.tsx`
- Modify: `apps/web/src/lib/eventWrites.ts`
- Test: `apps/web/src/__tests__/event-writes.test.ts`

**Interfaces:**
- Consumes: `AdminEventRow.end_date`, `EventDraft.end_date` (Task 10).

- [ ] **Step 1: Write the failing test**

Open `apps/web/src/__tests__/event-writes.test.ts` and add, after the existing `reconcileChildren` test:

```ts
import { rescheduleEvent } from "../lib/eventWrites";

const updateMock = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
vi.mock("../lib/supabase", () => ({ supabase: { from: () => ({ update: (patch: unknown) => updateMock(patch) }) } }));

describe("rescheduleEvent", () => {
  beforeEach(() => updateMock.mockClear());

  it("shifts end_date by the same delta as the new start date for a multi-day event", async () => {
    await rescheduleEvent("e1", "2026-09-01", "2026-09-03", "2026-10-05", "moved");
    expect(updateMock).toHaveBeenCalledWith({
      original_date: "2026-09-01", event_date: "2026-10-05", end_date: "2026-10-07", status_note: "moved",
    });
  });

  it("leaves end_date null for a single-day event", async () => {
    await rescheduleEvent("e1", "2026-09-01", null, "2026-10-05", "");
    expect(updateMock).toHaveBeenCalledWith({
      original_date: "2026-09-01", event_date: "2026-10-05", end_date: null, status_note: null,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- src/__tests__/event-writes.test.ts`
Expected: FAIL — `rescheduleEvent` still takes 4 args (`id, currentDate, newDate, note`), so `event_date`/`end_date` won't match; TypeScript will also flag the extra `currentEndDate` argument once you try to compile.

- [ ] **Step 3: Write minimal implementation**

Open `apps/web/src/lib/eventWrites.ts`. Replace `rescheduleEvent`:

```ts
export async function rescheduleEvent(id: string, currentDate: string | null, newDate: string, note: string): Promise<{ error?: string }> {
  const r = await supabase.from("events").update({ original_date: currentDate, event_date: newDate, status_note: note || null }).eq("id", id);
  return r.error ? { error: r.error.message } : {};
}
```

with:

```ts
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000);
}
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function rescheduleEvent(id: string, currentDate: string | null, currentEndDate: string | null, newDate: string, note: string): Promise<{ error?: string }> {
  const newEndDate = currentEndDate && currentDate ? addDays(newDate, daysBetween(currentDate, currentEndDate)) : null;
  const r = await supabase.from("events").update({ original_date: currentDate, event_date: newDate, end_date: newEndDate, status_note: note || null }).eq("id", id);
  return r.error ? { error: r.error.message } : {};
}
```

- [ ] **Step 4: Update the caller**

Open `apps/web/src/components/RescheduleModal.tsx`. Change the prop type and the call:

```tsx
export function RescheduleModal({ event, onClose, onDone }: { event: { id: string; event_date: string | null }; onClose: () => void; onDone: () => void }) {
```

to:

```tsx
export function RescheduleModal({ event, onClose, onDone }: { event: { id: string; event_date: string | null; end_date: string | null }; onClose: () => void; onDone: () => void }) {
```

and:

```tsx
    const { error } = await rescheduleEvent(event.id, event.event_date, date, note);
```

to:

```tsx
    const { error } = await rescheduleEvent(event.id, event.event_date, event.end_date, date, note);
```

- [ ] **Step 5: Add a failing test for the range display**

Open `apps/web/src/__tests__/events.test.tsx` and add this test at the end of the file:

```tsx
it("shows a date range when end_date is set, and a single date otherwise", () => {
  mockQuery = { isLoading: false, isError: false, refetch: () => {}, data: [
    { id: "e1", name: "Apo Sky Ultra", event_date: "2026-11-14", end_date: "2026-11-16", status: "open", original_date: null, categories: [] },
    { id: "e2", name: "Single Day Race", event_date: "2026-10-01", end_date: null, status: "open", original_date: null, categories: [] },
  ] };
  render(<Events />);
  expect(screen.getByText("Nov 14, 2026 – Nov 16, 2026")).toBeInTheDocument();
  expect(screen.getByText("Oct 1, 2026")).toBeInTheDocument();
});
```

Run: `pnpm --filter web test -- src/__tests__/events.test.tsx`
Expected: FAIL — the Date column still renders `fmtDate(e.event_date)` alone, so there's no "Nov 14, 2026 – Nov 16, 2026" text.

- [ ] **Step 6: Show the date range in the Events list**

Open `apps/web/src/routes/Events.tsx`. Add the import:

```ts
import { formatAddress, formatDateRange } from "@race-pace/shared";
```

Change the date cell:

```tsx
              <div style={{ fontSize: 13 }}>
                {fmtDate(e.event_date)}
                {e.original_date ? <span style={{ color: "var(--info)", fontSize: 12 }}> · was {fmtDate(e.original_date)}</span> : null}
              </div>
```

to:

```tsx
              <div style={{ fontSize: 13 }}>
                {e.event_date ? formatDateRange(e.event_date, e.end_date, fmtDate) : "—"}
                {e.original_date ? <span style={{ color: "var(--info)", fontSize: 12 }}> · was {fmtDate(e.original_date)}</span> : null}
              </div>
```

The explicit `e.event_date ? ... : "—"` preserves today's `fmtDate(null) → "—"` empty-state exactly — `formatDateRange` itself returns `""` (not `"—"`) when its `startIso` argument is falsy, since it has no opinion on an app's empty-state copy.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter web test -- src/__tests__/event-writes.test.ts src/__tests__/events.test.tsx src/__tests__/events-address.test.tsx`
Expected: `Test Files  3 passed (3)`, all tests passing (2 new in `event-writes.test.ts`; 1 new in `events.test.tsx`; `events-address.test.tsx` unaffected since its fixtures have no `end_date`, so `formatDateRange` collapses to the single date exactly as `fmtDate` did before).

- [ ] **Step 8: Run the full web suite + typecheck**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: all green, no type errors.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/routes/Events.tsx apps/web/src/components/RescheduleModal.tsx apps/web/src/lib/eventWrites.ts apps/web/src/__tests__/event-writes.test.ts
git commit -m "feat(web): show date range in Events list, preserve span on reschedule"
```

---

## Task 12: Docs — register this plan in the roadmap

**Files:**
- Modify: `docs/README.md`

**Interfaces:** none.

- [ ] **Step 1: Add the roadmap entry**

Open `docs/README.md`. Under the `**Admin web console (M3)**` section, find this line (the last item before the unchecked `Plan 14`):

```markdown
- [x] **Plan 13 · Registrations & payments** — [spec](./specs/2026-07-22-registrations-payments-design.md) · [plan](./plans/13-registrations-payments.md) — org-scoped admin read RLS (registrations/addons/payments/profiles) + `decrement_slot`; event-scoped roster + detail; read-only payments ledger; full slot-freeing refunds via the `admin-refund` Edge Function (backend+shared 41/41, web 49/49 green)
```

Add a new unnumbered bullet directly after it (before the `Plan 14` line), matching the style of the existing unnumbered `Mobile UI → React Native Reusables migration` entry earlier in the file:

```markdown
- [x] **Event cards UX polish** — [spec](./specs/2026-07-22-event-cards-ux-polish-design.md) · [plan](./plans/event-cards-ux-polish.md) — mobile event cards show address/date-range/paid-joined-count; admin + mobile support optional multi-day `end_date`; native Select dropdowns fixed (bounded scroll + right-edge positioning); profile field values de-bolded; global pull-to-refresh (`useGlobalRefresh`) on all four data screens; home-screen icon rebranded from `topnav-logo.png`. (Featured image + event-page carousel were already shipped in Plan 11.)
```

- [ ] **Step 2: Commit**

```bash
git add docs/README.md
git commit -m "docs: register event cards UX polish plan in the roadmap"
```

---

## Final verification (run once, after all tasks)

- [ ] Run the full suite across every package:

```bash
pnpm vitest run packages/shared/src/index.test.ts
pnpm --filter web test
pnpm --filter web typecheck
pnpm --filter mobile test
pnpm -r typecheck
```

Expected: every command exits 0.

- [ ] Manual iOS Simulator pass (not automatable in Jest/Vitest):
  - Profile → Gender/Shirt size/Blood type dropdowns open **without** being cut off at the right edge.
  - Profile → City picker (PsgcAddressPicker) with a populous province scrolls to reveal every city.
  - Pull down on Events, My Races, Organizations, and Profile — each shows the native refresh spinner and reloads.
  - Home screen shows the new Race Pace runner-mark icon (rebuild the dev client first — icon changes require a native rebuild, not just a JS reload).
