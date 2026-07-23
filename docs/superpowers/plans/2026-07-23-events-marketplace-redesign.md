# Events Marketplace Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the mobile Events Marketplace screen (`apps/mobile/app/(tabs)/events.tsx`) with a featured carousel, immersive-overlay event cards, and a combinable region/date/distance/organizer filter system.

**Architecture:** All filtering (region, date segment, distance bucket, organizer, upcoming/past) runs as pure client-side functions in a new `lib/marketplaceFilters.ts` module, applied over the already-fetched event list the same way today's text search already works. New presentational components (`FeaturedCarousel`, `MarketplaceFilterBar`, `MarketplaceFilterSheet`, `RegionFilterPicker`, `OrganizerFilterPicker`, `PillMultiSelect`) are built from existing RNR primitives (`ToggleGroup`, `Dialog`, `Select`, `Checkbox`, `Input`, `Avatar`) already in `components/ui/`. `EventCard` is redesigned in place to the immersive-overlay style and reused unchanged inside the carousel.

**Tech Stack:** React Native + Expo Router, NativeWind (Tailwind), React Native Reusables (`@rn-primitives/*`), `react-native-svg` (for the card gradient — already a dependency, no new package), `@tanstack/react-query`, Supabase, Jest + `@testing-library/react-native`.

## Global Constraints

- No new npm dependencies. Build every new UI piece from `components/ui/*` primitives already installed (`ToggleGroup`, `Dialog`, `Select`, `Checkbox`, `Input`, `Avatar`, `Badge`, `Button`). The card's gradient overlay uses `react-native-svg` (already a dependency, same technique as the existing `ElevationHero` component).
- Preserve existing `EventCard` behavior exactly: `testID="event-card-image"` / the `ElevationHero` fallback on missing/failed image, the cancelled-event `"was …"` date prefix, the `+N joined` line, and the existing address/date-range lines as **separate** `<Text>` nodes (the current `event-card.test.tsx` asserts on this — do not merge them into one line).
- Distance buckets (half-open ranges, upper-inclusive): 5K `0–7km`, 10K `7–15km`, 21K `15–25km`, 42K `25–45km`, 50K+ `45–75km`, Ultra `75km+`.
- "Upcoming" = `status` not `cancelled`/`completed`, AND (`event_date` is null OR `event_date >= today`).
- Every function in `lib/marketplaceFilters.ts` takes `todayIso: string` as an explicit parameter — never compute "today" internally. This keeps the module fully deterministic and unit-testable without mocking `Date`.
- Use the existing trail-green design tokens (`bg-primary`, `text-primary`, `border-primary`, etc.) rather than hardcoded hex, except where `react-native-svg` requires literal color strings (matching `ElevationHero`'s existing precedent).
- Note on the approved design: the very first marketplace mockup had a green "Filters" button next to the search box; that was superseded by the later "date segment + More filters row" pattern (approved design in step 8 of this plan). This plan builds only the superseding pattern — no separate header Filters button.

---

## Task 1: Pure filtering/grouping logic (`lib/marketplaceFilters.ts`)

**Files:**
- Create: `apps/mobile/lib/marketplaceFilters.ts`
- Test: `apps/mobile/__tests__/marketplace-filters.test.ts`

**Interfaces:**
- Produces (used by every later task): `DateSegment`, `DATE_SEGMENT_ORDER`, `DATE_SEGMENT_LABELS`, `DistanceBucket`, `DISTANCE_BUCKET_ORDER`, `DISTANCE_BUCKET_LABELS`, `RegionFilterValue`, `MarketplaceFilters`, `DEFAULT_MARKETPLACE_FILTERS`, `isUpcoming(event, todayIso): boolean`, `matchesDistanceBucket(distances, bucket): boolean`, `filterMarketplaceEvents(events, filters, todayIso): EventRow[]`, `pickFeaturedEvents(events, todayIso, limit?): EventRow[]`, `groupEventsForDisplay(events, dateSegment, todayIso): EventSection[]`, `countActiveFilters(filters): number`.
- Consumes: `EventRow` type from `./events` (only for typing — Task 2 adds the `distances` field this module reads).

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/marketplace-filters.test.ts`:

```ts
import {
  isUpcoming, matchesDistanceBucket, filterMarketplaceEvents, pickFeaturedEvents,
  groupEventsForDisplay, countActiveFilters, DEFAULT_MARKETPLACE_FILTERS,
  type MarketplaceFilters,
} from "../lib/marketplaceFilters";
import type { EventRow } from "../lib/events";

const TODAY = "2026-07-23";

function makeEvent(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: "e1", org_id: "o1", name: "Test Event", place: null, region: null,
    event_date: "2026-08-01", end_date: null, elevation_gain_m: null, cutoff_hours: null,
    status: "open", hero_image_url: null, description: null, gallery: [], original_date: null,
    status_note: null, city_psgc_code: null, region_name: "Region XI", province_name: "Davao del Sur",
    city_name: "Digos City", venue: null, joined_count: 0, distances: [21],
    org_name: "Race Pace", org_color: "#159A55",
    ...overrides,
  };
}

describe("isUpcoming", () => {
  it("is true for an open event dated in the future", () => {
    expect(isUpcoming(makeEvent({ status: "open", event_date: "2026-08-01" }), TODAY)).toBe(true);
  });
  it("is true for an event with no event_date at all", () => {
    expect(isUpcoming(makeEvent({ event_date: null }), TODAY)).toBe(true);
  });
  it("is false for a cancelled event even if dated in the future", () => {
    expect(isUpcoming(makeEvent({ status: "cancelled", event_date: "2026-08-01" }), TODAY)).toBe(false);
  });
  it("is false for a completed event", () => {
    expect(isUpcoming(makeEvent({ status: "completed", event_date: "2026-08-01" }), TODAY)).toBe(false);
  });
  it("is false for an open event dated in the past", () => {
    expect(isUpcoming(makeEvent({ status: "open", event_date: "2026-01-01" }), TODAY)).toBe(false);
  });
  it("is true for an event dated exactly today", () => {
    expect(isUpcoming(makeEvent({ status: "open", event_date: TODAY }), TODAY)).toBe(true);
  });
});

describe("matchesDistanceBucket", () => {
  it("matches 21k for a 21km category", () => {
    expect(matchesDistanceBucket([21], "21k")).toBe(true);
  });
  it("does not match 10k for a 21km category", () => {
    expect(matchesDistanceBucket([21], "10k")).toBe(false);
  });
  it("matches ultra for anything over 75km", () => {
    expect(matchesDistanceBucket([80], "ultra")).toBe(true);
    expect(matchesDistanceBucket([75], "ultra")).toBe(false); // upper-inclusive on 50k_plus, not ultra
  });
  it("matches 50k_plus at the boundary (45km exclusive, 75km inclusive)", () => {
    expect(matchesDistanceBucket([45], "50k_plus")).toBe(false); // belongs to 42k (25-45 inclusive)
    expect(matchesDistanceBucket([45.01], "50k_plus")).toBe(true);
    expect(matchesDistanceBucket([75], "50k_plus")).toBe(true);
  });
  it("matches if any of an event's several distances falls in the bucket", () => {
    expect(matchesDistanceBucket([5, 42], "42k")).toBe(true);
  });
});

describe("filterMarketplaceEvents", () => {
  const upcoming = makeEvent({ id: "e-upcoming", status: "open", event_date: "2026-08-01" });
  const past = makeEvent({ id: "e-past", status: "open", event_date: "2026-01-01" });
  const cancelled = makeEvent({ id: "e-cancelled", status: "cancelled", event_date: "2026-08-01" });
  const events = [upcoming, past, cancelled];

  it("defaults to upcoming-only, excluding past and cancelled/completed", () => {
    const result = filterMarketplaceEvents(events, DEFAULT_MARKETPLACE_FILTERS, TODAY);
    expect(result.map((e) => e.id)).toEqual(["e-upcoming"]);
  });

  it("showPast flips the scope to only past/cancelled/completed", () => {
    const filters: MarketplaceFilters = { ...DEFAULT_MARKETPLACE_FILTERS, showPast: true };
    const result = filterMarketplaceEvents(events, filters, TODAY);
    expect(result.map((e) => e.id).sort()).toEqual(["e-cancelled", "e-past"]);
  });

  it("combines region, distance, and organizer filters with AND", () => {
    const events2 = [
      makeEvent({ id: "match", org_id: "o1", city_name: "Digos City", distances: [21] }),
      makeEvent({ id: "wrong-org", org_id: "o2", city_name: "Digos City", distances: [21] }),
      makeEvent({ id: "wrong-distance", org_id: "o1", city_name: "Digos City", distances: [5] }),
      makeEvent({ id: "wrong-city", org_id: "o1", city_name: "Manila", distances: [21] }),
    ];
    const filters: MarketplaceFilters = {
      ...DEFAULT_MARKETPLACE_FILTERS,
      region: { region_name: "Region XI", province_name: "Davao del Sur", city_name: "Digos City" },
      distanceBuckets: ["21k"],
      orgIds: ["o1"],
    };
    expect(filterMarketplaceEvents(events2, filters, TODAY).map((e) => e.id)).toEqual(["match"]);
  });

  it("matches region at whatever level was set (region-only, no province/city)", () => {
    const events2 = [makeEvent({ id: "in-region", region_name: "Region XI" }), makeEvent({ id: "other-region", region_name: "NCR" })];
    const filters: MarketplaceFilters = { ...DEFAULT_MARKETPLACE_FILTERS, region: { region_name: "Region XI" } };
    expect(filterMarketplaceEvents(events2, filters, TODAY).map((e) => e.id)).toEqual(["in-region"]);
  });

  it("applies the date segment on top of the upcoming scope", () => {
    const events2 = [
      makeEvent({ id: "this-week", event_date: "2026-07-25" }),
      makeEvent({ id: "later-this-month", event_date: "2026-07-30" }),
      makeEvent({ id: "later", event_date: "2026-09-01" }),
    ];
    const filters: MarketplaceFilters = { ...DEFAULT_MARKETPLACE_FILTERS, dateSegment: "week" };
    expect(filterMarketplaceEvents(events2, filters, TODAY).map((e) => e.id)).toEqual(["this-week"]);
  });
});

describe("pickFeaturedEvents", () => {
  it("returns the soonest upcoming events in ascending date order, excluding cancelled", () => {
    const events = [
      makeEvent({ id: "sep", event_date: "2026-09-01" }),
      makeEvent({ id: "aug-cancelled", event_date: "2026-08-01", status: "cancelled" }),
      makeEvent({ id: "aug", event_date: "2026-08-01" }),
      makeEvent({ id: "jul", event_date: "2026-07-25" }),
    ];
    expect(pickFeaturedEvents(events, TODAY).map((e) => e.id)).toEqual(["jul", "aug", "sep"]);
  });
  it("respects the limit", () => {
    const events = Array.from({ length: 5 }, (_, i) => makeEvent({ id: `e${i}`, event_date: `2026-08-0${i + 1}` }));
    expect(pickFeaturedEvents(events, TODAY, 2)).toHaveLength(2);
  });
});

