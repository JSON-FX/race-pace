import { fitRoute, routeDistanceMetres, routeGainMetres, type RoutePoint } from "@race-pace/shared";

/**
 * GPX import, browser-side.
 *
 * Uses the platform's DOMParser rather than a dependency: GPX is a small,
 * stable XML vocabulary and we need exactly three things from it — trkpt lat,
 * lon and ele. A parsing library would be more code shipped to the admin than
 * the parser it replaces.
 */

export type GpxImport = {
  points: RoutePoint[];
  /** Points before simplification, so the UI can show what was reduced. */
  originalCount: number;
  distanceMetres: number;
  gainMetres: number;
};

export class GpxError extends Error {}

export function parseGpx(xml: string): GpxImport {
  const doc = new DOMParser().parseFromString(xml, "application/xml");

  // DOMParser signals malformed XML with a <parsererror> node rather than
  // throwing, so a garbage upload would otherwise sail through as an empty
  // track and read as "no points found" — a misleading message.
  if (doc.querySelector("parsererror")) {
    throw new GpxError("That file isn't valid XML. Export it again from your GPS app.");
  }

  // Accept <trkpt> (a recorded track) or <rtept> (a planned route). Organizers
  // send both, and rejecting one of them looks like the upload is broken.
  const nodes = Array.from(doc.getElementsByTagName("trkpt"));
  const source = nodes.length > 0 ? nodes : Array.from(doc.getElementsByTagName("rtept"));

  if (source.length === 0) {
    throw new GpxError("No track points in that file. It may be a waypoint-only GPX.");
  }

  const points: RoutePoint[] = [];
  for (const node of source) {
    const lat = Number(node.getAttribute("lat"));
    const lng = Number(node.getAttribute("lon"));
    // Skip unparseable points rather than aborting the whole import — a single
    // corrupt row in a 20,000-point file should not cost the organizer the upload.
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

    const eleText = node.getElementsByTagName("ele")[0]?.textContent;
    const ele = eleText != null ? Number(eleText) : NaN;

    // GPX is lat-first; our storage (GeoJSON order) is lng-first. This swap is
    // the single place that conversion happens.
    points.push(Number.isFinite(ele) ? [lng, lat, ele] : [lng, lat]);
  }

  if (points.length < 2) {
    throw new GpxError("That file has fewer than two usable points.");
  }

  const simplified = fitRoute(points);
  return {
    points: simplified,
    originalCount: points.length,
    // Distance and gain are computed from the FULL-resolution points, not the
    // simplified ones: simplification is a drawing optimisation, and measuring
    // the reduced line would understate both figures.
    distanceMetres: Math.round(routeDistanceMetres(points)),
    gainMetres: routeGainMetres(points),
  };
}
