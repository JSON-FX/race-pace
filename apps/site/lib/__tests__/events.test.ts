import { describe, it, expect } from "vitest";
import { mapEvent } from "../events";

const raw = {
  id: "e1",
  org_id: "a1",
  name: "Apo Sky Ultra 2026",
  event_date: "2026-11-14",
  status: "open",
  hero_image_url: null,
  gallery: null,
  categories: [
    { slots_taken: 12, distance_km: 100 },
    { slots_taken: 30, distance_km: 50 },
    { slots_taken: 5, distance_km: null },
  ],
  organizations: { name: "Race Pace", brand_color: "#159A55", logo_url: null },
};

describe("mapEvent", () => {
  it("sums slots_taken across categories into joined_count", () => {
    expect(mapEvent(raw).joined_count).toBe(47);
  });

  it("collects distances and drops null ones", () => {
    expect(mapEvent(raw).distances).toEqual([100, 50]);
  });

  it("lifts the embedded organization onto flat fields", () => {
    const e = mapEvent(raw);
    expect(e.org_name).toBe("Race Pace");
    expect(e.org_color).toBe("#159A55");
  });

  it("defaults a null gallery to an empty array", () => {
    expect(mapEvent(raw).gallery).toEqual([]);
  });

  it("survives an event with no categories", () => {
    const e = mapEvent({ ...raw, categories: [] });
    expect(e.joined_count).toBe(0);
    expect(e.distances).toEqual([]);
  });

  // organizations is absent when the query does not embed it (fetchEventsByOrg).
  it("survives a missing organizations embed", () => {
    const { organizations, ...withoutOrg } = raw;
    expect(mapEvent(withoutOrg).org_name).toBeUndefined();
  });

  it("passes discipline and schedule straight through from the row", () => {
    const e = mapEvent({ ...raw, discipline: "fun_run", schedule: [{ time: "04:30", label: "Gun start" }] });
    expect(e.discipline).toBe("fun_run");
    expect(e.schedule).toEqual([{ time: "04:30", label: "Gun start" }]);
  });
});
