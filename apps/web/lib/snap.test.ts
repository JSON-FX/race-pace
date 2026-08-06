import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RoutePoint } from "@race-pace/shared";
import { snapSegment, buildRoute } from "./snap";

const A: RoutePoint = [124.8497, 8.2839];
const B: RoutePoint = [124.86, 8.25];
const C: RoutePoint = [124.87, 8.24];

function geojson(coords: number[][]) {
  return {
    ok: true,
    json: async () => ({ features: [{ geometry: { type: "LineString", coordinates: coords } }] }),
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("snapSegment", () => {
  it("returns the routed line with elevation", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      geojson([
        [124.8497, 8.2839, 800],
        [124.855, 8.27, 850],
        [124.86, 8.25, 900],
      ]),
    );

    const r = await snapSegment(A, B);
    expect(r.snapped).toBe(true);
    expect(r.points).toHaveLength(3);
    expect(r.points[1]).toEqual([124.855, 8.27, 850]);
  });

  it("falls back to a straight line when routing fails", async () => {
    // A routing outage must never block someone mid-draw.
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });

    const r = await snapSegment(A, B);
    expect(r.snapped).toBe(false);
    expect(r.points).toEqual([A, B]);
  });

  it("falls back when fetch throws (offline, aborted)", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));

    const r = await snapSegment(A, B);
    expect(r.snapped).toBe(false);
    expect(r.points).toEqual([A, B]);
  });

  it("falls back when the response parses but has no usable geometry", async () => {
    // A 200 with junk inside would otherwise yield a 1-point 'line'.
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(geojson([[124.8497, 8.2839]]));

    const r = await snapSegment(A, B);
    expect(r.snapped).toBe(false);
    expect(r.points).toEqual([A, B]);
  });

  it("requests a hiking profile, not a road one", async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(geojson([[124.8497, 8.2839, 800], [124.86, 8.25, 900]]));

    await snapSegment(A, B);
    // A car/bike profile refuses footpaths — the terrain these courses run on.
    expect(String(f.mock.calls[0]![0])).toContain("profile=hiking-beta");
  });
});

describe("buildRoute", () => {
  it("returns the waypoints untouched when snapping is off", async () => {
    const r = await buildRoute([A, B, C], false);
    expect(r.points).toEqual([A, B, C]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stitches segments without duplicating the join point", async () => {
    // Segment 1 ends at B and segment 2 begins at B. Keeping both puts a
    // zero-length step mid-route — the exact case that yields a NaN heading in
    // the draw animation.
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(geojson([[124.8497, 8.2839, 800], [124.855, 8.27, 850], [124.86, 8.25, 900]]))
     .mockResolvedValueOnce(geojson([[124.86, 8.25, 900], [124.865, 8.245, 910], [124.87, 8.24, 920]]));

    const r = await buildRoute([A, B, C], true);

    expect(r.points).toHaveLength(5);
    const joins = r.points.filter((p) => p[0] === 124.86 && p[1] === 8.25);
    expect(joins).toHaveLength(1);
  });

  it("reports when any segment fell back, so the UI can say so", async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(geojson([[124.8497, 8.2839, 800], [124.86, 8.25, 900]]))
     .mockResolvedValueOnce({ ok: false });

    const r = await buildRoute([A, B, C], true);
    expect(r.anyFailed).toBe(true);
    // Still returns a usable line rather than nothing.
    expect(r.points.length).toBeGreaterThanOrEqual(3);
  });

  it("does not call the router for a single waypoint", async () => {
    const r = await buildRoute([A], true);
    expect(r.points).toEqual([A]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
