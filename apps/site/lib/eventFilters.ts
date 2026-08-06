import { disciplineLayout } from "@race-pace/shared";
import type { EventRow } from "@/lib/events";

/**
 * Filtering for /events. Pure and free of Next primitives so the whole rule
 * set is unit-testable without a request — the page only supplies the parsed
 * search params.
 *
 * One filter object, two axes that behave differently on purpose:
 *  - `bands` and `terrain` are OR-within, AND-across. Picking "Ultra" and
 *    "21K" means "either distance", but adding "Trail" narrows both.
 *  - `province` is a single value. Two provinces at once is a query no runner
 *    has ever wanted, and it would need chips that toggle rather than select.
 */

/** Distance bands, in the order the chips render. Bounds are inclusive-low /
 *  exclusive-high, so a 50K lands in `ultra` and a 42.195 in `marathon` —
 *  every kilometre belongs to exactly one band, with no gap at the seams. */
export const DISTANCE_BANDS = [
  { key: "ultra", label: "Ultra 50K+", min: 50, max: Infinity },
  { key: "marathon", label: "Marathon", min: 30, max: 50 },
  { key: "half", label: "21K", min: 15, max: 30 },
  { key: "short", label: "10K & under", min: 0, max: 15 },
] as const;

export type BandKey = (typeof DISTANCE_BANDS)[number]["key"];
export type Terrain = "trail" | "road";

export type EventFilters = {
  bands: BandKey[];
  terrain: Terrain[];
  province: string | null;
};

export const EMPTY_FILTERS: EventFilters = { bands: [], terrain: [], province: null };

const BAND_KEYS = new Set<string>(DISTANCE_BANDS.map((b) => b.key));

/** Which band a single distance falls in. */
export function bandOf(km: number): BandKey {
  const hit = DISTANCE_BANDS.find((b) => km >= b.min && km < b.max);
  // The bands cover [0, ∞) with no holes, so this only fires for a negative
  // distance — bad data, not a real race. Bucket it with the shortest.
  return hit?.key ?? "short";
}

/** `profile` layout means the climb is the story; that IS the trail branch.
 *  Reusing disciplineLayout rather than listing disciplines again means a new
 *  discipline gets filtered correctly the moment it's added to shared. */
export function terrainOf(event: Pick<EventRow, "discipline">): Terrain {
  return disciplineLayout(event.discipline) === "profile" ? "trail" : "road";
}

/** Comma-separated repeated values ("ultra,half"), tolerant of junk: an
 *  unknown key is dropped rather than yielding zero results for a URL someone
 *  hand-edited or that outlived a rename. */
function parseList<T extends string>(raw: string | undefined, allowed: Set<string>): T[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const v = part.trim();
    if (v && allowed.has(v)) seen.add(v);
  }
  return [...seen] as T[];
}

/** Read filters out of the URL. Accepts Next's searchParams shape, where a
 *  repeated key arrives as an array. */
export function parseFilters(sp: Record<string, string | string[] | undefined>): EventFilters {
  const one = (k: string): string | undefined => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const province = one("province")?.trim();
  return {
    bands: parseList<BandKey>(one("distance"), BAND_KEYS),
    terrain: parseList<Terrain>(one("terrain"), new Set(["trail", "road"])),
    province: province || null,
  };
}

/** Back to a query string, for links the server renders and the chips push.
 *  Empty axes are omitted entirely so the unfiltered view is a bare `/events`
 *  rather than `/events?distance=&terrain=&province=`. */
export function filtersToQuery(f: EventFilters): string {
  const p = new URLSearchParams();
  if (f.bands.length) p.set("distance", f.bands.join(","));
  if (f.terrain.length) p.set("terrain", f.terrain.join(","));
  if (f.province) p.set("province", f.province);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function hasAnyFilter(f: EventFilters): boolean {
  return f.bands.length > 0 || f.terrain.length > 0 || f.province != null;
}

/** Toggle one band/terrain value, returning a new filter object. */
export function toggle<T extends string>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function applyFilters(events: EventRow[], f: EventFilters): EventRow[] {
  return events.filter((e) => {
    if (f.bands.length) {
      // An event matches a band if ANY of its distances does — a race with a
      // 50K and a 10K belongs in both "Ultra" and "10K & under", because a
      // runner filtering for either one can in fact enter this race.
      const bands = new Set(e.distances.map(bandOf));
      if (!f.bands.some((b) => bands.has(b))) return false;
    }
    if (f.terrain.length && !f.terrain.includes(terrainOf(e))) return false;
    if (f.province && e.province_name !== f.province) return false;
    return true;
  });
}

/** Provinces that actually have races, for the chip row. Sorted so the row is
 *  stable between requests rather than following the events' date order. */
export function provincesOf(events: EventRow[]): string[] {
  const set = new Set<string>();
  for (const e of events) if (e.province_name) set.add(e.province_name);
  return [...set].sort((a, b) => a.localeCompare(b));
}
