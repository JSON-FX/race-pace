/** Dates from Postgres `date` columns arrive as "YYYY-MM-DD". Appending
 *  T00:00:00Z and formatting in UTC keeps the calendar day stable — parsing
 *  bare "2026-11-14" as local time renders the previous day in UTC+8. */
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
