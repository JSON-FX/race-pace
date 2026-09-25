import { describe, it, expect, vi } from "vitest";
import { fetchEvent, mapEvent } from "../events";

const raw = {
  id: "e1",
  org_id: "a1",
  name: "Apo Sky Ultra 2026",
  slug: "apo-sky-ultra-2026",
  event_date: "2026-11-14",
  status: "open",
  hero_image_url: null,
  gallery: null,
  categories: [
    { slots_total: 120, slots_taken: 12, distance_km: 100 },
    { slots_total: 30, slots_taken: 30, distance_km: 50 },
    { slots_total: 20, slots_taken: 5, distance_km: null },
  ],
  organizations: { name: "Race Pace", brand_color: "#159A55", logo_url: null },
};

describe("mapEvent", () => {
  it("sums slots_taken across categories into joined_count", () => {
    expect(mapEvent(raw).joined_count).toBe(47);
  });

  it("sums nonnegative remaining slots across categories", () => {
    expect(mapEvent(raw).slots_left).toBe(123);
    expect(mapEvent({ ...raw, categories: [{ slots_total: 10, slots_taken: 12, distance_km: 5 }] }).slots_left).toBe(0);
  });

  it("does not claim availability without capacity data", () => {
    expect(mapEvent({ ...raw, categories: [] }).slots_left).toBeNull();
    expect(mapEvent({ ...raw, categories: [{ slots_taken: 2, distance_km: 5 }] }).slots_left).toBeNull();
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

describe("fetchEvent", () => {
  function db() {
    const result = { data: raw, error: null };
    const query: Record<string, unknown> = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.maybeSingle = vi.fn(() => Promise.resolve(result));
    return { client: { from: vi.fn(() => query) }, query };
  }

  it("looks UUID route tokens up by id", async () => {
    const mock = db();
    await fetchEvent(mock.client as never, "3f29e7df-fe90-44a6-bfa4-219ffeaad816");
    expect(mock.query.eq).toHaveBeenCalledWith("id", "3f29e7df-fe90-44a6-bfa4-219ffeaad816");
  });

  it("looks readable route tokens up by slug", async () => {
    const mock = db();
    await fetchEvent(mock.client as never, "yalabyalam-backyard-ultra");
    expect(mock.query.eq).toHaveBeenCalledWith("slug", "yalabyalam-backyard-ultra");
  });
});
