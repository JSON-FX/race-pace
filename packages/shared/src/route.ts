/**
 * Course-route geometry, shared by the admin (which imports GPX) and the site
 * (which draws it). Pure functions only — no DOM, no fetch — so both apps and
 * the tests agree on what a route's distance and climb actually are.
 *
 * Storage shape is [lng, lat, elevation?] to match GeoJSON's coordinate order.
 * That order is a classic source of transposed-coordinate bugs, so it is
 * fixed here once: GeoJSON is lng-first, GPX is lat-first, and the importer is
 * responsible for the swap.
 */

/** A single course point: [lng, lat] or [lng, lat, elevation in metres]. */
export type RoutePoint = [number, number] | [number, number, number];

export const MAX_ROUTE_POINTS = 600;

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two [lng, lat] points. */
export function haversineMetres(a: RoutePoint, b: RoutePoint): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
}

/** Total course length in metres. */
export function routeDistanceMetres(points: RoutePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineMetres(points[i - 1]!, points[i]!);
  return total;
}

/**
 * Cumulative ascent in metres.
 *
 * `threshold` exists because consumer GPS elevation is noisy by several metres:
 * summing every positive delta turns a flat road into hundreds of metres of
 * phantom climb. Only rises of at least `threshold` from the last confirmed low
 * point count, which is the same hysteresis approach watch software uses.
 */
export function routeGainMetres(points: RoutePoint[], threshold = 5): number {
  let gain = 0;
  let reference: number | null = null;

  for (const p of points) {
    const ele = p[2];
    if (ele == null) continue;
    if (reference == null) {
      reference = ele;
      continue;
    }
    if (ele > reference + threshold) {
      gain += ele - reference;
      reference = ele;
    } else if (ele < reference) {
      // Descending: track the new low so the next climb is measured from it.
      reference = ele;
    }
  }
  return Math.round(gain);
}

/** Perpendicular distance from `p` to the segment `a`–`b`, in degrees-space.
 *  Good enough for simplification: at course scale the projection error is far
 *  below the tolerance being applied. */
function perpendicularDistance(p: RoutePoint, a: RoutePoint, b: RoutePoint): number {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Ramer–Douglas–Peucker. Iterative, not recursive: a 20,000-point GPX
 *  recursing per segment can blow the stack, and blowing the stack in the
 *  admin's import path would lose the organizer's upload. */
export function simplifyRoute(points: RoutePoint[], tolerance: number): RoutePoint[] {
  if (points.length <= 2 || tolerance <= 0) return points.slice();

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(points[i]!, points[start]!, points[end]!);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index !== -1 && maxDist > tolerance) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }

  return points.filter((_, i) => keep[i] === 1);
}

/**
 * Reduce a route to at most `max` points by raising the tolerance until it
 * fits. A 3-hour trail GPX is routinely 20,000+ points; sending that to every
 * visitor's browser would cost more than the map itself, and no one can see
 * the difference at screen scale.
 *
 * Binary search rather than a fixed tolerance: the right value depends
 * entirely on how twisty the course is, and a constant that suits a road loop
 * mangles a switchbacked climb.
 */
export function fitRoute(points: RoutePoint[], max = MAX_ROUTE_POINTS): RoutePoint[] {
  if (points.length <= max) return points.slice();

  let lo = 0;
  let hi = 0.01; // ~1 km in degrees — comfortably coarse for any course
  let best = simplifyRoute(points, hi);

  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const candidate = simplifyRoute(points, mid);
    if (candidate.length > max) {
      lo = mid;
    } else {
      best = candidate;
      hi = mid;
    }
  }
  // Guard: if even the coarsest tolerance overshoots (a course of near-
  // duplicate points), fall back to even sampling so we never return more
  // than `max`.
  if (best.length > max) {
    const step = Math.ceil(points.length / max);
    best = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  }
  return best;
}

/** Cumulative distance at each point, normalised 0→1. Drives the draw-on
 *  animation so it advances at a constant SPEED rather than a constant number
 *  of points per frame — a densely-sampled switchback would otherwise crawl
 *  while a straight road section flew past. */
export function routeProgress(points: RoutePoint[]): number[] {
  if (points.length === 0) return [];
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1]! + haversineMetres(points[i - 1]!, points[i]!));
  }
  const total = cumulative[cumulative.length - 1]!;
  if (total === 0) return cumulative.map(() => 0);
  return cumulative.map((d) => d / total);
}

/** Bearing in degrees from `a` to `b`, for pointing the flythrough camera
 *  along the direction of travel. */
export function bearingDegrees(a: RoutePoint, b: RoutePoint): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/** Bounding box as [west, south, east, north], for framing the whole course. */
export function routeBounds(points: RoutePoint[]): [number, number, number, number] | null {
  if (points.length === 0) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lng, lat] of points) {
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return [w, s, e, n];
}

/** Validates anything claiming to be a stored route. Applied on read as well
 *  as write: the column is jsonb, so nothing at the database level stops a bad
 *  row, and a malformed point reaching the map throws inside the render loop. */
export function isValidRoute(value: unknown): value is RoutePoint[] {
  if (!Array.isArray(value) || value.length < 2) return false;
  return value.every(
    (p) =>
      Array.isArray(p) &&
      p.length >= 2 &&
      typeof p[0] === "number" && Number.isFinite(p[0]) && p[0] >= -180 && p[0] <= 180 &&
      typeof p[1] === "number" && Number.isFinite(p[1]) && p[1] >= -90 && p[1] <= 90 &&
      (p[2] == null || (typeof p[2] === "number" && Number.isFinite(p[2]))),
  );
}
