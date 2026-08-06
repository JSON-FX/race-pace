"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Map as MlMap, Marker, NavigationControl, AttributionControl, type GeoJSONSource } from "maplibre-gl";
import { Undo2, Redo2, Trash2, MapPin, Check, X, Loader2 } from "lucide-react";
import {
  fitRoute,
  routeDistanceMetres,
  routeGainMetres,
  type RoutePoint,
} from "@race-pace/shared";
import { buildRoute } from "../lib/snap";
import { Button } from "./ui/button";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * Draw a course directly on the map.
 *
 * Two layers of data, deliberately kept apart:
 *  - WAYPOINTS: the handful of points the organizer actually clicked. This is
 *    what undo/redo and dragging operate on, and it is small.
 *  - the ROUTE: what gets saved — either the waypoints themselves (snap off)
 *    or the full path returned by the router (snap on).
 *
 * Collapsing the two would make undo unusable: after snapping, one click can
 * become 300 points, and "undo" has to remove the click, not one of the 300.
 */
export function CourseDrawEditor({
  initialRoute,
  center,
  onCancel,
  onSave,
}: {
  initialRoute: RoutePoint[] | null;
  center: [number, number];
  onCancel: () => void;
  onSave: (route: RoutePoint[]) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const abort = useRef<AbortController | null>(null);
  // Seeding must be a ONE-TIME event, not a condition on emptiness. Keyed off
  // `waypoints.length > 0` it re-fired the moment the organizer hit Clear —
  // wiping the course and instantly restoring all 39 handles, so Clear
  // appeared to do nothing.
  const seeded = useRef(false);

  const [waypoints, setWaypoints] = useState<RoutePoint[]>([]);
  const [undone, setUndone] = useState<RoutePoint[][]>([]);
  const [history, setHistory] = useState<RoutePoint[][]>([]);
  // Snap defaults ON for a NEW course and OFF when editing an existing one.
  // Re-snapping an imported GPX is destructive: the handles are a 40-point
  // sample of a 600-point course, and routing between distant handles detours
  // along whatever paths exist — an imported 62 km loop came back as 196 km in
  // testing. Editing must not silently rewrite a course the organizer already
  // verified.
  const [snap, setSnap] = useState(!initialRoute);
  const [route, setRoute] = useState<RoutePoint[]>([]);
  const [routing, setRouting] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [ready, setReady] = useState(false);

  /** Push the current waypoints onto the undo stack before mutating them. */
  const commit = useCallback((next: RoutePoint[]) => {
    setHistory((h) => [...h, waypoints]);
    setUndone([]);
    setWaypoints(next);
  }, [waypoints]);

  // ── map init ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!holder.current || mapRef.current) return;
    const map = new MlMap({
      container: holder.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center,
      zoom: 12,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new NavigationControl(), "top-right");

    map.on("load", () => {
      map.addSource("draw", { type: "geojson", data: emptyLine() });
      map.addLayer({
        id: "draw-casing",
        type: "line",
        source: "draw",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: "draw-line",
        type: "line",
        source: "draw",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#159A55", "line-width": 4 },
      });
      setReady(true);
    });

    return () => {
      abort.current?.abort();
      map.remove();
      mapRef.current = null;
    };
    // center is captured once on purpose: re-centring mid-draw would yank the
    // map out from under the organizer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seed from an existing route so "Draw on map" edits rather than restarts.
  // Only the first load: fitRoute output can be 600 points, and every one of
  // them as a draggable handle would be unusable, so we sample down to a
  // workable set of waypoints.
  useEffect(() => {
    if (!ready || !initialRoute || seeded.current) return;
    seeded.current = true;
    const handles = fitRoute(initialRoute, 40);
    setWaypoints(handles);
    const map = mapRef.current;
    if (map && handles.length > 1) {
      const lngs = handles.map((p) => p[0]);
      const lats = handles.map((p) => p[1]);
      map.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: 48, duration: 0 },
      );
    }
  }, [ready, initialRoute]);

  // ── click to add ──────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const onClick = (e: { lngLat: { lng: number; lat: number } }) => {
      commit([...waypoints, [e.lngLat.lng, e.lngLat.lat]]);
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [ready, waypoints, commit]);

  // ── waypoint markers (draggable) ───────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    markers.current.forEach((m) => m.remove());
    markers.current = waypoints.map((p, i) => {
      const el = document.createElement("div");
      el.className = i === 0 ? "rp-wp rp-wp-start" : i === waypoints.length - 1 ? "rp-wp rp-wp-end" : "rp-wp";
      const m = new Marker({ element: el, draggable: true }).setLngLat([p[0], p[1]]).addTo(map);
      m.on("dragend", () => {
        const { lng, lat } = m.getLngLat();
        const next = waypoints.slice();
        next[i] = [lng, lat];
        commit(next);
      });
      return m;
    });

    return () => {
      markers.current.forEach((m) => m.remove());
      markers.current = [];
    };
  }, [waypoints, ready, commit]);

  // ── routing ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    // Cancel any in-flight routing: dragging a point fires this repeatedly and
    // a late response would overwrite a newer one.
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;

    if (waypoints.length < 2) {
      setRoute(waypoints);
      setDegraded(false);
      return;
    }

    let cancelled = false;
    setRouting(true);
    buildRoute(waypoints, snap, controller.signal)
      .then(({ points, anyFailed }) => {
        if (cancelled || controller.signal.aborted) return;
        setRoute(points);
        setDegraded(anyFailed);
      })
      .finally(() => {
        if (!cancelled && !controller.signal.aborted) setRouting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [waypoints, snap, ready]);

  // ── paint the line ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("draw") as GeoJSONSource | undefined;
    src?.setData(route.length > 1 ? lineOf(route) : emptyLine());
  }, [route, ready]);

  const km = route.length > 1 ? routeDistanceMetres(route) / 1000 : 0;
  const gain = route.length > 1 ? routeGainMetres(route) : 0;
  const hasElevation = route.some((p) => p.length > 2);

  function undo() {
    if (history.length === 0) return;
    setUndone((u) => [...u, waypoints]);
    setWaypoints(history[history.length - 1]!);
    setHistory((h) => h.slice(0, -1));
  }
  function redo() {
    if (undone.length === 0) return;
    setHistory((h) => [...h, waypoints]);
    setWaypoints(undone[undone.length - 1]!);
    setUndone((u) => u.slice(0, -1));
  }

  // ⌘Z / ⌘⇧Z, the shortcut anyone drawing will reach for without thinking.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <span className="mr-2 text-[14px] font-semibold">Draw the course</span>

        <Button type="button" size="sm" variant="outline" onClick={undo} disabled={history.length === 0}>
          <Undo2 size={14} className="mr-1.5" /> Undo
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={redo} disabled={undone.length === 0}>
          <Redo2 size={14} className="mr-1.5" /> Redo
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => commit([])}
          disabled={waypoints.length === 0}
        >
          <Trash2 size={14} className="mr-1.5" /> Clear
        </Button>

        <label className="ml-2 inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[13px]">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
          Snap to trails
        </label>

        <div className="ml-auto flex items-center gap-4">
          <span className="text-[13px] text-muted-foreground">
            {routing ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 size={13} className="animate-spin" /> routing…
              </span>
            ) : (
              <>
                <strong className="text-foreground">{km.toFixed(1)} km</strong>
                {" · "}
                {/* Freehand segments carry no elevation, so a climb figure
                    would be a fabrication. Say so instead of printing 0. */}
                {hasElevation ? (
                  <strong className="text-foreground">{gain.toLocaleString()} m gain</strong>
                ) : (
                  <span>climb unknown (snap off)</span>
                )}
                {" · "}
                {waypoints.length} points
              </>
            )}
          </span>

          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            <X size={14} className="mr-1.5" /> Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => onSave(fitRoute(route))}
            disabled={route.length < 2 || routing}
          >
            <Check size={14} className="mr-1.5" /> Use this course
          </Button>
        </div>
      </div>

      {initialRoute ? (
        <p className="border-b border-border bg-muted px-5 py-2 text-[12.5px] text-muted-foreground">
          Editing an imported course. What you save here REPLACES it, simplified to the handles
          shown — cancel to keep the original untouched. Turning on “snap to trails” will re-route
          between handles and can change the course substantially.
        </p>
      ) : null}

      {degraded ? (
        <p className="border-b border-amber/40 bg-amber-tint px-5 py-2 text-[12.5px] text-[#7A4A00]">
          Some segments couldn&apos;t be snapped to a path and are drawn straight. That is normal on
          unmapped trail — the course still saves exactly as shown.
        </p>
      ) : null}

      <div className="relative flex-1">
        <div ref={holder} className="h-full w-full" />
        {waypoints.length === 0 ? (
          <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/75 px-4 py-2 text-[13px] text-white">
            <MapPin size={13} className="mr-1.5 inline" />
            Click the map to place the start, then keep clicking along the course
          </div>
        ) : null}
      </div>
    </div>
  );
}

function lineOf(points: RoutePoint[]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates: points.map((p) => [p[0], p[1]]) },
  };
}
function emptyLine() {
  return { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: [] } };
}
