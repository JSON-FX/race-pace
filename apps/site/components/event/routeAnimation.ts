import { routeProgress, bearingDegrees, type RoutePoint } from "@race-pace/shared";

/**
 * Drives the draw-on animation for a course route.
 *
 * Kept out of the React component and free of MapLibre types so the geometry
 * decisions here are unit-testable without a WebGL context.
 *
 * The core choice: advance by DISTANCE travelled, not by point index. A GPX is
 * sampled by time, so a switchbacked climb carries far more points per
 * kilometre than a straight road. Stepping one point per frame would crawl up
 * the mountain and then rocket along the flat — the opposite of how the course
 * actually runs.
 */
export type RouteFrame = {
  /** Points from the start up to the current head, for the drawn line. */
  drawn: RoutePoint[];
  /** Exact interpolated head position, so the marker moves smoothly between
   *  samples instead of snapping from point to point. */
  head: [number, number];
  /** Direction of travel at the head, for the chase camera. */
  bearing: number;
  /** 0→1, eased. */
  t: number;
};

export function createRouteAnimator(points: RoutePoint[]) {
  const progress = routeProgress(points);

  /** Ease-in-out: the run starts and ends gently, which reads as deliberate
   *  rather than mechanical, and gives the eye time to register the start line
   *  before movement begins. */
  const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

  return function frameAt(rawT: number): RouteFrame {
    const t = ease(Math.max(0, Math.min(1, rawT)));

    // Last sample at or before t.
    let i = 0;
    while (i < progress.length - 1 && progress[i + 1]! <= t) i++;

    const a = points[i]!;
    const b = points[Math.min(i + 1, points.length - 1)]!;
    const span = (progress[Math.min(i + 1, progress.length - 1)] ?? 1) - (progress[i] ?? 0);
    // span can be 0 when two samples sit on the same spot (a runner paused at
    // an aid station); dividing by it would put the head at NaN and blank the
    // marker for the rest of the animation.
    const local = span > 0 ? Math.max(0, Math.min(1, (t - progress[i]!) / span)) : 0;

    const head: [number, number] = [
      a[0] + (b[0] - a[0]) * local,
      a[1] + (b[1] - a[1]) * local,
    ];

    return {
      drawn: [...points.slice(0, i + 1), head as RoutePoint],
      head,
      bearing: bearingDegrees(a, b),
      t,
    };
  };
}

/** How long the draw should take. Longer courses get more time, but within
 *  bounds: a 100K at real proportional speed would outlast anyone's patience,
 *  and a 5K would flicker past before it registered. */
export function drawDurationMs(distanceKm: number): number {
  return Math.round(Math.max(4000, Math.min(11000, 3500 + distanceKm * 55)));
}
