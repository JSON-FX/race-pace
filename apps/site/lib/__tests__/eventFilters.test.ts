import { describe, it, expect } from "vitest";
import {
  bandOf, terrainOf, parseFilters, filtersToQuery, hasAnyFilter, toggle,
  applyFilters, provincesOf, EMPTY_FILTERS, type EventFilters,
} from "../eventFilters";
import type { EventRow } from "../events";

function ev(over: Partial<EventRow> & { id: string }): EventRow {
  return {
    org_id: "o", name: "Race", place: null, region: null,
    event_date: "2026-03-15", end_date: null, elevation_gain_m: null, cutoff_hours: null,
    status: "open", hero_image_url: null, description: null, gallery: [],
    original_date: null, status_note: null, city_psgc_code: null, region_name: null,
    province_name: null, city_name: null, venue: null, joined_count: 0, distances: [],
    ...over,
  } as EventRow;
}

describe("bandOf", () => {
  it("puts 50 in ultra — the boundary belongs to the band above", () => {
    expect(bandOf(50)).toBe("ultra");
  });
  it("puts a road marathon's 42.195 in marathon, not ultra", () => {
    expect(bandOf(42.195)).toBe("marathon");
  });
  it("puts 30 in marathon and 29.9 in half — no gap at the seam", () => {
    expect(bandOf(30)).toBe("marathon");
    expect(bandOf(29.9)).toBe("half");
  });
  it("puts 15 in half and 14.9 in short", () => {
    expect(bandOf(15)).toBe("half");
    expect(bandOf(14.9)).toBe("short");
  });
  it("buckets a nonsense negative distance rather than returning undefined", () => {
    expect(bandOf(-1)).toBe("short");
  });
});

describe("terrainOf", () => {
  it("reads trail from a profile-layout discipline", () => {
    expect(terrainOf({ discipline: "ultra" })).toBe("trail");
  });
  it("reads road from a route-layout discipline", () => {
    expect(terrainOf({ discipline: "fun_run" })).toBe("road");
  });
  it("treats an unknown discipline as trail, matching disciplineLayout's fallback", () => {
    expect(terrainOf({ discipline: "sky_running_2099" })).toBe("trail");
  });
  it("treats a missing discipline as trail", () => {
    expect(terrainOf({ discipline: null })).toBe("trail");
  });
});

describe("parseFilters", () => {
  it("reads all three axes", () => {
    expect(parseFilters({ distance: "ultra,half", terrain: "trail", province: "Bukidnon" })).toEqual({
      bands: ["ultra", "half"], terrain: ["trail"], province: "Bukidnon",
    });
  });
  it("returns empty filters for an empty query", () => {
    expect(parseFilters({})).toEqual(EMPTY_FILTERS);
  });
  it("drops unknown keys instead of yielding zero results", () => {
    expect(parseFilters({ distance: "ultra,marathonish,,short" }).bands).toEqual(["ultra", "short"]);
  });
  it("dedupes repeats", () => {
    expect(parseFilters({ terrain: "road,road" }).terrain).toEqual(["road"]);
  });
  it("takes the first value when Next hands back an array", () => {
    expect(parseFilters({ province: ["Davao", "Bukidnon"] }).province).toBe("Davao");
  });
  it("treats a blank province as absent", () => {
    expect(parseFilters({ province: "  " }).province).toBeNull();
  });
});

describe("filtersToQuery", () => {
  it("omits empty axes entirely", () => {
    expect(filtersToQuery(EMPTY_FILTERS)).toBe("");
  });
  it("round-trips through parseFilters", () => {
    const f: EventFilters = { bands: ["ultra"], terrain: ["road"], province: "Davao del Sur" };
    const q = filtersToQuery(f);
    const sp = Object.fromEntries(new URLSearchParams(q.slice(1)));
    expect(parseFilters(sp)).toEqual(f);
  });
  it("encodes a province containing a space", () => {
    expect(filtersToQuery({ ...EMPTY_FILTERS, province: "Davao del Sur" })).toContain("Davao+del+Sur");
  });
});

describe("hasAnyFilter", () => {
  it("is false for the empty set and true for any single axis", () => {
    expect(hasAnyFilter(EMPTY_FILTERS)).toBe(false);
    expect(hasAnyFilter({ ...EMPTY_FILTERS, bands: ["ultra"] })).toBe(true);
    expect(hasAnyFilter({ ...EMPTY_FILTERS, province: "Davao" })).toBe(true);
  });
});

describe("toggle", () => {
  it("adds a missing value and removes a present one", () => {
    expect(toggle(["a"], "b")).toEqual(["a", "b"]);
    expect(toggle(["a", "b"], "a")).toEqual(["b"]);
  });
  it("does not mutate its input", () => {
    const src = ["a"];
    toggle(src, "b");
    expect(src).toEqual(["a"]);
  });
});

describe("applyFilters", () => {
  const ultra = ev({ id: "1", distances: [50, 30, 15], discipline: "ultra", province_name: "Bukidnon" });
  const fun = ev({ id: "2", distances: [10, 5], discipline: "fun_run", province_name: "Misamis Oriental" });
  const road = ev({ id: "3", distances: [42], discipline: "marathon", province_name: "Davao" });
  const all = [ultra, fun, road];

  it("returns everything with no filters", () => {
    expect(applyFilters(all, EMPTY_FILTERS)).toHaveLength(3);
  });

  it("matches an event if ANY of its distances is in the band", () => {
    // The ultra also offers a 15K, so it belongs in "half" too.
    const ids = applyFilters(all, { ...EMPTY_FILTERS, bands: ["half"] }).map((e) => e.id);
    expect(ids).toEqual(["1"]);
  });

  it("ORs multiple bands together", () => {
    const ids = applyFilters(all, { ...EMPTY_FILTERS, bands: ["ultra", "short"] }).map((e) => e.id);
    expect(ids).toEqual(["1", "2"]);
  });

  it("ANDs across axes — terrain narrows the band result", () => {
    const ids = applyFilters(all, { ...EMPTY_FILTERS, bands: ["ultra", "short"], terrain: ["road"] }).map((e) => e.id);
    expect(ids).toEqual(["2"]);
  });

  it("filters by province exactly", () => {
    expect(applyFilters(all, { ...EMPTY_FILTERS, province: "Davao" }).map((e) => e.id)).toEqual(["3"]);
  });

  it("returns nothing when the combination matches no race", () => {
    expect(applyFilters(all, { ...EMPTY_FILTERS, bands: ["ultra"], province: "Davao" })).toEqual([]);
  });

  it("excludes an event with no distances from every band filter", () => {
    const tbd = ev({ id: "4", distances: [] });
    expect(applyFilters([tbd], { ...EMPTY_FILTERS, bands: ["short"] })).toEqual([]);
    expect(applyFilters([tbd], EMPTY_FILTERS)).toHaveLength(1);
  });
});

describe("provincesOf", () => {
  it("dedupes, drops nulls and sorts", () => {
    const list = [
      ev({ id: "1", province_name: "Davao" }),
      ev({ id: "2", province_name: null }),
      ev({ id: "3", province_name: "Bukidnon" }),
      ev({ id: "4", province_name: "Davao" }),
    ];
    expect(provincesOf(list)).toEqual(["Bukidnon", "Davao"]);
  });
});
