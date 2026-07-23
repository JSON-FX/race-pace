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
