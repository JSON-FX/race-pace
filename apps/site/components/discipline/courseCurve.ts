/**
 * Deterministic decorative elevation curve for ElevationProfile.tsx.
 *
 * The DB has no per-metre course geometry (categories carry a single total
 * `elevation_gain_m`, not a polyline) — so this is honestly a *shape*, not a
 * survey. It stands in for "the climb" the same way TopoPattern stands in
 * for a missing hero photo. Checkpoints are plotted along it using the only
 * real signal we do have — each category's distance relative to the
 * longest — so the marker ORDER and SPACING are real even though the curve
 * itself is illustrative.
 */
export function courseHeight(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const ripple = 0.08 * Math.sin(clamped * Math.PI * 3.1) - 0.05 * Math.sin(clamped * Math.PI * 5.3 + 1);
  const height = 0.06 + 0.9 * Math.pow(clamped, 0.85) + ripple * (1 - clamped * 0.3);
  return Math.min(1, Math.max(0, height));
}

export const PROFILE_VIEW_WIDTH = 1000;
export const PROFILE_VIEW_HEIGHT = 320;
const BASELINE_Y = 292;
const PEAK_Y = 34;
const PAD_X = 16;

export function profilePoint(t: number): { x: number; y: number } {
  const clamped = Math.min(1, Math.max(0, t));
  return {
    x: PAD_X + clamped * (PROFILE_VIEW_WIDTH - PAD_X * 2),
    y: BASELINE_Y - courseHeight(clamped) * (BASELINE_Y - PEAK_Y),
  };
}

/** A smooth-enough polyline `d` attribute — dense sampling reads as a curve
 *  at this scale without needing real bezier fitting. */
export function profilePath(samples = 64): string {
  const pts = Array.from({ length: samples + 1 }, (_, i) => profilePoint(i / samples));
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

export function profileFillPath(samples = 64): string {
  const line = profilePath(samples);
  const last = profilePoint(1);
  const first = profilePoint(0);
  return `${line} L${last.x.toFixed(1)},${BASELINE_Y + 8} L${first.x.toFixed(1)},${BASELINE_Y + 8} Z`;
}
