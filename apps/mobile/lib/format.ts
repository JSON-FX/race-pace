const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(iso: string | null | undefined): [number, number, number] | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? [y, m, d] : null;
}

/** "2026-10-18" -> "Oct 18" */
export function shortDate(iso: string | null | undefined): string {
  const p = parts(iso);
  return p ? `${MONTHS[p[1] - 1]} ${p[2]}` : (iso ?? "");
}

/** "2026-10-18" -> "Oct 18, 2026" */
export function longDate(iso: string | null | undefined): string {
  const p = parts(iso);
  return p ? `${MONTHS[p[1] - 1]} ${p[2]}, ${p[0]}` : (iso ?? "");
}

/** "21" -> "21K" — race distances are conventionally quoted rounded, in km. */
export function distanceLabel(km: number): string {
  return `${Math.round(km)}K`;
}