describe("groupEventsForDisplay", () => {
  const events = [
    makeEvent({ id: "week", event_date: "2026-07-25" }),
    makeEvent({ id: "month", event_date: "2026-07-30" }),
    makeEvent({ id: "later", event_date: "2026-09-01" }),
  ];

  it("groups into This week / This month / Later when dateSegment is all", () => {
    const sections = groupEventsForDisplay(events, "all", TODAY);
    expect(sections.map((s) => s.title)).toEqual(["This week", "This month", "Later"]);
    expect(sections[0].data.map((e) => e.id)).toEqual(["week"]);
  });

  it("omits empty sections", () => {
    const sections = groupEventsForDisplay([events[2]], "all", TODAY);
    expect(sections).toEqual([{ title: "Later", data: [events[2]] }]);
  });

  it("returns one untitled section when a specific segment is active", () => {
    const sections = groupEventsForDisplay(events, "week", TODAY);
    expect(sections).toEqual([{ title: null, data: events }]);
  });

  it("returns an empty array for an empty list", () => {
    expect(groupEventsForDisplay([], "all", TODAY)).toEqual([]);
  });
});

describe("countActiveFilters", () => {
  it("counts region + distance buckets + organizers, not the date segment", () => {
    const filters: MarketplaceFilters = {
      dateSegment: "week",
      region: { region_name: "Region XI" },
      distanceBuckets: ["21k", "42k"],
      orgIds: ["o1"],
      showPast: false,
    };
    expect(countActiveFilters(filters)).toBe(4); // 1 region + 2 distances + 1 org
  });
  it("is zero for the default filters", () => {
    expect(countActiveFilters(DEFAULT_MARKETPLACE_FILTERS)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/mobile && npx jest marketplace-filters -v`
Expected: FAIL — `Cannot find module '../lib/marketplaceFilters'`

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/lib/marketplaceFilters.ts`:

```ts
import type { EventRow } from "./events";

export type DateSegment = "week" | "month" | "later" | "all";

export const DATE_SEGMENT_ORDER: DateSegment[] = ["week", "month", "later", "all"];

export const DATE_SEGMENT_LABELS: Record<DateSegment, string> = {
  week: "This week", month: "This month", later: "Later", all: "All",
};

export type DistanceBucket = "5k" | "10k" | "21k" | "42k" | "50k_plus" | "ultra";

export const DISTANCE_BUCKET_ORDER: DistanceBucket[] = ["5k", "10k", "21k", "42k", "50k_plus", "ultra"];

export const DISTANCE_BUCKET_LABELS: Record<DistanceBucket, string> = {
  "5k": "5K", "10k": "10K", "21k": "21K", "42k": "42K", "50k_plus": "50K+", ultra: "Ultra",
};

// Half-open, upper-inclusive: a distance belongs to the first bucket whose
// upper bound it does not exceed. Ranges are irregular on purpose — real
// trail-race distances (15K, 25K, 80K...) don't line up with road-race
// standards, so this bucket by "roughly this distance", not exact match.
const DISTANCE_BUCKET_RANGES: Record<DistanceBucket, [number, number]> = {
  "5k": [0, 7], "10k": [7, 15], "21k": [15, 25], "42k": [25, 45], "50k_plus": [45, 75], ultra: [75, Infinity],
};

export function matchesDistanceBucket(distances: number[], bucket: DistanceBucket): boolean {
  const [min, max] = DISTANCE_BUCKET_RANGES[bucket];
  return distances.some((d) => d > min && d <= max);
}

export type RegionFilterValue = { region_name: string; province_name?: string; city_name?: string };

export type MarketplaceFilters = {
  dateSegment: DateSegment;
  region: RegionFilterValue | null;
  distanceBuckets: DistanceBucket[];
  orgIds: string[];
  showPast: boolean;
};

export const DEFAULT_MARKETPLACE_FILTERS: MarketplaceFilters = {
  dateSegment: "all", region: null, distanceBuckets: [], orgIds: [], showPast: false,
};

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Local-time formatting only — parseIsoDate/formatIsoDate never round-trip
// through toISOString(), which converts to UTC and can shift the date by a
// day in timezones behind UTC.
function formatIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysIso(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setDate(d.getDate() + days);
  return formatIsoDate(d);
}

function endOfMonthIso(iso: string): string {
  const d = parseIsoDate(iso);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return formatIsoDate(end);
}

/** Not cancelled/completed, and no event_date in the past. An event with no
 *  event_date at all is treated as upcoming — nothing dates it out. */
export function isUpcoming(event: Pick<EventRow, "status" | "event_date">, todayIso: string): boolean {
  if (event.status === "cancelled" || event.status === "completed") return false;
  if (!event.event_date) return true;
  return event.event_date >= todayIso;
}

/** Assumes the event has already passed `isUpcoming` (event_date >= todayIso
 *  or null) — only used that way, by filterMarketplaceEvents and
 *  groupEventsForDisplay over an already-upcoming-scoped list. */
function matchesDateSegment(event: Pick<EventRow, "event_date">, segment: DateSegment, todayIso: string): boolean {
  if (segment === "all") return true;
  if (!event.event_date) return segment === "later";
  if (segment === "week") return event.event_date < addDaysIso(todayIso, 7);
  if (segment === "month") return event.event_date <= endOfMonthIso(todayIso);
  return event.event_date > endOfMonthIso(todayIso); // later
}

function matchesRegion(event: Pick<EventRow, "region_name" | "province_name" | "city_name">, region: RegionFilterValue | null): boolean {
  if (!region) return true;
  if (region.city_name) return event.city_name === region.city_name;
  if (region.province_name) return event.province_name === region.province_name;
  return event.region_name === region.region_name;
}

/** Applies every active filter as one AND-combination over the full fetched
 *  list. Text search (in app/(tabs)/events.tsx) continues to run on top of
 *  this result, unchanged from before this feature. */
export function filterMarketplaceEvents(events: EventRow[], filters: MarketplaceFilters, todayIso: string): EventRow[] {
  return events.filter((e) => {
    if (filters.showPast) {
      if (isUpcoming(e, todayIso)) return false;
    } else {
      if (!isUpcoming(e, todayIso)) return false;
      if (!matchesDateSegment(e, filters.dateSegment, todayIso)) return false;
    }
    if (!matchesRegion(e, filters.region)) return false;
    if (filters.distanceBuckets.length > 0 && !filters.distanceBuckets.some((b) => matchesDistanceBucket(e.distances, b))) return false;
    if (filters.orgIds.length > 0 && !filters.orgIds.includes(e.org_id)) return false;
    return true;
  });
}

/** Soonest N upcoming (non-cancelled/completed) events, for the featured carousel. */
export function pickFeaturedEvents(events: EventRow[], todayIso: string, limit = 3): EventRow[] {
  return events
    .filter((e): e is EventRow & { event_date: string } => isUpcoming(e, todayIso) && !!e.event_date)
    .slice()
    .sort((a, b) => (a.event_date < b.event_date ? -1 : a.event_date > b.event_date ? 1 : 0))
    .slice(0, limit);
}

export type EventSection = { title: string | null; data: EventRow[] };

/** Groups an already-filtered (upcoming-scoped) list into date sections.
 *  Only meaningful when dateSegment is "all" — a specific segment already
 *  scopes everything to one bucket, so grouping would just repeat one
 *  header; callers pass a non-"all" segment (or call this only when
 *  dateSegment === "all") to get the single flat section instead. */
export function groupEventsForDisplay(events: EventRow[], dateSegment: DateSegment, todayIso: string): EventSection[] {
  if (dateSegment !== "all") return events.length ? [{ title: null, data: events }] : [];
  const week = events.filter((e) => matchesDateSegment(e, "week", todayIso));
  const month = events.filter((e) => !week.includes(e) && matchesDateSegment(e, "month", todayIso));
  const later = events.filter((e) => !week.includes(e) && !month.includes(e));
  const sections: EventSection[] = [];
  if (week.length) sections.push({ title: "This week", data: week });
  if (month.length) sections.push({ title: "This month", data: month });
  if (later.length) sections.push({ title: "Later", data: later });
  return sections;
}

/** Counts filters shown in the "More filters" badge — the date segment is
 *  its own always-visible control, so it's excluded from this count. */
export function countActiveFilters(filters: MarketplaceFilters): number {
  return (filters.region ? 1 : 0) + filters.distanceBuckets.length + filters.orgIds.length;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/mobile && npx jest marketplace-filters -v`
Expected: PASS — all `describe` blocks green.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/marketplaceFilters.ts apps/mobile/__tests__/marketplace-filters.test.ts
git commit -m "feat(mobile): add pure marketplace filtering/grouping logic"
```

---

## Task 2: Extend `lib/events.ts` with per-category distances

**Files:**
- Modify: `apps/mobile/lib/events.ts:6,10,29,33-35`
- Modify: `apps/mobile/__tests__/events-hooks.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `EventRow.distances: number[]` — every later task that renders or filters by distance depends on this field existing.

- [ ] **Step 1: Write the failing test**

Add to `apps/mobile/__tests__/events-hooks.test.tsx` (inside the existing `describe("useMarketplaceEvents", ...)` block, after the existing two `it`s):

```ts
  it("collects each category's distance_km into a distances array, skipping nulls", async () => {
    mockOrder.mockResolvedValueOnce({
      data: [{
        id: "e3", org_id: "o1", name: "Highland Run", status: "open", gallery: null,
        categories: [{ slots_taken: 10, distance_km: 21 }, { slots_taken: 5, distance_km: null }, { slots_taken: 2, distance_km: 42 }],
        organizations: { name: "Race Pace", brand_color: "#159A55" },
      }],
      error: null,
    });
    const { result } = renderHook(() => useMarketplaceEvents(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toMatchObject({ id: "e3", distances: [21, 42] });
  });

  it("defaults distances to an empty array when there are no categories", async () => {
    const { result } = renderHook(() => useMarketplaceEvents(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toMatchObject({ id: "e1", distances: [] });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/mobile && npx jest events-hooks -v`
Expected: FAIL — `distances` is `undefined`, not `[21, 42]` / `[]`.

- [ ] **Step 3: Write the implementation**

In `apps/mobile/lib/events.ts`, update the `EventRow` type (line 6/10) to add `distances`:

```ts
export type EventRow = {
  id: string; org_id: string; name: string; place: string | null; region: string | null;
  event_date: string | null; end_date: string | null; elevation_gain_m: number | null; cutoff_hours: number | null;
  status: string; hero_image_url: string | null; description: string | null;
  gallery: string[]; original_date: string | null; status_note: string | null;
  city_psgc_code: string | null; region_name: string | null; province_name: string | null; city_name: string | null; venue: string | null;
  joined_count: number; distances: number[]; org_name?: string; org_color?: string | null;
};
```

Update `EVENT_COLS` (line 29) to also select `distance_km` in the embedded categories:

```ts
const EVENT_COLS =
  "id,org_id,name,place,region,event_date,end_date,elevation_gain_m,cutoff_hours,status,hero_image_url,description,gallery,original_date,status_note,city_psgc_code,region_name,province_name,city_name,venue,categories(slots_taken,distance_km)";
```

Update `mapEvent` (lines 33-36) to compute `distances` alongside `joined_count`:

```ts
function mapEvent(r: any): EventRow {
  const categories = (r.categories ?? []) as { slots_taken: number; distance_km: number | null }[];
  const joined_count = categories.reduce((sum, c) => sum + c.slots_taken, 0);
  const distances = categories.map((c) => c.distance_km).filter((d): d is number => d != null);
  return { ...r, gallery: r.gallery ?? [], joined_count, distances, org_name: r.organizations?.name, org_color: r.organizations?.brand_color };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/mobile && npx jest events-hooks -v`
Expected: PASS — all 4 tests (2 existing + 2 new) green.

- [ ] **Step 5: Run the full mobile suite to check for fallout**

Run: `cd apps/mobile && npx jest -v 2>&1 | tail -20`
Expected: `event-card.test.tsx`'s `base: EventRow` fixture is now missing the required `distances` field — this will surface as a TypeScript error if you run `npx tsc --noEmit`, though Jest itself (Babel-transpiled, no type-check) will likely still pass at runtime. Confirm with:

Run: `cd apps/mobile && npx tsc --noEmit 2>&1 | head -20`
Expected: an error on `apps/mobile/__tests__/event-card.test.tsx`'s `base` object, e.g. `Property 'distances' is missing in type ...`. This is expected — Task 6 fixes it when it touches that file. Do not fix it here; just confirm the error is exactly this one line, nothing else.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/lib/events.ts apps/mobile/__tests__/events-hooks.test.tsx
git commit -m "feat(mobile): add distance_km to the marketplace categories embed"
```

---

## Task 3: `PillMultiSelect` reusable component

**Files:**
- Create: `apps/mobile/components/PillMultiSelect.tsx`
- Test: `apps/mobile/__tests__/pill-multi-select.test.tsx`

**Interfaces:**
- Consumes: `ToggleGroup`/`ToggleGroupItem` from `@/components/ui/toggle-group` (already installed, `type="multiple"` support confirmed via `@rn-primitives/toggle-group`'s `getNewMultipleValue` util — item `role="checkbox"`, `accessibilityState.checked`).
- Produces: `PillMultiSelect({ label, value: string[], options: readonly string[], labels?: Record<string,string>, onChange: (v: string[]) => void, accessibilityLabel? })` — used by Task 9 (`MarketplaceFilterSheet`) for the distance-bucket picker.

This mirrors the existing single-select `components/PillSelect.tsx` (same visual style, same `ToggleGroup` primitive) but for `type="multiple"` — kept as a separate component rather than modifying `PillSelect` since the value/`onChange` shapes genuinely differ (`string` vs `string[]`) and `PillSelect` is already used elsewhere (profile blood-type/shirt-size fields, `DynamicField`'s "select" field type) — safer not to touch it.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/pill-multi-select.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react-native";
import { PillMultiSelect } from "../components/PillMultiSelect";

describe("PillMultiSelect", () => {
  it("renders the label and options", () => {
    render(<PillMultiSelect label="DISTANCE" value={[]} options={["5k", "21k"]} labels={{ "5k": "5K", "21k": "21K" }} onChange={jest.fn()} />);
    expect(screen.getByText("DISTANCE")).toBeOnTheScreen();
    expect(screen.getByText("5K")).toBeOnTheScreen();
    expect(screen.getByText("21K")).toBeOnTheScreen();
  });

  it("adds a pill to the selection when pressed", () => {
    const onChange = jest.fn();
    render(<PillMultiSelect label="DISTANCE" value={["21k"]} options={["5k", "21k", "42k"]} labels={{ "5k": "5K", "21k": "21K", "42k": "42K" }} onChange={onChange} />);
    fireEvent.press(screen.getByText("42K"));
    expect(onChange).toHaveBeenCalledWith(["21k", "42k"]);
  });

  it("removes a pill from the selection when its active pill is pressed again", () => {
    const onChange = jest.fn();
    render(<PillMultiSelect label="DISTANCE" value={["21k", "42k"]} options={["5k", "21k", "42k"]} labels={{ "5k": "5K", "21k": "21K", "42k": "42K" }} onChange={onChange} />);
    fireEvent.press(screen.getByText("21K"));
    expect(onChange).toHaveBeenCalledWith(["42k"]);
  });

  it("marks each selected value as checked", () => {
    render(<PillMultiSelect label="DISTANCE" value={["21k"]} options={["5k", "21k"]} labels={{ "5k": "5K", "21k": "21K" }} onChange={jest.fn()} />);
    expect(screen.getByRole("checkbox", { name: "21K", checked: true })).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "5K", checked: false })).toBeOnTheScreen();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/mobile && npx jest pill-multi-select -v`
Expected: FAIL — `Cannot find module '../components/PillMultiSelect'`

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/components/PillMultiSelect.tsx`:

```tsx
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export function PillMultiSelect({ label, value, options, labels, onChange, accessibilityLabel }: {
  label: string; value: string[]; options: readonly string[]; labels?: Record<string, string>;
  onChange: (v: string[]) => void; accessibilityLabel?: string;
}) {
  return (
    <View className="mt-[14px]">
      <Text
        className="text-[11px] font-semibold tracking-[0.4px] text-muted-foreground mb-2"
        accessibilityLabel={accessibilityLabel}
      >
        {label}
      </Text>
      <ToggleGroup type="multiple" value={value} onValueChange={onChange} className="flex-row flex-wrap gap-2">
        {options.map((opt) => {
          const active = value.includes(opt);
          const optLabel = labels?.[opt] ?? opt;
          return (
            <ToggleGroupItem
              key={opt}
              value={opt}
              accessibilityLabel={optLabel}
              className={cn("h-auto rounded-full border px-3.5 py-2", active ? "border-primary bg-primary" : "border-border")}
            >
              <Text className={active ? "text-primary-foreground font-semibold" : undefined}>{optLabel}</Text>
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </View>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/mobile && npx jest pill-multi-select -v`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/PillMultiSelect.tsx apps/mobile/__tests__/pill-multi-select.test.tsx
git commit -m "feat(mobile): add PillMultiSelect (multi-select sibling of PillSelect)"
```

---

## Task 4: `RegionFilterPicker` component

**Files:**
- Create: `apps/mobile/components/RegionFilterPicker.tsx`
- Test: `apps/mobile/__tests__/region-filter-picker.test.tsx`

**Interfaces:**
- Consumes: `usePsgcRegions`, `usePsgcProvinces`, `usePsgcCities` from `@/lib/psgc` (existing); `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem` from `@/components/ui/select` (existing); `RegionFilterValue` type from `../lib/marketplaceFilters` (Task 1).
- Produces: `RegionFilterPicker({ onChange: (v: RegionFilterValue) => void })` — used by Task 9 (`MarketplaceFilterSheet`).

Mirrors the existing `components/PsgcAddressPicker.tsx` cascade pattern (including its `key={regionCode}` / `key={regionCode:provinceCode}` remount trick, which works around RNR `Select` not clearing its internal state from an `undefined` value) — but unlike that component, **every level independently fires `onChange`** (filter semantics allow stopping at Region or Province; `PsgcAddressPicker`'s contract only fires once a City is chosen, which doesn't fit "filter by region alone"). There is no per-row "clear" — clearing back to no-region-filter happens via the filter sheet's global Reset (Task 9), so this component only ever narrows.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/region-filter-picker.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react-native";
import { PortalHost } from "@rn-primitives/portal";

let mockRegions: any[] = [{ code: "r1", name: "Davao Region" }, { code: "r2", name: "Metro Manila" }];
let mockProvincesResult: any = { data: [{ code: "p1", name: "Davao del Sur" }], isSuccess: true };
let mockCities: any[] = [{ code: "c1", name: "Digos City" }];

jest.mock("../lib/psgc", () => ({
  usePsgcRegions: () => ({ data: mockRegions }),
  usePsgcProvinces: () => mockProvincesResult,
  usePsgcCities: () => ({ data: mockCities, isSuccess: true }),
}));

import { RegionFilterPicker } from "../components/RegionFilterPicker";

function renderPicker(onChange = jest.fn()) {
  render(
    <>
      <RegionFilterPicker onChange={onChange} />
      <PortalHost />
    </>
  );
  return onChange;
}

async function openAndPick(label: string, text: string) {
  fireEvent.press(screen.getByLabelText(label));
  fireEvent.press(await screen.findByText(text));
}

describe("RegionFilterPicker", () => {
  beforeEach(() => {
    mockRegions = [{ code: "r1", name: "Davao Region" }, { code: "r2", name: "Metro Manila" }];
    mockProvincesResult = { data: [{ code: "p1", name: "Davao del Sur" }], isSuccess: true };
    mockCities = [{ code: "c1", name: "Digos City" }];
  });

  it("emits region-only as soon as a region is picked, unlike PsgcAddressPicker", async () => {
    const onChange = renderPicker();
    await openAndPick("Region", "Davao Region");
    expect(onChange).toHaveBeenCalledWith({ region_name: "Davao Region" });
  });

  it("narrows to region + province when a province is picked", async () => {
    const onChange = renderPicker();
    await openAndPick("Region", "Davao Region");
    await openAndPick("Province", "Davao del Sur");
    expect(onChange).toHaveBeenLastCalledWith({ region_name: "Davao Region", province_name: "Davao del Sur" });
  });

  it("narrows to region + province + city when a city is picked", async () => {
    const onChange = renderPicker();
    await openAndPick("Region", "Davao Region");
    await openAndPick("Province", "Davao del Sur");
    await openAndPick("City", "Digos City");
    expect(onChange).toHaveBeenLastCalledWith({ region_name: "Davao Region", province_name: "Davao del Sur", city_name: "Digos City" });
  });

  it("skips Province for a region with no provinces (NCR) and enables City immediately", async () => {
    mockProvincesResult = { data: [], isSuccess: true };
    renderPicker();
    await openAndPick("Region", "Metro Manila");
    expect(screen.queryByLabelText("Province")).toBeNull();
    expect(screen.getByLabelText("City").props.accessibilityState.disabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/mobile && npx jest region-filter-picker -v`
Expected: FAIL — `Cannot find module '../components/RegionFilterPicker'`

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/components/RegionFilterPicker.tsx`:

```tsx
import { useState } from "react";
import { View } from "react-native";
import { usePsgcCities, usePsgcProvinces, usePsgcRegions } from "@/lib/psgc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { RegionFilterValue } from "@/lib/marketplaceFilters";

type Option = { value: string; label: string } | undefined;

export function RegionFilterPicker({ onChange }: { onChange: (v: RegionFilterValue) => void }) {
  const [regionCode, setRegionCode] = useState("");
  const [provinceCode, setProvinceCode] = useState("");

  const regions = usePsgcRegions();
  const provinces = usePsgcProvinces(regionCode || undefined);
  const provincesLoading = !!regionCode && !provinces.isSuccess;
  const noProvinces = !!regionCode && provinces.isSuccess && (provinces.data?.length ?? 0) === 0;
  const cities = usePsgcCities({ provinceCode: provinceCode || undefined, regionCode: noProvinces ? regionCode : undefined });
  const citiesLoading = (!!provinceCode || noProvinces) && !cities.isSuccess;

  const regionName = (regions.data ?? []).find((r) => r.code === regionCode)?.name ?? null;
  const provinceName = (provinces.data ?? []).find((p) => p.code === provinceCode)?.name ?? null;

  function pickRegion(option: Option) {
    if (!option) return;
    setRegionCode(option.value);
    setProvinceCode("");
    onChange({ region_name: option.label });
  }
  function pickProvince(option: Option) {
    if (!option || !regionName) return;
    setProvinceCode(option.value);
    onChange({ region_name: regionName, province_name: option.label });
  }
  function pickCity(option: Option) {
    if (!option || !regionName) return;
    onChange({ region_name: regionName, province_name: provinceName ?? undefined, city_name: option.label });
  }

  const regionValue: Option = regionCode ? { value: regionCode, label: regionName ?? "" } : undefined;
  const provinceValue: Option = provinceCode ? { value: provinceCode, label: provinceName ?? "" } : undefined;
  const cityEnabled = !!provinceCode || noProvinces;

  return (
    <View className="gap-2">
      <Select value={regionValue} onValueChange={pickRegion}>
        <SelectTrigger accessibilityLabel="Region"><SelectValue placeholder="Select region" /></SelectTrigger>
        <SelectContent>
          {(regions.data ?? []).map((r) => <SelectItem key={r.code} value={r.code} label={r.name} />)}
        </SelectContent>
      </Select>

      {regionCode && !noProvinces ? (
        <Select key={regionCode} value={provinceValue} onValueChange={pickProvince}>
          <SelectTrigger accessibilityLabel="Province" disabled={provincesLoading}>
            <SelectValue placeholder={provincesLoading ? "Loading…" : "Select province"} />
          </SelectTrigger>
          <SelectContent>
            {(provinces.data ?? []).map((p) => <SelectItem key={p.code} value={p.code} label={p.name} />)}
          </SelectContent>
        </Select>
      ) : null}

      {regionCode ? (
        <Select key={`${regionCode}:${provinceCode}`} onValueChange={pickCity}>
          <SelectTrigger accessibilityLabel="City" disabled={!cityEnabled || citiesLoading}>
            <SelectValue placeholder={citiesLoading ? "Loading…" : "Select city (optional)"} />
          </SelectTrigger>
          <SelectContent>
            {(cities.data ?? []).map((c) => <SelectItem key={c.code} value={c.code} label={c.name} />)}
          </SelectContent>
        </Select>
      ) : null}
    </View>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/mobile && npx jest region-filter-picker -v`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/RegionFilterPicker.tsx apps/mobile/__tests__/region-filter-picker.test.tsx
git commit -m "feat(mobile): add RegionFilterPicker (region/province/city, each level a valid filter)"
```

---

## Task 5: `OrganizerFilterPicker` component

**Files:**
- Create: `apps/mobile/components/OrganizerFilterPicker.tsx`
- Test: `apps/mobile/__tests__/organizer-filter-picker.test.tsx`

**Interfaces:**
- Consumes: `OrgRow` type from `../lib/events`; `OrgAvatar` from `./OrgAvatar`; `Checkbox` from `@/components/ui/checkbox`; `Input` from `@/components/ui/input`.
- Produces: `OrganizerFilterPicker({ orgs: OrgRow[], selectedIds: string[], onChangeSelectedIds: (ids: string[]) => void, onBack: () => void })` — used by Task 9.

Search-first, sectioned-by-first-letter, no A–Z index rail (dropped during design review — sticky section headers carry it). Orgs with zero events are excluded — there'd be nothing to filter to.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/organizer-filter-picker.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react-native";
import { OrganizerFilterPicker } from "../components/OrganizerFilterPicker";
import type { OrgRow } from "../lib/events";

const orgs: OrgRow[] = [
  { id: "o1", name: "TrailRun PH", slug: "trailrun-ph", logo_url: null, banner_url: null, description: null, brand_color: "#3A7CC7", event_count: 12 },
  { id: "o2", name: "Endure PH", slug: "endure-ph", logo_url: null, banner_url: null, description: null, brand_color: "#C7473A", event_count: 7 },
  { id: "o3", name: "No Events Org", slug: "no-events", logo_url: null, banner_url: null, description: null, brand_color: null, event_count: 0 },
];

describe("OrganizerFilterPicker", () => {
  it("hides organizers with no events and lists the rest", () => {
    render(<OrganizerFilterPicker orgs={orgs} selectedIds={[]} onChangeSelectedIds={jest.fn()} onBack={jest.fn()} />);
    expect(screen.getByText("TrailRun PH")).toBeOnTheScreen();
    expect(screen.getByText("Endure PH")).toBeOnTheScreen();
    expect(screen.queryByText("No Events Org")).toBeNull();
  });

  it("filters the list as you type", () => {
    render(<OrganizerFilterPicker orgs={orgs} selectedIds={[]} onChangeSelectedIds={jest.fn()} onBack={jest.fn()} />);
    fireEvent.changeText(screen.getByPlaceholderText("Search organizers"), "trail");
    expect(screen.getByText("TrailRun PH")).toBeOnTheScreen();
    expect(screen.queryByText("Endure PH")).toBeNull();
  });

  it("adds an org to the selection when pressed", () => {
    const onChangeSelectedIds = jest.fn();
    render(<OrganizerFilterPicker orgs={orgs} selectedIds={["o1"]} onChangeSelectedIds={onChangeSelectedIds} onBack={jest.fn()} />);
    fireEvent.press(screen.getByText("Endure PH"));
    expect(onChangeSelectedIds).toHaveBeenCalledWith(["o1", "o2"]);
  });

  it("removes an org from the selection when its removable tag is pressed", () => {
    const onChangeSelectedIds = jest.fn();
    render(<OrganizerFilterPicker orgs={orgs} selectedIds={["o1", "o2"]} onChangeSelectedIds={onChangeSelectedIds} onBack={jest.fn()} />);
    fireEvent.press(screen.getAllByText("TrailRun PH")[0]);
    expect(onChangeSelectedIds).toHaveBeenCalledWith(["o2"]);
  });

  it("calls onBack when the back arrow is pressed", () => {
    const onBack = jest.fn();
    render(<OrganizerFilterPicker orgs={orgs} selectedIds={[]} onChangeSelectedIds={jest.fn()} onBack={onBack} />);
    fireEvent.press(screen.getByLabelText("Back"));
    expect(onBack).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/mobile && npx jest organizer-filter-picker -v`
Expected: FAIL — `Cannot find module '../components/OrganizerFilterPicker'`

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/components/OrganizerFilterPicker.tsx`:

```tsx
import { useMemo, useState } from "react";
import { View, Pressable, SectionList } from "react-native";
import { ChevronLeft, Search } from "lucide-react-native";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { Checkbox } from "@/components/ui/checkbox";
import { OrgAvatar } from "./OrgAvatar";
import type { OrgRow } from "@/lib/events";

function sectionOrgs(orgs: OrgRow[]): { title: string; data: OrgRow[] }[] {
  const sorted = [...orgs].sort((a, b) => a.name.localeCompare(b.name));
  const sections = new Map<string, OrgRow[]>();
  for (const org of sorted) {
    const letter = org.name[0]?.toUpperCase() ?? "#";
    if (!sections.has(letter)) sections.set(letter, []);
    sections.get(letter)!.push(org);
  }
  return Array.from(sections, ([title, data]) => ({ title, data }));
}

export function OrganizerFilterPicker({ orgs, selectedIds, onChangeSelectedIds, onBack }: {
  orgs: OrgRow[]; selectedIds: string[]; onChangeSelectedIds: (ids: string[]) => void; onBack: () => void;
}) {
  const [q, setQ] = useState("");

  const withEvents = useMemo(() => orgs.filter((o) => (o.event_count ?? 0) > 0), [orgs]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? withEvents.filter((o) => o.name.toLowerCase().includes(needle)) : withEvents;
  }, [withEvents, q]);
  const sections = useMemo(() => sectionOrgs(filtered), [filtered]);
  const selectedOrgs = useMemo(() => orgs.filter((o) => selectedIds.includes(o.id)), [orgs, selectedIds]);

  function toggle(id: string) {
    onChangeSelectedIds(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  return (
    <View className="flex-1">
      <View className="flex-row items-center gap-[10px] mb-4">
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
          <Icon as={ChevronLeft} size={20} className="text-primary" />
        </Pressable>
        <Text className="text-[17px] font-bold text-foreground">Organizer</Text>
      </View>

      <View className="flex-row items-center gap-2 bg-muted rounded-[11px] py-2.5 px-[12px] mb-3">
        <Icon as={Search} size={16} className="text-muted-foreground" />
        <Input
          className="flex-1 border-0 bg-transparent h-auto p-0 shadow-none"
          value={q}
          onChangeText={setQ}
          placeholder="Search organizers"
          autoCapitalize="none"
          accessibilityLabel="Search organizers"
        />
      </View>

      {selectedOrgs.length > 0 ? (
        <View className="flex-row flex-wrap gap-[7px] mb-3">
          {selectedOrgs.map((o) => (
            <Pressable
              key={o.id}
              onPress={() => toggle(o.id)}
              accessibilityRole="button"
              className="flex-row items-center gap-[6px] bg-secondary rounded-full px-[10px] py-[5px]"
            >
              <Text className="text-[12px] font-semibold text-secondary-foreground">{o.name}</Text>
              <Text className="text-[12px] text-secondary-foreground/70">✕</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(o) => o.id}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) => (
          <Text className="text-[12px] font-bold text-primary bg-background pt-2 pb-1">{section.title}</Text>
        )}
        renderItem={({ item }) => {
          const checked = selectedIds.includes(item.id);
          return (
            <Pressable onPress={() => toggle(item.id)} accessibilityRole="button" className="flex-row items-center gap-3 py-[11px]">
              <OrgAvatar name={item.name} color={item.brand_color} size={32} radius={9} />
              <View className="flex-1">
                <Text className="text-[14.5px] text-foreground">{item.name}</Text>
                <Text className="text-[11.5px] text-muted-foreground">{item.event_count} {item.event_count === 1 ? "event" : "events"}</Text>
              </View>
              <Checkbox checked={checked} onCheckedChange={() => toggle(item.id)} accessibilityLabel={item.name} />
            </Pressable>
          );
        }}
        ListEmptyComponent={<Text className="text-muted-foreground py-6 text-center">No organizers match "{q}"</Text>}
      />
    </View>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/mobile && npx jest organizer-filter-picker -v`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/OrganizerFilterPicker.tsx apps/mobile/__tests__/organizer-filter-picker.test.tsx
git commit -m "feat(mobile): add OrganizerFilterPicker (search + sectioned multi-select)"
```

---

## Task 6: Redesign `EventCard` to the immersive-overlay style

**Files:**
- Modify: `apps/mobile/components/EventCard.tsx`
- Modify: `apps/mobile/lib/format.ts`
- Modify: `apps/mobile/__tests__/event-card.test.tsx`

**Interfaces:**
- Consumes: `EventRow.distances` (Task 2).
- Produces: `EventCard` unchanged in props (`{ event, showOrg?, onPress }`) and unchanged `testID="event-card-image"` — Task 7 (`FeaturedCarousel`) reuses this component as-is.

- [ ] **Step 1: Write the failing tests**

First, add a `distanceLabel` helper to `apps/mobile/lib/format.ts` (append to the file):

```ts
/** "21" -> "21K" — race distances are conventionally quoted rounded, in km. */
export function distanceLabel(km: number): string {
  return `${Math.round(km)}K`;
}
```

Then update `apps/mobile/__tests__/event-card.test.tsx`: add `distances: []` to the `base` fixture (it's a required field as of Task 2), and append two new tests at the end of the file:

```ts
const base: EventRow = {
  id: "e1", org_id: "o1", name: "Highland Trail Run", place: null, region: null,
  event_date: "2026-11-14", end_date: null, elevation_gain_m: null, cutoff_hours: null, status: "open",
  hero_image_url: null, description: null, gallery: [], original_date: null, status_note: null,
  city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null,
  joined_count: 0, distances: [], org_name: "Race Pace", org_color: "#159A55",
};
```

```ts
it("shows a distance pill for each distinct category distance", () => {
  render(<EventCard event={{ ...base, distances: [21, 42, 21] }} onPress={() => {}} />);
  expect(screen.getByText("21K")).toBeOnTheScreen();
  expect(screen.getByText("42K")).toBeOnTheScreen();
});

it("shows no distance pills when the event has no categorized distances", () => {
  render(<EventCard event={{ ...base, distances: [] }} onPress={() => {}} />);
  expect(screen.queryByText(/^\d+K$/)).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `cd apps/mobile && npx jest event-card -v`
Expected: the two new tests FAIL (`distances` isn't rendered yet); the pre-existing tests should still PASS since the fixture edit is additive and nothing else changed yet.

- [ ] **Step 3: Write the implementation**

Replace `apps/mobile/components/EventCard.tsx` in full:

```tsx
import { useRef, useState } from "react";
import { View, Pressable, Image } from "react-native";
import Svg, { Defs, LinearGradient, Stop, Rect } from "react-native-svg";
import { formatAddress, formatDateRange } from "@race-pace/shared";
import type { EventRow } from "../lib/events";
import { ElevationHero } from "./ElevationHero";
import { OrgAvatar } from "./OrgAvatar";
import { StatusBadge, eventStatusKind } from "./StatusBadge";
import { shortDate, distanceLabel } from "../lib/format";
import { Text } from "@/components/ui/text";

let _gid = 0;

export function EventCard({ event, showOrg = true, onPress }: { event: EventRow; showOrg?: boolean; onPress: () => void }) {
  const cancelled = eventStatusKind(event) === "cancelled";
  const address = formatAddress(event) || event.place;
  const dateRange = event.event_date ? formatDateRange(event.event_date, event.end_date, shortDate) : "";
  const dateLabel = dateRange ? (cancelled ? `was ${dateRange}` : dateRange) : "";
  const [imgFailed, setImgFailed] = useState(false);
  // Unique gradient id per card instance — SVG <Defs> ids are scoped per
  // render tree, and many cards render at once in a FlatList, so a shared id
  // would let one card's gradient leak into another's (same technique as
  // ElevationHero's `_gid` counter).
  const idRef = useRef<string | undefined>(undefined);
  if (!idRef.current) idRef.current = `ecg${_gid++}`;
  const distinctDistances = [...new Set(event.distances)].sort((a, b) => a - b);

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <View className="rounded-[18px] overflow-hidden mb-4" style={{ height: 210 }}>
        {event.hero_image_url && !imgFailed ? (
          <Image
            testID="event-card-image"
            source={{ uri: event.hero_image_url }}
            style={{ position: "absolute", height: "100%", width: "100%" }}
            resizeMode="cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <View style={{ position: "absolute", height: "100%", width: "100%" }}>
            <ElevationHero height={210} />
          </View>
        )}

        <Svg
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "70%", width: "100%" }}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <Defs>
            <LinearGradient id={idRef.current} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#000000" stopOpacity={0} />
              <Stop offset="1" stopColor="#000000" stopOpacity={0.82} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={100} height={100} fill={`url(#${idRef.current})`} />
        </Svg>

        <View className="absolute top-3 left-3"><StatusBadge event={event} /></View>
        {showOrg && event.org_name ? (
          <View className="absolute top-3 right-3">
            <OrgAvatar name={event.org_name} color={event.org_color} size={30} radius={9} />
          </View>
        ) : null}

        <View className="absolute left-[14px] right-[14px] bottom-3">
          <Text className="text-[16.5px] font-bold text-white" numberOfLines={1}>{event.name}</Text>
          {address ? <Text className="text-[12.5px] text-white/85 mt-[3px]" numberOfLines={1}>{address}</Text> : null}
          {dateLabel ? <Text className="text-[12.5px] text-white/85 mt-0.5">{dateLabel}</Text> : null}
          {event.joined_count > 0 ? <Text className="text-[11.5px] text-white/70 mt-0.5">+{event.joined_count} joined</Text> : null}
          {distinctDistances.length > 0 ? (
            <View className="flex-row flex-wrap gap-[6px] mt-[9px]">
              {distinctDistances.map((d) => (
                <View key={d} className="bg-white/15 border border-white/25 rounded-full px-[9px] py-[3px]">
                  <Text className="text-[11px] font-semibold text-white">{distanceLabel(d)}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
```

- [ ] **Step 4: Run the tests to verify everything passes**

Run: `cd apps/mobile && npx jest event-card -v`
Expected: PASS — all tests (the pre-existing 7 plus the 2 new ones) green. The pre-existing address/date-range/joined-count/image-fallback assertions pass unchanged because those `<Text>` lines and `testID`s were preserved exactly.

- [ ] **Step 5: Confirm the Task 2 typecheck error is now gone**

Run: `cd apps/mobile && npx tsc --noEmit 2>&1 | head -20`
Expected: no output (clean) — the `base` fixture now satisfies `EventRow`.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/components/EventCard.tsx apps/mobile/lib/format.ts apps/mobile/__tests__/event-card.test.tsx
git commit -m "feat(mobile): redesign EventCard to the immersive-overlay style"
```

---

## Task 7: `FeaturedCarousel` component

**Files:**
- Create: `apps/mobile/components/FeaturedCarousel.tsx`
- Test: `apps/mobile/__tests__/featured-carousel.test.tsx`

**Interfaces:**
- Consumes: `EventCard` (Task 6, unchanged props) — deliberately reused as-is rather than duplicating a near-identical "hero card"; the redesigned `EventCard` is already the immersive-overlay look this carousel needs, just at full carousel-item width instead of the section-list width.
- Produces: `FeaturedCarousel({ events: EventRow[], onPressEvent: (event: EventRow) => void })` — used by Task 10 (`events.tsx`), fed the output of `pickFeaturedEvents` (Task 1).

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/featured-carousel.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react-native";
import { FeaturedCarousel } from "../components/FeaturedCarousel";
import type { EventRow } from "../lib/events";

function makeEvent(id: string, name: string): EventRow {
  return {
    id, org_id: "o1", name, place: null, region: null, event_date: "2026-09-14", end_date: null,
    elevation_gain_m: null, cutoff_hours: null, status: "open", hero_image_url: null, description: null,
    gallery: [], original_date: null, status_note: null, city_psgc_code: null, region_name: null,
    province_name: null, city_name: null, venue: null, joined_count: 0, distances: [21],
    org_name: "TrailRun PH", org_color: "#3A7CC7",
  };
}

describe("FeaturedCarousel", () => {
  it("renders nothing when there are no featured events", () => {
    render(<FeaturedCarousel events={[]} onPressEvent={jest.fn()} />);
    expect(screen.queryByTestId("featured-carousel")).toBeNull();
  });

  it("renders one card per featured event and a pagination dot per event", () => {
    const events = [makeEvent("e1", "Masungi Trail Challenge"), makeEvent("e2", "Sagada Skyrace")];
    render(<FeaturedCarousel events={events} onPressEvent={jest.fn()} />);
    expect(screen.getByText("Masungi Trail Challenge")).toBeOnTheScreen();
    expect(screen.getByText("Sagada Skyrace")).toBeOnTheScreen();
    expect(screen.getByTestId("featured-dot-0")).toBeOnTheScreen();
    expect(screen.getByTestId("featured-dot-1")).toBeOnTheScreen();
  });

  it("hides pagination dots for a single featured event", () => {
    render(<FeaturedCarousel events={[makeEvent("e1", "Masungi Trail Challenge")]} onPressEvent={jest.fn()} />);
    expect(screen.queryByTestId("featured-dot-0")).toBeNull();
  });

  it("calls onPressEvent with the pressed event", () => {
    const onPressEvent = jest.fn();
    const events = [makeEvent("e1", "Masungi Trail Challenge")];
    render(<FeaturedCarousel events={events} onPressEvent={onPressEvent} />);
    fireEvent.press(screen.getByText("Masungi Trail Challenge"));
    expect(onPressEvent).toHaveBeenCalledWith(events[0]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/mobile && npx jest featured-carousel -v`
Expected: FAIL — `Cannot find module '../components/FeaturedCarousel'`

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/components/FeaturedCarousel.tsx`:

```tsx
import { useRef, useState } from "react";
import { View, FlatList, useWindowDimensions, type ViewToken } from "react-native";
import type { EventRow } from "@/lib/events";
import { EventCard } from "./EventCard";

export function FeaturedCarousel({ events, onPressEvent }: { events: EventRow[]; onPressEvent: (event: EventRow) => void }) {
  const { width } = useWindowDimensions();
  const cardWidth = width - 44; // matches the screen's 22px horizontal padding on each side
  const [activeIndex, setActiveIndex] = useState(0);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index != null) setActiveIndex(first.index);
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  if (events.length === 0) return null;

  return (
    <View testID="featured-carousel" className="mb-2">
      <FlatList
        data={events}
        keyExtractor={(e) => e.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardWidth}
        decelerationRate="fast"
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        renderItem={({ item }) => (
          <View style={{ width: cardWidth }}>
            <EventCard event={item} onPress={() => onPressEvent(item)} />
          </View>
        )}
      />
      {events.length > 1 ? (
        <View className="flex-row justify-center gap-[6px] -mt-1">
          {events.map((e, i) => (
            <View
              key={e.id}
              testID={`featured-dot-${i}`}
              className={i === activeIndex ? "h-[3px] w-4 rounded-full bg-primary" : "h-[6px] w-[6px] rounded-full bg-border"}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/mobile && npx jest featured-carousel -v`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/FeaturedCarousel.tsx apps/mobile/__tests__/featured-carousel.test.tsx
git commit -m "feat(mobile): add FeaturedCarousel (paged hero + dot pagination)"
```

---

## Task 8: `MarketplaceFilterBar` component

**Files:**
- Create: `apps/mobile/components/MarketplaceFilterBar.tsx`
- Test: `apps/mobile/__tests__/marketplace-filter-bar.test.tsx`

**Interfaces:**
- Consumes: `DATE_SEGMENT_ORDER`, `DATE_SEGMENT_LABELS`, `DateSegment` from `@/lib/marketplaceFilters` (Task 1); `ToggleGroup`/`ToggleGroupItem` (existing).
- Produces: `MarketplaceFilterBar({ dateSegment, onDateSegmentChange, activeFilterCount, onPressMoreFilters })` — used by Task 10.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/marketplace-filter-bar.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react-native";
import { MarketplaceFilterBar } from "../components/MarketplaceFilterBar";

describe("MarketplaceFilterBar", () => {
  it("reports the picked date segment", () => {
    const onDateSegmentChange = jest.fn();
    render(<MarketplaceFilterBar dateSegment="all" onDateSegmentChange={onDateSegmentChange} activeFilterCount={0} onPressMoreFilters={jest.fn()} />);
    fireEvent.press(screen.getByRole("radio", { name: "This month" }));
    expect(onDateSegmentChange).toHaveBeenCalledWith("month");
  });

  it("marks the active segment as checked", () => {
    render(<MarketplaceFilterBar dateSegment="week" onDateSegmentChange={jest.fn()} activeFilterCount={0} onPressMoreFilters={jest.fn()} />);
    expect(screen.getByRole("radio", { name: "This week", checked: true })).toBeOnTheScreen();
    expect(screen.getByRole("radio", { name: "All", checked: false })).toBeOnTheScreen();
  });

  it("shows the active filter count badge only when filters are applied", () => {
    const { rerender } = render(<MarketplaceFilterBar dateSegment="all" onDateSegmentChange={jest.fn()} activeFilterCount={0} onPressMoreFilters={jest.fn()} />);
    expect(screen.queryByText("2")).toBeNull();
    rerender(<MarketplaceFilterBar dateSegment="all" onDateSegmentChange={jest.fn()} activeFilterCount={2} onPressMoreFilters={jest.fn()} />);
    expect(screen.getByText("2")).toBeOnTheScreen();
  });

  it("opens the filter sheet on press", () => {
    const onPressMoreFilters = jest.fn();
    render(<MarketplaceFilterBar dateSegment="all" onDateSegmentChange={jest.fn()} activeFilterCount={0} onPressMoreFilters={onPressMoreFilters} />);
    fireEvent.press(screen.getByLabelText("More filters"));
    expect(onPressMoreFilters).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/mobile && npx jest marketplace-filter-bar -v`
Expected: FAIL — `Cannot find module '../components/MarketplaceFilterBar'`

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/components/MarketplaceFilterBar.tsx`:

```tsx
import { View, Pressable } from "react-native";
import { SlidersHorizontal } from "lucide-react-native";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DATE_SEGMENT_ORDER, DATE_SEGMENT_LABELS, type DateSegment } from "@/lib/marketplaceFilters";

export function MarketplaceFilterBar({ dateSegment, onDateSegmentChange, activeFilterCount, onPressMoreFilters }: {
  dateSegment: DateSegment; onDateSegmentChange: (s: DateSegment) => void;
  activeFilterCount: number; onPressMoreFilters: () => void;
}) {
  return (
    <View className="mt-[14px]">
      <View className="flex-row bg-muted rounded-[12px] p-[3px]">
        <ToggleGroup
          type="single"
          value={dateSegment}
          onValueChange={(v) => { if (v) onDateSegmentChange(v as DateSegment); }}
          className="flex-row flex-1"
        >
          {DATE_SEGMENT_ORDER.map((seg) => {
            const active = dateSegment === seg;
            return (
              <ToggleGroupItem
                key={seg}
                value={seg}
                accessibilityLabel={DATE_SEGMENT_LABELS[seg]}
                className={cn("flex-1 rounded-[9px] py-2", active ? "bg-primary" : "bg-transparent")}
              >
                <Text className={cn("text-center text-[12px]", active ? "text-primary-foreground font-semibold" : "text-muted-foreground")}>
                  {DATE_SEGMENT_LABELS[seg]}
                </Text>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </View>

      <Pressable
        onPress={onPressMoreFilters}
        accessibilityRole="button"
        accessibilityLabel="More filters"
        className="flex-row items-center justify-center gap-[6px] border border-border rounded-[12px] py-[10px] mt-[10px]"
      >
        <Icon as={SlidersHorizontal} size={15} className="text-muted-foreground" />
        <Text className="text-[12.5px] text-muted-foreground">More filters</Text>
        {activeFilterCount > 0 ? (
          <Badge className="ml-1"><Text>{activeFilterCount}</Text></Badge>
        ) : null}
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/mobile && npx jest marketplace-filter-bar -v`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/MarketplaceFilterBar.tsx apps/mobile/__tests__/marketplace-filter-bar.test.tsx
git commit -m "feat(mobile): add MarketplaceFilterBar (date segment + More filters row)"
```

---

## Task 9: Bottom-sheet Dialog support + `MarketplaceFilterSheet`

**Files:**
- Modify: `apps/mobile/components/ui/dialog.tsx`
- Create: `apps/mobile/components/MarketplaceFilterSheet.tsx`
- Test: `apps/mobile/__tests__/marketplace-filter-sheet.test.tsx`

**Interfaces:**
- Consumes: `PillMultiSelect` (Task 3), `RegionFilterPicker` (Task 4), `OrganizerFilterPicker` (Task 5), `filterMarketplaceEvents`/`DEFAULT_MARKETPLACE_FILTERS`/`DISTANCE_BUCKET_ORDER`/`DISTANCE_BUCKET_LABELS`/`MarketplaceFilters`/`RegionFilterValue` (Task 1), `EventRow`/`OrgRow` (Task 2/existing).
- Produces: `MarketplaceFilterSheet({ open, onOpenChange, filters, onApply, allEvents, orgs, todayIso })` — used by Task 10. Also produces two new optional `DialogContent` props (`overlayClassName`, `showCloseButton`) — additive, default-preserving, so any future default (centered-modal) `Dialog` usage elsewhere is unaffected. `Dialog` is not used anywhere else in the app today, so there is zero regression risk here.

- [ ] **Step 1: Add bottom-sheet support to the shared `Dialog` component**

Modify `apps/mobile/components/ui/dialog.tsx`'s `DialogContent` function (the whole function, replacing it in place):

```tsx
function DialogContent({
  className,
  overlayClassName,
  showCloseButton = true,
  portalHost,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  portalHost?: string;
  overlayClassName?: string;
  showCloseButton?: boolean;
}) {
  return (
    <DialogPortal hostName={portalHost}>
      <DialogOverlay className={overlayClassName}>
        <DialogPrimitive.Content
          className={cn(
            'bg-background border-border z-50 mx-auto flex w-full max-w-[calc(100%-2rem)] flex-col gap-4 rounded-lg border p-6 shadow-lg shadow-black/5 sm:max-w-lg',
            Platform.select({
              web: 'animate-in fade-in-0 zoom-in-95 duration-200',
            }),
            className
          )}
          {...props}>
          <>{children}</>
          {showCloseButton ? (
            <DialogPrimitive.Close
              className={cn(
                'absolute right-4 top-4 rounded opacity-70 active:opacity-100',
                Platform.select({
                  web: 'ring-offset-background focus:ring-ring data-[state=open]:bg-accent transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-2',
                })
              )}
              hitSlop={12}>
              <Icon
                as={X}
                className={cn('text-accent-foreground web:pointer-events-none size-4 shrink-0')}
              />
              <Text className="sr-only">Close</Text>
            </DialogPrimitive.Close>
          ) : null}
        </DialogPrimitive.Content>
      </DialogOverlay>
    </DialogPortal>
  );
}
```

This is the only change to the file — `overlayClassName` (default `undefined`, i.e. no change to `DialogOverlay`'s existing centered `items-center justify-center` alignment) and `showCloseButton` (default `true`, i.e. the close X still renders exactly as before) are both additive with unchanged defaults.

- [ ] **Step 2: Verify the mobile suite is still green after the Dialog change**

Run: `cd apps/mobile && npx jest -v 2>&1 | tail -10`
Expected: all suites still PASS (nothing currently uses `Dialog`, so this is a no-op change to existing behavior).

- [ ] **Step 3: Write the failing test for `MarketplaceFilterSheet`**

Create `apps/mobile/__tests__/marketplace-filter-sheet.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react-native";
import { PortalHost } from "@rn-primitives/portal";
import { MarketplaceFilterSheet } from "../components/MarketplaceFilterSheet";
import { DEFAULT_MARKETPLACE_FILTERS } from "../lib/marketplaceFilters";
import type { EventRow, OrgRow } from "../lib/events";

const TODAY = "2026-07-23";

const events: EventRow[] = [
  {
    id: "e1", org_id: "o1", name: "Rizal Ridge Ultra", place: null, region: null,
    event_date: "2026-08-01", end_date: null, elevation_gain_m: null, cutoff_hours: null, status: "open",
    hero_image_url: null, description: null, gallery: [], original_date: null, status_note: null,
    city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null,
    joined_count: 0, distances: [21], org_name: "TrailRun PH", org_color: "#3A7CC7",
  },
  {
    id: "e2", org_id: "o2", name: "Batangas Coastal 50", place: null, region: null,
    event_date: "2026-08-05", end_date: null, elevation_gain_m: null, cutoff_hours: null, status: "open",
    hero_image_url: null, description: null, gallery: [], original_date: null, status_note: null,
    city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null,
    joined_count: 0, distances: [50], org_name: "Endure PH", org_color: "#C7473A",
  },
];

const orgs: OrgRow[] = [
  { id: "o1", name: "TrailRun PH", slug: "trailrun-ph", logo_url: null, banner_url: null, description: null, brand_color: "#3A7CC7", event_count: 1 },
  { id: "o2", name: "Endure PH", slug: "endure-ph", logo_url: null, banner_url: null, description: null, brand_color: "#C7473A", event_count: 1 },
];

function renderSheet(props: Partial<React.ComponentProps<typeof MarketplaceFilterSheet>> = {}) {
  const onOpenChange = jest.fn();
  const onApply = jest.fn();
  render(
    <>
      <MarketplaceFilterSheet
        open
        onOpenChange={onOpenChange}
        filters={DEFAULT_MARKETPLACE_FILTERS}
        onApply={onApply}
        allEvents={events}
        orgs={orgs}
        todayIso={TODAY}
        {...props}
      />
      <PortalHost />
    </>
  );
  return { onOpenChange, onApply };
}

describe("MarketplaceFilterSheet", () => {
  it("shows a live match count that narrows as distance filters are picked", () => {
    renderSheet();
    expect(screen.getByText("Show 2 events")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("21K"));
    expect(screen.getByText("Show 1 event")).toBeOnTheScreen();
  });

  it("applies the draft selection and closes on Apply", () => {
    const { onApply, onOpenChange } = renderSheet();
    fireEvent.press(screen.getByText("21K"));
    fireEvent.press(screen.getByText("Show 1 event"));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ distanceBuckets: ["21k"] }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("discards the draft and closes on Cancel", () => {
    const { onApply, onOpenChange } = renderSheet();
    fireEvent.press(screen.getByText("21K"));
    fireEvent.press(screen.getByText("Cancel"));
    expect(onApply).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("navigates into the Organizer picker and back", async () => {
    renderSheet();
    fireEvent.press(screen.getByText("All organizers"));
    expect(await screen.findByPlaceholderText("Search organizers")).toBeOnTheScreen();
    fireEvent.press(screen.getByLabelText("Back"));
    expect(screen.getByText("All organizers")).toBeOnTheScreen();
  });

  it("resets distance/region/organizer but keeps the date segment when applied", () => {
    const { onApply } = renderSheet({ filters: { ...DEFAULT_MARKETPLACE_FILTERS, dateSegment: "week", distanceBuckets: ["21k"] } });
    expect(screen.getByRole("checkbox", { name: "21K", checked: true })).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Reset"));
    expect(screen.getByRole("checkbox", { name: "21K", checked: false })).toBeOnTheScreen();
    fireEvent.press(screen.getByText(/Show \d+ events?/));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ dateSegment: "week", distanceBuckets: [] }));
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd apps/mobile && npx jest marketplace-filter-sheet -v`
Expected: FAIL — `Cannot find module '../components/MarketplaceFilterSheet'`

- [ ] **Step 5: Write the implementation**

Create `apps/mobile/components/MarketplaceFilterSheet.tsx`:

```tsx
import { useEffect, useState } from "react";
import { View, Pressable, ScrollView } from "react-native";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { PillMultiSelect } from "./PillMultiSelect";
import { RegionFilterPicker } from "./RegionFilterPicker";
import { OrganizerFilterPicker } from "./OrganizerFilterPicker";
import {
  DISTANCE_BUCKET_ORDER, DISTANCE_BUCKET_LABELS,
  DEFAULT_MARKETPLACE_FILTERS, filterMarketplaceEvents,
  type MarketplaceFilters, type RegionFilterValue,
} from "@/lib/marketplaceFilters";
import type { EventRow, OrgRow } from "@/lib/events";

function regionSummary(region: RegionFilterValue | null): string {
  if (!region) return "All regions";
  return region.city_name ?? region.province_name ?? region.region_name;
}

type SubView = "root" | "region" | "organizer";

export function MarketplaceFilterSheet({ open, onOpenChange, filters, onApply, allEvents, orgs, todayIso }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  filters: MarketplaceFilters; onApply: (f: MarketplaceFilters) => void;
  allEvents: EventRow[]; orgs: OrgRow[]; todayIso: string;
}) {
  const [draft, setDraft] = useState<MarketplaceFilters>(filters);
  const [subView, setSubView] = useState<SubView>("root");

  useEffect(() => {
    if (open) { setDraft(filters); setSubView("root"); }
  }, [open, filters]);

  const matchCount = filterMarketplaceEvents(allEvents, draft, todayIso).length;

  function apply() {
    onApply(draft);
    onOpenChange(false);
  }
  function reset() {
    setDraft((d) => ({ ...DEFAULT_MARKETPLACE_FILTERS, dateSegment: d.dateSegment, showPast: d.showPast }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="justify-end p-0"
        showCloseButton={false}
        className="rounded-b-none rounded-t-[22px] mx-0 w-full max-w-full max-h-[80%] gap-0"
      >
        <View className="w-9 h-1 rounded-full bg-border self-center mb-3" />

        {subView === "root" ? (
          <>
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-[17px] font-bold text-foreground">More filters</Text>
              <Pressable onPress={reset} accessibilityRole="button">
                <Text className="text-[12.5px] text-muted-foreground">Reset</Text>
              </Pressable>
            </View>

            <ScrollView>
              <Text className="text-[12px] font-bold uppercase tracking-[0.5px] text-muted-foreground mt-2 mb-2">Region</Text>
              <Pressable
                onPress={() => setSubView("region")}
                accessibilityRole="button"
                className="flex-row items-center justify-between py-3 border-b border-divider"
              >
                <Text className="text-[14.5px] text-foreground">Region / Province / City</Text>
                <View className="flex-row items-center gap-1">
                  <Text className="text-[13px] text-muted-foreground">{regionSummary(draft.region)}</Text>
                  <Icon as={ChevronRight} size={16} className="text-muted-foreground" />
                </View>
              </Pressable>

              <PillMultiSelect
                label="DISTANCE"
                value={draft.distanceBuckets}
                options={DISTANCE_BUCKET_ORDER}
                labels={DISTANCE_BUCKET_LABELS}
                onChange={(v) => setDraft((d) => ({ ...d, distanceBuckets: v as MarketplaceFilters["distanceBuckets"] }))}
              />

              <Text className="text-[12px] font-bold uppercase tracking-[0.5px] text-muted-foreground mt-5 mb-2">Organizer</Text>
              <Pressable
                onPress={() => setSubView("organizer")}
                accessibilityRole="button"
                className="flex-row items-center justify-between py-3 border-b border-divider"
              >
                <Text className="text-[14.5px] text-foreground">
                  {draft.orgIds.length > 0 ? `${draft.orgIds.length} selected` : "All organizers"}
                </Text>
                <Icon as={ChevronRight} size={16} className="text-muted-foreground" />
              </Pressable>
            </ScrollView>

            <View className="flex-row gap-[10px] mt-[18px]">
              <Button variant="outline" className="flex-1" onPress={() => onOpenChange(false)}>
                <Text>Cancel</Text>
              </Button>
              <Button className="flex-1" onPress={apply}>
                <Text>Show {matchCount} {matchCount === 1 ? "event" : "events"}</Text>
              </Button>
            </View>
          </>
        ) : null}

        {subView === "region" ? (
          <>
            <View className="flex-row items-center gap-[10px] mb-4">
              <Pressable onPress={() => setSubView("root")} accessibilityRole="button" accessibilityLabel="Back">
                <Icon as={ChevronLeft} size={20} className="text-primary" />
              </Pressable>
              <Text className="text-[17px] font-bold text-foreground">Region</Text>
            </View>
            <RegionFilterPicker onChange={(region) => setDraft((d) => ({ ...d, region }))} />
          </>
        ) : null}

        {subView === "organizer" ? (
          <OrganizerFilterPicker
            orgs={orgs}
            selectedIds={draft.orgIds}
            onChangeSelectedIds={(orgIds) => setDraft((d) => ({ ...d, orgIds }))}
            onBack={() => setSubView("root")}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/mobile && npx jest marketplace-filter-sheet -v`
Expected: PASS — all 5 tests green.

- [ ] **Step 7: Run the full mobile suite**

Run: `cd apps/mobile && npx jest -v 2>&1 | tail -15`
Expected: all suites still PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/components/ui/dialog.tsx apps/mobile/components/MarketplaceFilterSheet.tsx apps/mobile/__tests__/marketplace-filter-sheet.test.tsx
git commit -m "feat(mobile): add MarketplaceFilterSheet (bottom-anchored Dialog restyle)"
```

---

## Task 10: Integrate everything into the Marketplace screen

**Files:**
- Modify: `apps/mobile/app/(tabs)/events.tsx`
- Modify: `apps/mobile/__tests__/marketplace-search.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–9, plus existing `useMarketplaceEvents`/`useOrgs` (`lib/events.ts`) and `useGlobalRefresh`.
- Produces: the finished screen. Nothing downstream depends on this file.

- [ ] **Step 1: Update the existing test file's mocks and write the new failing tests**

Replace `apps/mobile/__tests__/marketplace-search.test.tsx` in full:

```tsx
import { render, screen, fireEvent } from "@testing-library/react-native";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../components/EventCard", () => ({
  EventCard: ({ event, onPress }: any) => { const { Text, Pressable } = require("react-native"); return <Pressable onPress={onPress}><Text>{event.name}</Text></Pressable>; },
}));

const mockEvent: any = {
  id: "e1", org_id: "o1", name: "Highland Trail Run", place: null, region: null,
  event_date: "2026-11-14", elevation_gain_m: null, cutoff_hours: null,
  status: "open", hero_image_url: null, description: null,
  gallery: [], original_date: null, status_note: null,
  city_psgc_code: "112603", region_name: "Region XI (Davao Region)", province_name: "Davao del Sur", city_name: "City of Digos", venue: null,
  joined_count: 0, distances: [21], org_name: "Race Pace", org_color: "#159A55",
};
jest.mock("../lib/events", () => ({
  useMarketplaceEvents: () => ({ data: [mockEvent], isLoading: false, isError: false, refetch: jest.fn() }),
  useOrgs: () => ({ data: [], isLoading: false, isError: false, refetch: jest.fn() }),
}));
jest.mock("../lib/useGlobalRefresh", () => ({ useGlobalRefresh: () => ({ refreshing: false, onRefresh: jest.fn() }) }));

import Marketplace from "../app/(tabs)/events";

describe("Marketplace search", () => {
  it("matches on standardized PSGC city/province fields, not just legacy place/region", () => {
    render(<Marketplace />);
    const input = screen.getByPlaceholderText("Search by name or place");
    fireEvent.changeText(input, "Davao del Sur");
    expect(screen.getByText("Highland Trail Run")).toBeOnTheScreen();
  });

  it("hides the event when the search term matches nothing", () => {
    render(<Marketplace />);
    const input = screen.getByPlaceholderText("Search by name or place");
    fireEvent.changeText(input, "Zzzznomatch");
    expect(screen.queryByText("Highland Trail Run")).not.toBeOnTheScreen();
  });

  it("shows the date segment pills and switches the active one", () => {
    render(<Marketplace />);
    expect(screen.getByRole("radio", { name: "All", checked: true })).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("radio", { name: "This month" }));
    expect(screen.getByRole("radio", { name: "This month", checked: true })).toBeOnTheScreen();
  });

  it("hides the upcoming event and offers Clear filters when Past events is toggled on", () => {
    render(<Marketplace />);
    fireEvent.press(screen.getByText("Show"));
    expect(screen.queryByText("Highland Trail Run")).not.toBeOnTheScreen();
    expect(screen.getByText("No events match your filters.")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Clear filters"));
    expect(screen.getByText("Highland Trail Run")).toBeOnTheScreen();
  });
});
```

- [ ] **Step 2: Run the test to verify the new assertions fail**

Run: `cd apps/mobile && npx jest marketplace-search -v`
Expected: the two pre-existing tests still PASS (the screen hasn't changed yet, so search still works the old way); the two new tests FAIL (no date-segment radios or Past-events row exist yet).

- [ ] **Step 3: Write the implementation**

Replace `apps/mobile/app/(tabs)/events.tsx` in full:

```tsx
import { useMemo, useState } from "react";
import { View, SectionList, ActivityIndicator, Pressable, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { Search } from "lucide-react-native";
import { useMarketplaceEvents, useOrgs } from "../../lib/events";
import { useGlobalRefresh } from "../../lib/useGlobalRefresh";
import { EventCard } from "../../components/EventCard";
import { FeaturedCarousel } from "../../components/FeaturedCarousel";
import { MarketplaceFilterBar } from "../../components/MarketplaceFilterBar";
import { MarketplaceFilterSheet } from "../../components/MarketplaceFilterSheet";
import {
  DEFAULT_MARKETPLACE_FILTERS, filterMarketplaceEvents, pickFeaturedEvents,
  groupEventsForDisplay, countActiveFilters, type MarketplaceFilters,
} from "../../lib/marketplaceFilters";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";

function todayIsoNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Marketplace() {
  const { data, isLoading, isError, refetch } = useMarketplaceEvents();
  const { data: orgs } = useOrgs();
  const { refreshing, onRefresh } = useGlobalRefresh();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<MarketplaceFilters>(DEFAULT_MARKETPLACE_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(false);
  const todayIso = todayIsoNow();

  const allEvents = data ?? [];

  const filtered = useMemo(() => {
    const byFilters = filterMarketplaceEvents(allEvents, filters, todayIso);
    const needle = q.trim().toLowerCase();
    if (!needle) return byFilters;
    return byFilters.filter((e) =>
      [e.name, e.place, e.region, e.city_name, e.province_name, e.region_name, e.org_name].filter(Boolean).some((s) => s!.toLowerCase().includes(needle))
    );
  }, [allEvents, filters, q, todayIso]);

  const featured = useMemo(
    () => (filters.showPast ? [] : pickFeaturedEvents(filtered, todayIso)),
    [filtered, filters.showPast, todayIso]
  );
  const featuredIds = useMemo(() => new Set(featured.map((e) => e.id)), [featured]);
  const listEvents = useMemo(() => filtered.filter((e) => !featuredIds.has(e.id)), [filtered, featuredIds]);
  const sections = useMemo(() => {
    if (filters.showPast) return listEvents.length ? [{ title: null, data: listEvents }] : [];
    return groupEventsForDisplay(listEvents, filters.dateSegment, todayIso);
  }, [listEvents, filters.dateSegment, filters.showPast, todayIso]);

  function clearFilters() {
    setFilters(DEFAULT_MARKETPLACE_FILTERS);
    setQ("");
  }

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator className="text-primary" />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Button variant="ghost" onPress={() => refetch()}>
          <Text className="text-destructive">Couldn't load events. Tap to retry.</Text>
        </Button>
      </View>
    );
  }

  const hasActiveFilters = countActiveFilters(filters) > 0 || filters.dateSegment !== "all" || filters.showPast;

  return (
    <>
      <SectionList
        className="flex-1 bg-background"
        sections={sections}
        keyExtractor={(e) => e.id}
        contentContainerClassName="px-[22px] pt-2 pb-8"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View className="mb-2">
            <Text className="text-3xl font-bold tracking-[-0.5px] text-foreground">Events</Text>
            <View className="flex-row items-center gap-2 bg-muted rounded-[11px] py-3 px-[14px] mt-[14px]">
              <Icon as={Search} size={17} className="text-muted-foreground" />
              <Input
                className="flex-1 border-0 bg-transparent h-auto p-0 shadow-none text-[15px]"
                value={q}
                onChangeText={setQ}
                placeholder="Search by name or place"
                autoCapitalize="none"
                accessibilityLabel="Search events"
              />
            </View>

            <MarketplaceFilterBar
              dateSegment={filters.dateSegment}
              onDateSegmentChange={(dateSegment) => setFilters((f) => ({ ...f, dateSegment }))}
              activeFilterCount={countActiveFilters(filters)}
              onPressMoreFilters={() => setSheetOpen(true)}
            />

            {!filters.showPast && featured.length > 0 ? (
              <View className="mt-5">
                <Text className="text-[13px] font-bold uppercase tracking-[0.6px] text-muted-foreground mb-3">Coming up soon</Text>
                <FeaturedCarousel events={featured} onPressEvent={(e) => router.push(`/event/${e.id}`)} />
              </View>
            ) : null}

            <Pressable
              onPress={() => setFilters((f) => ({ ...f, showPast: !f.showPast }))}
              accessibilityRole="button"
              className="flex-row items-center justify-between mt-5"
            >
              <Text className="text-[13px] font-bold uppercase tracking-[0.6px] text-muted-foreground">Past events</Text>
              <Text className="text-[12.5px] font-semibold text-primary">{filters.showPast ? "Hide" : "Show"}</Text>
            </Pressable>
          </View>
        }
        renderSectionHeader={({ section }) =>
          section.title ? (
            <View className="flex-row items-center gap-[10px] my-3">
              <View className="flex-1 h-px bg-divider" />
              <Text className="text-[12.5px] font-bold text-muted-foreground">{section.title}</Text>
              <View className="flex-1 h-px bg-divider" />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View className="items-center pt-20">
            <View className="h-[74px] w-[74px] items-center justify-center rounded-full bg-muted">
              <Icon as={Search} size={30} className="text-muted-foreground" />
            </View>
            <Text className="text-lg font-semibold text-foreground mt-[18px]">No events found</Text>
            <Text className="text-sm text-muted-foreground mt-1.5 text-center max-w-[240px]">
              {q ? "Try a different search." : hasActiveFilters ? "No events match your filters." : "Check back soon — new races drop weekly."}
            </Text>
            {hasActiveFilters ? (
              <Pressable onPress={clearFilters} accessibilityRole="button" className="mt-4">
                <Text className="text-[14px] font-semibold text-primary">Clear filters</Text>
              </Pressable>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <EventCard event={item} onPress={() => router.push(`/event/${item.id}`)} />}
      />

      <MarketplaceFilterSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        filters={filters}
        onApply={setFilters}
        allEvents={allEvents}
        orgs={orgs ?? []}
        todayIso={todayIso}
      />
    </>
  );
}
```

- [ ] **Step 4: Run the test to verify everything passes**

Run: `cd apps/mobile && npx jest marketplace-search -v`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/\(tabs\)/events.tsx apps/mobile/__tests__/marketplace-search.test.tsx
git commit -m "feat(mobile): integrate featured carousel + filters into the Marketplace screen"
```

---

## Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire mobile test suite**

Run: `cd apps/mobile && npx jest -v 2>&1 | tail -50`
Expected: every suite passes (the pre-existing ~29 suites plus the ~8 new ones added across Tasks 1, 3, 4, 5, 7, 8, 9, plus the extended `events-hooks`/`event-card`/`marketplace-search` suites).

- [ ] **Step 2: Run the mobile typecheck**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 3: Run the full repo test suite (vitest — supabase/packages)**

Run: `cd /Users/jsonse/Documents/development/trail-ultra/.claude/worktrees/events-marketplace-redesign && pnpm test 2>&1 | tail -30`
Expected: same pre-existing 5 `supabase/tests/*` failures as the original clean-baseline check (these need a local Supabase stack and are unrelated to this feature) — nothing new failing.

- [ ] **Step 4: Manual visual check in the iOS Simulator**

Use the iOS Simulator tooling to build and launch the mobile app (dev client), navigate to the Events tab, and confirm:
- The featured carousel renders with dot pagination and swipes between events.
- Event cards show the immersive-overlay layout (status badge top-left, org avatar top-right, name/address/date/distance-pills over the image).
- The date-segment control switches between "This week/This month/Later/All" and the section headers below update accordingly.
- "More filters" opens the bottom sheet; picking a region, a distance bucket, and an organizer narrows the "Show N events" count live; Apply closes the sheet and narrows the list; Cancel discards the draft.
- "Past events" toggles to the completed/cancelled view and back.
- Pull-to-refresh still works.

If any visual issue turns up, fix it in the relevant component from Tasks 1–10 and re-run that task's test before moving on — do not patch the screen ad hoc outside those files.

- [ ] **Step 5: Final commit (if Step 4 required fixes)**

```bash
git add -A
git commit -m "fix(mobile): address simulator walkthrough findings for the marketplace redesign"
```

(Skip this step if Step 4 needed no changes.)
