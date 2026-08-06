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

/**
 * Race Pace runs Philippine events, priced in pesos, at Philippine start lines.
 * Every date in this console is a RACE-LOCAL date, so it is formatted in one
 * fixed zone rather than the viewer's.
 *
 * Passing `undefined` (the runtime's own zone) caused a real hydration mismatch:
 * the server container runs UTC and the browser runs Asia/Manila, so a payment
 * confirmed at 17:30 UTC rendered "Aug 6" on the server and "Aug 7" on the
 * client. React discarded and re-rendered the tree, and — worse — a payment
 * record briefly displayed the wrong day.
 *
 * It also makes the console honest for a director travelling abroad: their
 * event's date should not shift because they opened the page in Singapore.
 */
const RACE_TZ = "Asia/Manila";

/** en-PH rather than the viewer's locale, so the pinned timezone above is not
 *  undone by month names and ordering that still vary per machine. */
const RACE_LOCALE = "en-PH";

export const fmtDate = (d: string): string =>
  new Date(d).toLocaleDateString(RACE_LOCALE, {
    month: "short", day: "numeric", year: "numeric", timeZone: RACE_TZ,
  });

/** Table-cell date format from the mockup ("Aug 3, 09:14") — no year (the
 *  table is always scoped to a narrow, recent window so it'd be redundant),
 *  but WITH a time, unlike `fmtDate`. Hours/minutes come from the Date
 *  object directly (not `toLocaleTimeString`) to sidestep an ICU quirk where
 *  `hour12: false` renders midnight as "24:00" instead of "00:00" in some
 *  environments.
 *
 *  Pinned to RACE_TZ for the same reason as `fmtDate` — and here the hours
 *  mattered even more: `getHours()` reads the RUNTIME's zone, so a check-in
 *  time rendered eight hours apart on server and client. */
export const fmtDateTime = (d: string): string => {
  const date = new Date(d);
  const datePart = date.toLocaleDateString(RACE_LOCALE, {
    month: "short", day: "numeric", timeZone: RACE_TZ,
  });
  // en-GB + hourCycle h23 gives a stable zero-padded "HH:MM" in the pinned zone
  // without reintroducing the "24:00" quirk that getHours() was avoiding.
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: RACE_TZ,
  });
  return `${datePart}, ${time}`;
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
