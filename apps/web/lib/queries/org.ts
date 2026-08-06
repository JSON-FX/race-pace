import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type OrgBranding = { id: string; name: string; logo_url: string | null; banner_url: string | null };

/** Ported from the old lib/org.ts's useMyOrg query body. Wrapped in React's
 *  cache() so the (admin) layout (for the TopBar's org-name badge) and the
 *  Settings page can both call getOrg(orgId) within the same request without
 *  a second round trip — mirrors getMyRoles's caching rationale. */
export const getOrg = cache(async (orgId: string): Promise<OrgBranding> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("id,name,logo_url,banner_url")
    .eq("id", orgId)
    .single();
  if (error) throw error;
  return data as OrgBranding;
});
