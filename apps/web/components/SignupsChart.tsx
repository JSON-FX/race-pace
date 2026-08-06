import { buildSparkPath, type SignupPoint } from "@/lib/queries/dashboard";

const W = 520;
const H = 130;

/** Short axis label ("Jul 8") from the RPC's `YYYY-MM-DD`. Parsed by hand
 *  rather than `new Date(d)` — the bare date form is parsed as UTC midnight,
 *  which renders as the PREVIOUS day for anyone west of Greenwich and would
 *  put the wrong dates under a correct line. */
function axisLabel(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Describes the series in words for the `aria-label`.
 *
 * A chart is not screen-reader readable — an unlabelled `<svg>` is announced
 * as "image" and nothing else. The label therefore has to state the actual
 * trend rather than the generic "a line chart of sign-ups", so it must be
 * derived from the data every render, never hard-coded.
 *
 * The comparison is the last 7 days against the 7 before them: "this week vs
 * last week" is the question an organizer is actually asking, and it is
 * answerable from the 30-day window without a second query.
 */
function describeTrend(points: SignupPoint[]): string {
  const total = points.reduce((sum, p) => sum + p.n, 0);
  if (points.length === 0) return "Daily sign-ups over the last 30 days: no data.";
  if (total === 0) return `Daily sign-ups over the last ${points.length} days: none.`;

  const peak = points.reduce((best, p) => (p.n > best.n ? p : best), points[0]);
  const week = points.slice(-7).reduce((sum, p) => sum + p.n, 0);
  const prior = points.slice(-14, -7).reduce((sum, p) => sum + p.n, 0);
  // Only claim a direction when there is a prior week to compare against —
  // with a short series the "previous 7 days" slice is empty, and calling an
  // empty window a zero would report every new org as trending up.
  const direction = points.length < 14
    ? ""
    : week > prior ? " Trending up from the previous week."
    : week < prior ? " Trending down from the previous week."
    : " Level with the previous week.";

  return `Daily sign-ups over the last ${points.length} days: ${total} total, `
    + `peaking at ${peak.n} on ${axisLabel(peak.d)}, ${week} in the last 7 days.${direction}`;
}

/**
 * The sign-ups sparkline (mockup: tab B, "Sign-ups over time").
 *
 * Hand-rolled SVG, not a chart library — see `buildSparkPath`'s doc comment.
 * Server component: the geometry is a pure function of the data, so there is
 * nothing to hydrate.
 */
export function SignupsChart({ points }: { points: SignupPoint[] }) {
  const { line, area } = buildSparkPath(points, W, H);
  // The end-of-series dot is read back off the path's own last command rather
  // than recomputed from the data, so it can never drift from the line it is
  // meant to sit on. buildSparkPath emits "<M|L>x y" pairs, so the final two
  // tokens are the last point, with the command letter on the x.
  const tokens = line.split(" ");
  const dotX = Number(tokens[tokens.length - 2]?.slice(1));
  const dotY = Number(tokens[tokens.length - 1]);

  // The RPC's generate_series means a normal call always returns one point per
  // day, zeros included — so an empty series is a missing read, not a quiet
  // month, and must not be drawn as a flat line at zero.
  if (points.length === 0) {
    return (
      <div className="grid h-[130px] place-items-center px-[15px] text-[13px] text-muted-foreground">
        Sign-up history is unavailable right now.
      </div>
    );
  }

  return (
    <div className="px-[15px] pb-1.5 pt-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={describeTrend(points)}
      >
        <defs>
          <linearGradient id="signups-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-primary)" stopOpacity="0.26" />
            <stop offset="1" stopColor="var(--color-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Three reference lines, as in the mockup. Unlabelled on purpose: a
            30-point daily series does not have room for a value axis at this
            height, and the figures that matter are already in the KPI row. */}
        {[32, 70, 108].map((y) => (
          <line key={y} x1="0" y1={y} x2={W} y2={y} className="stroke-divider" />
        ))}
        <path d={area} fill="url(#signups-fade)" />
        <path
          d={line}
          fill="none"
          className="stroke-primary"
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {Number.isFinite(dotX) && Number.isFinite(dotY) ? (
          <circle cx={dotX} cy={dotY} r="3.6" className="fill-primary" />
        ) : null}
      </svg>
      <div className="flex justify-between px-0.5 pt-1 text-[10px] tabular-nums text-muted-foreground">
        <span>{axisLabel(points[0].d)}</span>
        {points.length > 2 ? <span>{axisLabel(points[Math.floor(points.length / 2)].d)}</span> : null}
        <span>{axisLabel(points[points.length - 1].d)}</span>
      </div>
    </div>
  );
}
