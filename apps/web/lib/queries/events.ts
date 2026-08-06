import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { TableParams } from "@/lib/table-params";

export type AdminEventRow = {
  id: string;
  name: string;
  place: string | null;
  city_name: string | null;
  province_name: string | null;
  event_date: string | null;
  end_date: string | null;
  status: string;
  original_date: string | null;
  categories: { slots_taken: number; slots_total: number }[];
};

const SELECT =
  "id,name,place,city_name,province_name,event_date,end_date,status,original_date,categories(slots_taken,slots_total)";

/**
 * PostgREST's `.or()` filter string is a structural mini-language where
 * `,`, `(`, `)` and `.` separate logic-tree nodes. A raw search term
 * containing any of those (e.g. "Dela Cruz, Ana") breaks the parse
 * (PGRST100) and 400s the whole query. Quoting the value as
 * `col.ilike."value"` makes it one opaque token; escape backslashes and
 * double quotes inside it per PostgREST's quoted-value syntax.
 */
export function quotePostgrestValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export async function listOrgEvents(
  orgId: string,
  params: TableParams,
): Promise<{ rows: AdminEventRow[]; total: number }> {
  const supabase = await createClient();
  const from = (params.page - 1) * params.per;

  let req = supabase.from("events").select(SELECT, { count: "exact" }).eq("org_id", orgId);

  const status = params.filters.status ?? "all";
  if (status !== "all") req = req.eq("status", status);

  if (params.q.trim()) {
    const term = quotePostgrestValue(`%${params.q.trim()}%`);
    req = req.or(`name.ilike.${term},place.ilike.${term},city_name.ilike.${term}`);
  }

  const s = params.sort[0] ?? { id: "event_date", desc: false };
  req = req.order(s.id, { ascending: !s.desc }).range(from, from + params.per - 1);

  const { data, error, count } = await req;
  if (error) throw error;
  return { rows: (data ?? []) as AdminEventRow[], total: count ?? 0 };
}

/** Sidebar nav-count pill for Events. head:true skips fetching rows and
 *  returns only the exact count. Cached per-request so the (admin) layout
 *  can call it without duplicating the sidebar's own query if a future page
 *  needs the same number. */
export const getOrgEventCount = cache(async (orgId: string): Promise<number> => {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);
  if (error) throw error;
  return count ?? 0;
});
