import { describe, it, expect } from "vitest";
import {
  haversineMetres,
  routeDistanceMetres,
  routeGainMetres,
  simplifyRoute,
  fitRoute,
  routeProgress,
  bearingDegrees,
  routeBounds,
  isValidRoute,
  MAX_ROUTE_POINTS,
  type RoutePoint,
} from "../route";

describe("haversineMetres", () => {
  it("measures a known distance", () => {
    // One degree of latitude is ~111.2 km anywhere on the globe.
    const d = haversineMetres([125, 6], [125, 7]);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it("is zero for identical points", () => {
    expect(haversineMetres([125.2794, 6.7719], [125.2794, 6.7719])).toBe(0);
  });
});

describe("routeGainMetres", () => {
  it("sums genuine climbs", () => {
    const pts: RoutePoint[] = [
      [125, 6, 100],
      [125.001, 6, 200],
      [125.002, 6, 150],
      [125.003, 6, 400],
    ];
    // 100→200 = +100, dip to 150, then 150→400 = +250. Total 350.
    expect(routeGainMetres(pts)).toBe(350);
  });

  it("ignores GPS elevation jitter below the threshold", () => {
    // A dead-flat course recorded by a noisy watch. Summing every positive
    // delta naively would report ~12 m of climb on flat ground.
    const pts: RoutePoint[] = [
      [125, 6, 100],
      [125.001, 6, 102],
      [125.002, 6, 99],
      [125.003, 6, 103],
      [125.004, 6, 100],
      [125.005, 6, 101],
    ];
    expect(routeGainMetres(pts)).toBe(0);
  });

  it("returns 0 when no point carries elevation", () => {
    expect(routeGainMetres([[125, 6], [125.01, 6.01]])).toBe(0);
  });
});

describe("simplifyRoute", () => {
  it("drops collinear points but keeps the endpoints", () => {
    const straight: RoutePoint[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ];
    expect(simplifyRoute(straight, 0.0001)).toEqual([
      [0, 0],
      [3, 0],
    ]);
  });

  it("keeps a genuine corner", () => {
    const corner: RoutePoint[] = [
      [0, 0],
      [1, 1],
      [2, 0],
    ];
    expect(simplifyRoute(corner, 0.1)).toHaveLength(3);
  });

  it("survives a very large route without blowing the stack", () => {
    // Recursive RDP overflows here; the iterative implementation must not.
    const huge: RoutePoint[] = Array.from({ length: 60_000 }, (_, i) => [i * 1e-5, Math.sin(i / 40) * 1e-3]);
    expect(() => simplifyRoute(huge, 1e-6)).not.toThrow();
  });
});

describe("fitRoute", () => {
  it("returns short routes untouched", () => {
    const pts: RoutePoint[] = [
      [0, 0],
      [1, 1],
    ];
    expect(fitRoute(pts)).toEqual(pts);
  });

  it("caps a dense trail GPX at the point budget", () => {
    // 20,000 points is a routine 3-hour trail recording.
    const dense: RoutePoint[] = Array.from({ length: 20_000 }, (_, i) => [
      125 + i * 1e-5,
      6 + Math.sin(i / 300) * 0.02,
    ]);
    const fitted = fitRoute(dense);
    expect(fitted.length).toBeLessThanOrEqual(MAX_ROUTE_POINTS);
    expect(fitted.length).toBeGreaterThan(2);
  });

  it("keeps the start and finish exactly", () => {
    const dense: RoutePoint[] = Array.from({ length: 5_000 }, (_, i) => [
      125 + i * 1e-5,
      6 + Math.cos(i / 200) * 0.01,
    ]);
    const fitted = fitRoute(dense);
    expect(fitted[0]).toEqual(dense[0]);
    expect(fitted[fitted.length - 1]).toEqual(dense[dense.length - 1]);
  });

  it("still respects the cap when every point is near-duplicate", () => {
    // Degenerate input where simplification cannot help — the even-sampling
    // fallback must engage rather than returning thousands of points.
    const stuck: RoutePoint[] = Array.from({ length: 5_000 }, () => [125, 6]);
    expect(fitRoute(stuck).length).toBeLessThanOrEqual(MAX_ROUTE_POINTS);
  });
});

describe("routeProgress", () => {
  it("runs 0→1 and is proportional to DISTANCE, not point index", () => {
    // Three points where the first leg is 10x the second. A naive index-based
    // progress would report 0.5 at the middle point; distance-based must not.
    const pts: RoutePoint[] = [
      [125, 6],
      [125.1, 6],
      [125.11, 6],
    ];
    const p = routeProgress(pts);
    expect(p[0]).toBe(0);
    expect(p[2]).toBeCloseTo(1, 6);
    expect(p[1]).toBeGreaterThan(0.85);
  });

  it("does not divide by zero on a zero-length route", () => {
    expect(routeProgress([[125, 6], [125, 6]])).toEqual([0, 0]);
  });
});

describe("bearingDegrees", () => {
  it("points north and east correctly", () => {
    expect(bearingDegrees([125, 6], [125, 7])).toBeCloseTo(0, 1);
    expect(bearingDegrees([125, 6], [126, 6])).toBeCloseTo(90, 0);
  });
});

describe("routeBounds", () => {
  it("returns west, south, east, north", () => {
    expect(routeBounds([[125, 6], [126, 7], [124.5, 6.5]])).toEqual([124.5, 6, 126, 7]);
  });

  it("returns null for an empty route", () => {
    expect(routeBounds([])).toBeNull();
  });
});

describe("isValidRoute", () => {
  it("accepts a normal route with and without elevation", () => {
    expect(isValidRoute([[125, 6], [125.1, 6.1]])).toBe(true);
    expect(isValidRoute([[125, 6, 900], [125.1, 6.1, 1200]])).toBe(true);
  });

  it("rejects transposed coordinates that fall outside valid ranges", () => {
    // [lat, lng] instead of [lng, lat] — 125 is not a valid latitude.
    expect(isValidRoute([[6, 125], [6.1, 125.1]])).toBe(false);
  });

  it("rejects junk the jsonb column would happily store", () => {
    expect(isValidRoute(null)).toBe(false);
    expect(isValidRoute([])).toBe(false);
    expect(isValidRoute([[125, 6]])).toBe(false); // a single point is not a line
    expect(isValidRoute([["125", "6"]])).toBe(false);
    expect(isValidRoute([[125, 6], [NaN, 6]])).toBe(false);
  });
});
