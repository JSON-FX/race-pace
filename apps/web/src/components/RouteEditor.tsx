import { useRef, useState } from "react";
import { Upload, Trash2, Route as RouteIcon } from "lucide-react";
import { isValidRoute, MAX_ROUTE_POINTS, type RoutePoint } from "@race-pace/shared";
import { parseGpx, GpxError } from "../lib/gpx";
import { Button } from "./ui/button";
import { Label } from "./ui/label";

const fieldLabel = "text-[11px] font-semibold tracking-wide text-muted-foreground";

/** Course GPX import. The route drives the animated course map on the public
 *  event page; with no route the map falls back to start/finish markers. */
export function RouteEditor({
  route,
  onChange,
}: {
  route: RoutePoint[] | null;
  onChange: (route: RoutePoint[] | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      const result = parseGpx(await file.text());
      onChange(result.points);
      const km = (result.distanceMetres / 1000).toFixed(1);
      const reduced =
        result.originalCount > result.points.length
          ? ` · simplified ${result.originalCount.toLocaleString()} → ${result.points.length} points`
          : ` · ${result.points.length} points`;
      setSummary(`${km} km · ${result.gainMetres.toLocaleString()} m gain${reduced}`);
    } catch (e) {
      // A GpxError carries a message written for the organizer; anything else
      // is a bug and must not be shown as if it were their fault.
      setError(e instanceof GpxError ? e.message : "Couldn't read that file.");
      setSummary(null);
    } finally {
      setBusy(false);
      // Reset so re-picking the SAME file fires change again — otherwise a
      // failed import cannot be retried without choosing a different file.
      if (input.current) input.current.value = "";
    }
  }

  const points = isValidRoute(route) ? route.length : 0;

  return (
    <div>
      <Label className={fieldLabel}>COURSE ROUTE (GPX)</Label>

      <input
        ref={input}
        type="file"
        accept=".gpx,application/gpx+xml,application/xml,text/xml"
        className="sr-only"
        aria-label="Upload course GPX"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />

      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
          <Upload size={14} className="mr-1.5" />
          {busy ? "Reading…" : points > 0 ? "Replace GPX" : "Upload GPX"}
        </Button>

        {points > 0 ? (
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[12px] font-medium text-secondary-foreground">
              <RouteIcon size={12} />
              {points} points
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange(null);
                setSummary(null);
                setError(null);
              }}
            >
              <Trash2 size={14} className="mr-1.5" />
              Remove
            </Button>
          </>
        ) : null}
      </div>

      {summary ? <p className="mt-1.5 text-[11px] text-muted-foreground">{summary}</p> : null}
      {error ? <p className="mt-1.5 text-[11px] text-destructive">{error}</p> : null}
      {!summary && !error ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Export the course from Strava, Garmin or Gaia as .gpx. Long files are simplified to{" "}
          {MAX_ROUTE_POINTS} points for the public map — distance and climb are measured before that.
        </p>
      ) : null}
    </div>
  );
}
