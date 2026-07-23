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
