export type AuditRow = {
  id: string;
  action: string;
  detail: Record<string, unknown>;
  actor_role: string | null;
  created_at: string;
};

/** Newest day first, entries newest-first within each day. Grouping by local calendar day
 *  keeps a single afternoon of edits under one heading instead of repeating the date on
 *  every row. Input is expected already sorted newest-first by the query. */
export function groupByDay(rows: AuditRow[]): { day: string; rows: AuditRow[] }[] {
  const buckets = new Map<string, AuditRow[]>();
  for (const r of rows) {
    const day = new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const bucket = buckets.get(day);
    if (bucket) bucket.push(r);
    else buckets.set(day, [r]);
  }
  return [...buckets.entries()].map(([day, rs]) => ({ day, rows: rs }));
}
