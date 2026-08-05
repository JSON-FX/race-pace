import type { RoutePoint } from "@race-pace/shared";

/**
 * Snap a segment to real paths using BRouter's public instance.
 *
 * `hiking-beta` rather than a road profile: this is a trail platform, and a
 * car/bike profile refuses to route down footpaths — the exact terrain these
 * courses run on. BRouter also returns elevation per point, so a snapped
 * segment contributes real climb to the live total instead of an estimate.
 *
 * Keyless, so there is nothing to provision or rotate. It is a community
 * service though, which is why every failure path below degrades to a straight
 * line rather than blocking the organizer: a routing outage must never stop
 * someone finishing a course they are mid-way through drawing.
 */

const BROUTER = "https://brouter.de/brouter";

export type SnapResult = {
  points: RoutePoint[];
  /** False when routing failed and the caller got a straight line instead, so
   *  the UI can say so rather than silently drawing something wrong. */
  snapped: boolean;
};

export async function snapSegment(
  from: RoutePoint,
  to: RoutePoint,
  signal?: AbortSignal,
): Promise<SnapResult> {
  const straight: SnapResult = { points: [from, to], snapped: false };

  const url =
    `${BROUTER}?lonlats=${from[0]},${from[1]}|${to[0]},${to[1]}` +
    `&profile=hiking-beta&alternativeidx=0&format=geojson`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return straight;

    const body = await res.json();
    const coords = body?.features?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return straight;

    const points: RoutePoint[] = [];
    for (const c of coords) {
      if (!Array.isArray(c) || c.length < 2) continue;
      const [lng, lat, ele] = c;
      if (typeof lng !== "number" || typeof lat !== "number") continue;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      points.push(typeof ele === "number" && Number.isFinite(ele) ? [lng, lat, ele] : [lng, lat]);
    }
    // A response that parsed but yielded nothing usable is still a failure —
    // returning one point would break the line the caller is assembling.
    return points.length >= 2 ? { points, snapped: true } : straight;
  } catch {
    // Includes AbortError (the organizer moved a point again before this
    // finished) — the caller discards aborted results anyway.
    return straight;
  }
}

/**
 * Build the full course line from the drawn waypoints.
 *
 * Segments are snapped in parallel, then stitched with the duplicate join
 * point dropped: segment N ends where segment N+1 begins, and leaving both in
 * puts a zero-length step in the middle of the route — which is exactly the
 * case that produces a NaN heading in the draw animation.
 */
export async function buildRoute(
  waypoints: RoutePoint[],
  snap: boolean,
  signal?: AbortSignal,
): Promise<{ points: RoutePoint[]; anyFailed: boolean }> {
  if (waypoints.length < 2) return { points: waypoints.slice(), anyFailed: false };

  if (!snap) return { points: waypoints.slice(), anyFailed: false };

  const segments = await Promise.all(
    waypoints.slice(0, -1).map((from, i) => snapSegment(from, waypoints[i + 1]!, signal)),
  );

  const points: RoutePoint[] = [];
  let anyFailed = false;
  segments.forEach((seg, i) => {
    if (!seg.snapped) anyFailed = true;
    points.push(...(i === 0 ? seg.points : seg.points.slice(1)));
  });

  return { points, anyFailed };
}
