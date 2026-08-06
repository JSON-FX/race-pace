"use server";

import { createClient } from "@/lib/supabase/server";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { quotePostgrestValue } from "@/lib/queries/events";

export type EventSearchResult = { id: string; name: string };

/**
 * Server-side search for the ⌘K command palette's "jump to an event" group.
 * A client component MUST NOT query Supabase directly for this — that would
 * mean either shipping the org id to the browser to filter by (spoofable)
 * or running an unscoped query across every org. Instead the org is
 * resolved here, server-side, from the caller's own session — never trusted
 * from the client — exactly like every other org-scoped query in this app.
 *
 * Returns [] for an unauthenticated caller, a caller with no resolvable org
 * (see requireOrgId), or a blank search term — the palette treats all three
 * as "nothing to show" rather than surfacing an error.
 */
export async function searchEvents(term: string): Promise<EventSearchResult[]> {
  const trimmed = term.trim();
  if (!trimmed) return [];

  const roles = await getMyRoles();
  const orgId = requireOrgId(roles);
  if (!orgId) return [];

  const supabase = await createClient();
  // .or() is PostgREST's structural mini-language — `,` `.` `(` `)` are
  // syntax, so an unquoted term like "Dela Cruz, Ana" breaks the parse and
  // 400s the whole query. quotePostgrestValue (lib/queries/events.ts) wraps
  // the term as one opaque quoted token, same as listOrgEvents's own
  // name/place/city search.
  const quoted = quotePostgrestValue(`%${trimmed}%`);
  const { data, error } = await supabase
    .from("events")
    .select("id,name")
    .eq("org_id", orgId)
    .or(`name.ilike.${quoted}`)
    .order("event_date", { ascending: false })
    .limit(10);

  if (error) throw error;
  return (data ?? []) as EventSearchResult[];
}
