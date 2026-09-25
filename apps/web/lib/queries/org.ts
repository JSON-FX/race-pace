import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type OrgBranding = {
  id: string;
  name: string;
  description: string | null;
  home_city_psgc_code: string | null;
  home_city_name: string | null;
  home_province_name: string | null;
  home_region_name: string | null;
  logo_url: string | null;
  banner_url: string | null;
  featured_image_url: string | null;
  check_in_required_default: boolean;
};

/** Ported from the old lib/org.ts's useMyOrg query body. Wrapped in React's
 *  cache() so the (admin) layout (for the TopBar's org-name badge) and the
 *  Settings page can both call getOrg(orgId) within the same request without
 *  a second round trip — mirrors getMyRoles's caching rationale. */
export const getOrg = cache(async (orgId: string): Promise<OrgBranding> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("id,name,description,home_city_psgc_code,home_city_name,home_province_name,home_region_name,logo_url,banner_url,featured_image_url,check_in_required_default")
    .eq("id", orgId)
    .single();
  if (error) throw error;
  return data as OrgBranding;
});
