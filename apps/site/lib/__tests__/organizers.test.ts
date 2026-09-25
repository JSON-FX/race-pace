import { describe, expect, it } from "vitest";
import { filterOrganizers, homeBaseOf, mapOrganizer, philippineToday, regionsOf } from "../organizers";

const org = {
  id: "org-1", slug: "ridge-river", name: "Ridge & River Collective",
  logo_url: null, banner_url: null, featured_image_url: null, description: "  Trail days in Bukidnon.  ",
  home_city_name: "Malaybalay", home_province_name: "Bukidnon", home_region_name: "Northern Mindanao",
};
const event = {
  id: "event-1", org_id: "org-1", name: "Highland Ridge Run", slug: "highland-ridge",
  event_date: "2027-03-14", hero_image_url: null, city_name: "Malaybalay", place: null,
  discipline: "trail", status: "open", registration_closes_at: null,
  categories: [
    { distance_km: 12, slots_total: 40, slots_taken: 12 },
    { distance_km: 25, slots_total: 20, slots_taken: 20 },
  ],
};

describe("Trail Atlas organizer data", () => {
  it("keeps nullable profile fields blank and derives home base from admin location", () => {
    const mapped = mapOrganizer({ ...org, description: null, home_city_name: null, home_province_name: null, home_region_name: null }, []);
    expect(mapped.description).toBeNull();
    expect(mapped.featuredImageUrl).toBeNull();
    expect(mapped.homeBase).toBeNull();
    expect(mapped.events).toEqual([]);
    expect(homeBaseOf({ homeCity: "Baguio", homeProvince: null, homeRegion: "Cordillera Administrative Region" })).toBe("Baguio");
  });

  it("keeps the featured photograph separate from the promotional cover", () => {
    const mapped = mapOrganizer({ ...org, banner_url: "https://example.test/banner.png", featured_image_url: "https://example.test/photo.png" }, []);
    expect(mapped.featuredImageUrl).toBe("https://example.test/photo.png");
    expect(mapped.bannerUrl).toBe("https://example.test/banner.png");
  });

  it("derives event counts, disciplines, and slots from the organizer's events", () => {
    const mapped = mapOrganizer(org, [event, { ...event, id: "event-other", org_id: "org-2" }]);
    expect(mapped.homeBase).toBe("Malaybalay, Bukidnon");
    expect(mapped.description).toBe("Trail days in Bukidnon.");
    expect(mapped.events).toHaveLength(1);
    expect(mapped.events[0]).toMatchObject({ slotsLeft: 28, distances: [12, 25], registrationClosed: false });
    expect(mapped.raceTypes).toEqual(["Trail run"]);
    expect(mapOrganizer(org, [], ["road", "trail"]).raceTypes).toEqual(["Road race", "Trail run"]);
  });

  it("includes organizations with no region in All and searches names, places, and races", () => {
    const northern = mapOrganizer(org, [event]);
    const unlocated = mapOrganizer({ ...org, id: "org-2", slug: "cebu-crew", name: "Cebu Crew", description: null, home_city_name: null, home_province_name: null, home_region_name: null }, []);
    expect(regionsOf([northern, unlocated])).toEqual(["Northern Mindanao"]);
    expect(filterOrganizers([northern, unlocated], "", "")).toHaveLength(2);
    expect(filterOrganizers([northern, unlocated], "Highland", "")).toEqual([northern]);
    expect(filterOrganizers([northern, unlocated], "cebu", "")).toEqual([unlocated]);
    expect(filterOrganizers([northern, unlocated], "", "Northern Mindanao")).toEqual([northern]);
  });

  it("uses the Philippine calendar date at the UTC day boundary", () => {
    expect(philippineToday(new Date("2026-09-24T17:00:00Z"))).toBe("2026-09-25");
  });
});
