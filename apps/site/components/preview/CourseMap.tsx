"use client";

import * as React from "react";
// Pinned to maplibre-gl v5, NOT v6. v6 splits its web worker into a separate
// module that Next's webpack dev server never resolves — the style and sprites
// load on the main thread, but tile fetching/parsing lives in that worker, so
// no vector tiles are ever requested and the canvas renders blank with ZERO
// console errors. v5 inlines the worker. Both export named only, no default.
import {
  Map as MlMap,
  Marker,
  AttributionControl,
  NavigationControl,
  type ErrorEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * 3D terrain course map (MapLibre GL).
 *
 * Both tile sources are KEYLESS on purpose — no account, no billing, nothing
 * to rotate before launch:
 *  - vector basemap: OpenFreeMap (OSM data, self-funded public tile server)
 *  - elevation:      AWS Open Data terrain tiles, terrarium encoding
 *
 * OSM's licence REQUIRES attribution, so the AttributionControl below is not
 * decoration and must not be removed.
 *
 * Terrain is enabled only where it means something. On a Mt Apo ultra the
 * 4,200 m of vertical IS the product, and seeing the ridgeline in 3D tells a
 * runner more than any number. On a flat city fun-run, pitching the camera
 * over featureless ground is cost with no information — so road events get a
 * plain top-down map and skip the DEM source entirely.
 *
 * maplibre-gl is ~266 KB gzipped. The parent loads this file via next/dynamic
 * with ssr:false AND only mounts it once the section nears the viewport, so a
 * runner who never scrolls to the map never downloads it.
 */
export function CourseMap({
  lat,
  lng,
  finishLat,
  finishLng,
  terrain,
  dark,
  label,
}: {
  lat: number;
  lng: number;
  finishLat: number | null;
  finishLng: number | null;
  terrain: boolean;
  dark: boolean;
  label: string;
}) {
  const holder = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<MlMap | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!holder.current || mapRef.current) return;

    // Read the OS setting directly rather than via useReducedMotion: the
    // camera choreography below is imperative, so it needs the boolean at
    // init time, not a value that re-renders React.
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const loop =
      finishLat == null ||
      finishLng == null ||
      (Math.abs(finishLat - lat) < 1e-6 && Math.abs(finishLng - lng) < 1e-6);

    const map = new MlMap({
      container: holder.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [lng, lat],
      // Reduced motion gets the destination framing immediately — the same
      // view the animation would have settled on, minus the journey.
      zoom: terrain ? (reduced ? 11.4 : 9) : 14,
      pitch: terrain ? (reduced ? 66 : 0) : 0,
      bearing: 0,
      // Default maxPitch is 60, which silently CLAMPS anything steeper —
      // asking for 66 without this yields 60 and no error. A steeper camera
      // is what makes relief read as relief rather than shading.
      maxPitch: 80,
      attributionControl: false,
      // The map is a supporting visual inside a scrolling page; grabbing the
      // wheel would trap someone mid-scroll. Drag/zoom controls stay available.
      scrollZoom: false,
    });
    mapRef.current = map;

    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");

    map.on("error", (e: ErrorEvent) => {
      // A tile host being down must not leave a blank grey box with no
      // explanation — fall back to the static card.
      console.error("[CourseMap] maplibre error", e?.error ?? e);
      setFailed(true);
    });

    map.on("load", () => {
      if (terrain) {
        map.addSource("dem", {
          type: "raster-dem",
          tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
          tileSize: 256,
          maxzoom: 13,
          // terrarium, NOT mapbox: AWS encodes elevation differently, and the
          // wrong value here renders plausible-looking but completely fictional
          // terrain rather than failing outright.
          encoding: "terrarium",
        });
        // 1.6 reads as dramatic without turning a real mountain into a spike.
        map.setTerrain({ source: "dem", exaggeration: 1.6 });

        // Hillshade off the SAME DEM. Without this the terrain is real but
        // nearly invisible: `liberty` is a flat street style, so 3D geometry
        // alone only displaces label positions. Shaded relief is what actually
        // makes a runner see the mountain. Inserted beneath the first symbol
        // layer so place names stay legible on top of the shading.
        const firstSymbol = map.getStyle().layers?.find((l) => l.type === "symbol")?.id;
        map.addLayer(
          {
            id: "hillshade",
            type: "hillshade",
            source: "dem",
            paint: {
              "hillshade-exaggeration": 0.55,
              "hillshade-shadow-color": dark ? "#04120b" : "#4a5b52",
              "hillshade-highlight-color": dark ? "#7FE0A6" : "#ffffff",
            },
          },
          firstSymbol,
        );
        map.setSky({
          "sky-color": dark ? "#0a1f16" : "#bcdcee",
          "horizon-color": dark ? "#123a29" : "#ffffff",
          "fog-color": dark ? "#06120C" : "#e8f1ec",
          "sky-horizon-blend": 0.6,
          "horizon-fog-blend": 0.5,
        });
      }

      // Markers after load so they sit on top of the terrain mesh.
      addMarker(map, lng, lat, loop ? "Start / Finish" : "Start");
      if (!loop) addMarker(map, finishLng!, finishLat!, "Finish");

      if (reduced) return;

      // The reveal: rise from a flat overview into the pitched 3D view, so the
      // terrain arriving is the thing the eye follows. Cause and effect, not
      // decoration.
      if (terrain) {
        // Wider than the marker alone needs: at z11.4 the surrounding
        // ridgelines enter frame, which is the whole point of terrain.
        map.easeTo({ zoom: 11.4, pitch: 66, bearing: -24, duration: 3400, essential: false });
      } else {
        map.easeTo({ zoom: 15, duration: 2000, essential: false });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lng, finishLat, finishLng, terrain, dark]);

  if (failed) {
    return (
      <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
        <p className="text-[14px] opacity-70">
          The map couldn&apos;t load right now — use Open in Maps for directions to {label}.
        </p>
      </div>
    );
  }

  // h-full/w-full, NOT `absolute inset-0`: maplibre's own stylesheet sets
  // `.maplibregl-map { position: relative }` on this element once the map
  // initialises, which overrides the absolute positioning — `inset-0` then
  // stretches nothing and the container collapses to height 0. A zero-height
  // container computes no covering tiles, so the style and sprites load, no
  // vector tiles are ever requested, and the canvas renders blank with no
  // error. Sizing from the parent avoids the whole interaction.
  return <div ref={holder} className="h-full w-full" aria-label={`3D map of the course at ${label}`} role="img" />;
}

function addMarker(map: MlMap, lng: number, lat: number, text: string) {
  // Built with createElement/textContent rather than innerHTML. The labels are
  // literals today, but this is exactly the function someone later passes a
  // venue name into — and organizer-supplied text reaching innerHTML is stored
  // XSS. textContent cannot execute markup, whatever it is handed.
  const el = document.createElement("div");
  el.className = "rp-marker";

  const dot = document.createElement("span");
  dot.className = "rp-marker-dot";

  const labelEl = document.createElement("span");
  labelEl.className = "rp-marker-label";
  labelEl.textContent = text;

  el.append(labelEl, dot);
  new Marker({ element: el, anchor: "bottom" }).setLngLat([lng, lat]).addTo(map);
}
