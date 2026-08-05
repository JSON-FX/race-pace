import { describe, it, expect } from "vitest";
import type { RoutePoint } from "@race-pace/shared";
import { createRouteAnimator, drawDurationMs } from "../routeAnimation";

/** A course whose first leg is 10x the second — the shape that exposes
 *  index-based animation. */
const UNEVEN: RoutePoint[] = [
  [125, 6],
  [125.1, 6],
  [125.11, 6],
];

describe("createRouteAnimator", () => {
  it("starts at the start line and ends at the finish", () => {
    const frame = createRouteAnimator(UNEVEN);
    expect(frame(0).head[0]).toBeCloseTo(125, 6);
    expect(frame(1).head[0]).toBeCloseTo(125.11, 6);
  });

  it("advances by distance, not by point index", () => {
    // At the halfway point of the ANIMATION, the head must be near the middle
    // of the COURSE (~125.055), not at the middle POINT (125.1). Stepping per
    // index would crawl a densely-sampled climb and rocket down a straight.
    const frame = createRouteAnimator(UNEVEN);
    const mid = frame(0.5);
    expect(mid.head[0]).toBeGreaterThan(125.04);
    expect(mid.head[0]).toBeLessThan(125.07);
  });

  it("interpolates between samples instead of snapping", () => {
    const frame = createRouteAnimator(UNEVEN);
    const a = frame(0.3).head[0];
    const b = frame(0.31).head[0];
    expect(b).not.toBe(a);
  });

  it("grows the drawn line monotonically", () => {
    const frame = createRouteAnimator(UNEVEN);
    const lengths = [0, 0.25, 0.5, 0.75, 1].map((t) => frame(t).drawn.length);
    for (let i = 1; i < lengths.length; i++) {
      expect(lengths[i]!).toBeGreaterThanOrEqual(lengths[i - 1]!);
    }
  });

  it("clamps out-of-range input rather than running off the end", () => {
    const frame = createRouteAnimator(UNEVEN);
    expect(frame(-5).head[0]).toBeCloseTo(125, 6);
    expect(frame(99).head[0]).toBeCloseTo(125.11, 6);
  });

  it("survives duplicate consecutive points without producing NaN", () => {
    // Two identical samples (a runner stopped at an aid station) make the
    // segment span zero; dividing by it would blank the head for the rest of
    // the animation.
    const stalled: RoutePoint[] = [
      [125, 6],
      [125.05, 6],
      [125.05, 6],
      [125.1, 6],
    ];
    const frame = createRouteAnimator(stalled);
    for (const t of [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1]) {
      const f = frame(t);
      expect(Number.isFinite(f.head[0])).toBe(true);
      expect(Number.isFinite(f.head[1])).toBe(true);
      expect(Number.isFinite(f.bearing)).toBe(true);
    }
  });

  it("reports a bearing along the direction of travel", () => {
    // Due east.
    expect(createRouteAnimator(UNEVEN)(0.5).bearing).toBeCloseTo(90, 0);
  });
});

describe("drawDurationMs", () => {
  it("gives longer courses more time, within bounds", () => {
    expect(drawDurationMs(5)).toBeLessThan(drawDurationMs(100));
  });

  it("never drags or flickers regardless of distance", () => {
    // A 5K must still be visible; a 160K must still end.
    expect(drawDurationMs(5)).toBeGreaterThanOrEqual(4000);
    expect(drawDurationMs(160)).toBeLessThanOrEqual(11000);
  });
});
