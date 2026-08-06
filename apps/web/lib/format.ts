/** Centavos to pesos. Shows decimals only when non-zero, so a clean amount
 *  reads ₱2,850 while a real platform fee reads ₱142.50. */
export function peso(centavos: number): string {
  const sign = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  const pesos = abs / 100;
  const hasCents = abs % 100 !== 0;
  return `${sign}₱${pesos.toLocaleString(undefined, {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export const fmtDate = (d: string): string =>
  new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Table-cell date format from the mockup ("Aug 3, 09:14") — no year (the
 *  table is always scoped to a narrow, recent window so it'd be redundant),
 *  but WITH a time, unlike `fmtDate`. Hours/minutes come from the Date
 *  object directly (not `toLocaleTimeString`) to sidestep an ICU quirk where
 *  `hour12: false` renders midnight as "24:00" instead of "00:00" in some
 *  environments. */
export const fmtDateTime = (d: string): string => {
  const date = new Date(d);
  const datePart = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${datePart}, ${hh}:${mm}`;
};

/** Avatar initials for the mockup's `.ava` cell. Two words -> first letters
 *  of the first two ("Maria Josefa Santos" -> "MJ", matching the mockup —
 *  note this is first+SECOND word, not first+last, for 3+-word names). One
 *  word -> its first two characters. Empty/null -> "?". */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
