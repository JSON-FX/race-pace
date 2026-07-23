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

/** Local calendar date as ISO "YYYY-MM-DD". Uses `new Date()` so tests can pin it
 *  with fake timers. (The Events screen has an inline copy; not refactored here.) */
export function todayIsoNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** PayMongo payment-method code -> display label. */
export function paymentMethodLabel(method: string | null | undefined): string {
  switch (method) {
    case "card": return "Card";
    case "gcash": return "GCash";
    case "paymaya": return "Maya";
    case "maya": return "Maya";
    default: return method || "—";
  }
}
