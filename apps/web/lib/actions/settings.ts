"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles } from "@/lib/queries/roles";

export type SettingsState = { error?: string; success?: string };

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Who may edit: organization admins (isOrgAdmin — "admin" role, or
 * super_admin), matching Team's gate.
 *
 * THIS CHECK IS NOT DEFENSE-IN-DEPTH — IT IS THE ONLY AUTHORIZATION
 * BOUNDARY. Do not delete it on the assumption that RLS already covers it.
 * The `organizations` table's RLS UPDATE policy
 * (organizations_update_branding_org_admin, in
 * supabase/migrations/20260724130000_org_images.sql) calls
 * auth_can_admin_org(id), and auth_can_admin_org (20260720150000_user_roles.sql)
 * returns true for role IN ('admin', 'editor') — it permits editors.
 * `isOrgAdmin` (lib/queries/roles.ts) is admin/super_admin ONLY and
 * deliberately excludes editors. These are DIFFERENT checks: verified
 * directly against local Supabase — an editor-only JWT can run
 * `update organizations set name = …` / `set logo_url = …` and Postgres
 * returns `UPDATE 1`. If this function is removed, every editor in every
 * org gains the ability to rename and rebrand that org.
 */
function assertCanEditOrg(roles: Awaited<ReturnType<typeof getMyRoles>>, orgId: string): string | null {
  if (!roles?.isOrgAdmin) return "You don't have permission to update this organization.";
  if (roles.orgId !== orgId) return "You don't have permission to update this organization.";
  return null;
}

export async function updateOrgBrandingAction(
  orgId: string,
  patch: { logo_url?: string; banner_url?: string; featured_image_url?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const roles = await getMyRoles();
  const denied = assertCanEditOrg(roles, orgId);
  if (denied) return { ok: false, error: denied };

  const supabase = await createClient();
  // .select("id") is load-bearing, not cosmetic: an UPDATE blocked by RLS
  // (rather than by the grant) does not raise an error — it silently
  // affects zero rows. Without requesting the row back, a blocked write and
  // a real one are indistinguishable from `{ error: null }` alone, and this
  // action would report success for a no-op. `assertCanEditOrg` above is
  // what actually prevents that in practice; this is the honest-response
  // check for the case it's ever wrong (see finding #2 in the Task 10
  // report — orgId/isOrgAdmin resolving to different orgs was exactly that
  // case). Never surface `error.message` (raw Postgres text) to the UI — but
  // don't discard it entirely: log it server-side (matches the
  // console.error("[tag] message", details) convention used throughout
  // supabase/functions/*) so a real failure (e.g. a grant regression) is
  // recoverable from server logs instead of only ever seen as "Something
  // went wrong" by the user.
  const { data, error } = await supabase.from("organizations").update(patch).eq("id", orgId).select("id");
  if (error) {
    console.error("[settings] organizations branding update failed", { orgId, patch, error });
    return { ok: false, error: GENERIC_ERROR };
  }
  if (!data || data.length === 0) return { ok: false, error: GENERIC_ERROR };

  revalidatePath("/settings");
  return { ok: true };
}

export async function updateOrgProfileAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const orgId = String(formData.get("orgId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const homeCityCode = String(formData.get("homeCityPsgcCode") ?? "").trim();

  if (!orgId) return { error: "Missing organization." };
  if (!name) return { error: "Enter an organization name." };
  if (description.length > 2000) return { error: "Keep the organizer description within 2,000 characters." };
  if (homeCityCode && !/^\d{9}$/.test(homeCityCode)) return { error: "Choose a valid home base." };

  const roles = await getMyRoles();
  const denied = assertCanEditOrg(roles, orgId);
  if (denied) return { error: denied };

  const supabase = await createClient();
  let homeBase = {
    home_city_psgc_code: null as string | null,
    home_city_name: null as string | null,
    home_province_name: null as string | null,
    home_region_name: null as string | null,
  };
  if (homeCityCode) {
    const { data: city, error: cityError } = await supabase.from("psgc_cities")
      .select("name,province_code,region_code").eq("code", homeCityCode).maybeSingle();
    if (cityError || !city) return { error: "Choose a valid home base." };

    const [provinceResult, regionResult] = await Promise.all([
      city.province_code
        ? supabase.from("psgc_provinces").select("name").eq("code", city.province_code).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.from("psgc_regions").select("name").eq("code", city.region_code).maybeSingle(),
    ]);
    if (provinceResult.error || regionResult.error || !regionResult.data || (city.province_code && !provinceResult.data)) {
      return { error: "Choose a valid home base." };
    }
    homeBase = {
      home_city_psgc_code: homeCityCode,
      home_city_name: city.name,
      home_province_name: provinceResult.data?.name ?? null,
      home_region_name: regionResult.data.name,
    };
  }
  // See updateOrgBrandingAction's comment: .select("id") + the empty-result
  // check are what stop this from reporting a saved profile
  // when an RLS-blocked write silently changed zero rows. Never surface
  // `error.message` (raw Postgres text) to the UI — log it server-side instead.
  const { data, error } = await supabase.from("organizations")
    .update({ name, description: description || null, ...homeBase }).eq("id", orgId).select("id");
  if (error) {
    console.error("[settings] organizations profile update failed", { orgId, error });
    return { error: GENERIC_ERROR };
  }
  if (!data || data.length === 0) return { error: GENERIC_ERROR };

  revalidatePath("/settings");
  return { success: "Organization profile updated." };
}

export async function updateOrgCheckInDefaultAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const orgId = String(formData.get("orgId") ?? "");
  const values = formData.getAll("checkInRequired");
  if (!orgId || values.length === 0 || values.some(v => v !== "true" && v !== "false")) return { error: "Choose a check-in default." };
  const roles = await getMyRoles();
  const denied = assertCanEditOrg(roles, orgId);
  if (denied) return { error: denied };

  const supabase = await createClient();
  const { data, error } = await supabase.from("organizations")
    .update({ check_in_required_default: values.includes("true") }).eq("id", orgId).select("id");
  if (error) {
    console.error("[settings] check-in default update failed", { orgId, error });
    return { error: GENERIC_ERROR };
  }
  if (!data?.length) return { error: GENERIC_ERROR };
  revalidatePath("/settings");
  revalidatePath("/events/new");
  return { success: "Default check-in setting updated for new events." };
}
