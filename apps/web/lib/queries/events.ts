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

/**
 * Builds a `%...%` ILIKE substring pattern from a raw user search term,
 * with ONE normalization rule applied before the term reaches ANY query
 * path: PostgREST auto-rewrites a literal `*` to `%` inside `ilike`/`like`
 * values (even quoted ones — confirmed against this project: `or=(name.
 * ilike."%Dahi*Sky%")` matches, while a raw SQL `name ilike '%'||'Dahi*Sky'
 * ||'%'` does not). A raw SQL `ilike` — e.g. inside an RPC — has no such
 * rewrite. Left unhandled, the SAME search term produces two different
 * result sets depending on which transport a given reader happens to use,
 * which is exactly how a KPI-row RPC and its list query can desync (see
 * docs/superpowers/specs/2026-08-06-admin-visual-parity-spec.md, "KPI row",
 * and the V2 review that caught it).
 *
 * Fix: normalize here, once, before either transport sees the term, so
 * both consume an IDENTICAL already-wildcarded pattern —
 *   - the PostgREST/list path: `quotePostgrestValue(toIlikePattern(q))`
 *   - the RPC path: pass `toIlikePattern(q)` straight through as `p_q`,
 *     and the RPC's SQL uses `ilike p_q` directly (no extra `'%'||p_q||'%'`
 *     wrapping — the wildcards are already in the string).
 * Existing `%`/`_`/`\` in the term are escaped first (so a literal percent
 * sign a user types doesn't silently become a wildcard), THEN `*` is
 * rewritten to `%` — matching PostgREST's own alias so search behaves the
 * same as it always has for anyone used to typing `*` as a wildcard.
 * Postgres' ILIKE default escape character is `\`, so both a raw SQL
 * `ilike` and PostgREST's translated `ilike` interpret these escapes
 * identically with no extra `ESCAPE` clause needed.
 */
export function toIlikePattern(rawTerm: string): string {
  const escaped = rawTerm
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/\*/g, "%");
  return `%${escaped}%`;
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

  const trimmed = params.q.trim();
  if (trimmed) {
    // Routed through toIlikePattern (not a hand-rolled `%${q}%`) so a
    // user-typed `*`, `%` or `_` means the same thing here as it does on
    // Registrations/Payments — see that helper's doc comment.
    const term = quotePostgrestValue(toIlikePattern(trimmed));
    req = req.or(`name.ilike.${term},place.ilike.${term},city_name.ilike.${term}`);
  }

  const s = params.sort[0] ?? { id: "event_date", desc: false };
  // Secondary `.order("id")` tiebreaker, matching registrations.ts/payments.ts:
  // rows sharing the primary sort value have no guaranteed relative order
  // across two separate `.range()` calls otherwise. Events has no export route
  // today, but the invariant should hold before one is ever added.
  req = req.order(s.id, { ascending: !s.desc }).order("id", { ascending: true }).range(from, from + params.per - 1);

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
