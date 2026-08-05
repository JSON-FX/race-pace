/** Dates from Postgres `date` columns arrive as "YYYY-MM-DD". A bare
 *  date-only ISO string already parses as UTC midnight per spec, so
 *  appending T00:00:00Z here is a no-op for parsing (it's the same instant
 *  either way) — it just makes that UTC interpretation explicit to the
 *  reader. The real fix for day-shift bugs is `timeZone: "UTC"` in the
 *  formatter options below: without it, toLocaleDateString renders in the
 *  host's local zone, and under a negative UTC offset that can push the
 *  displayed date back a day. */
function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function longDate(iso: string): string {
  return utcDate(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

export function shortDate(iso: string): string {
  return utcDate(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}
