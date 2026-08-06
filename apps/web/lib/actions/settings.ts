"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles } from "@/lib/queries/roles";

export type SettingsState = { error?: string; success?: string };

/**
 * Who may edit: organization admins (isOrgAdmin — "admin" role, or
 * super_admin), matching Team's gate. The `organizations` table's RLS
 * policy (organizations_update_branding_org_admin, in
 * supabase/migrations/20260724130000_org_images.sql) already restricts
 * UPDATE to auth_can_admin_org(id), i.e. the same isOrgAdmin check — so an
 * editor's write is rejected by Postgres regardless of what this action
 * does. We still check explicitly here rather than relying on RLS alone:
 * a Postgres UPDATE blocked by RLS does not raise an error — it silently
 * affects zero rows — so without this check a non-admin's request would
 * come back as `{ ok: true }` / a "success" toast while nothing was
 * actually written. The explicit check turns that silent no-op into an
 * honest error message.
 */
function assertCanEditOrg(roles: Awaited<ReturnType<typeof getMyRoles>>, orgId: string): string | null {
  if (!roles?.isOrgAdmin) return "You don't have permission to update this organization.";
  if (roles.orgId !== orgId) return "You don't have permission to update this organization.";
  return null;
}

export async function updateOrgBrandingAction(
  orgId: string,
  patch: { logo_url?: string; banner_url?: string },
): Promise<{ ok: boolean; error?: string }> {
  const roles = await getMyRoles();
  const denied = assertCanEditOrg(roles, orgId);
  if (denied) return { ok: false, error: denied };

  const supabase = await createClient();
  const { error } = await supabase.from("organizations").update(patch).eq("id", orgId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true };
}

export async function updateOrgNameAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const orgId = String(formData.get("orgId") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  if (!orgId) return { error: "Missing organization." };
  if (!name) return { error: "Enter an organization name." };

  const roles = await getMyRoles();
  const denied = assertCanEditOrg(roles, orgId);
  if (denied) return { error: denied };

  const supabase = await createClient();
  const { error } = await supabase.from("organizations").update({ name }).eq("id", orgId);
  if (error) return { error: error.message };

  revalidatePath("/settings");
  return { success: "Organization name updated." };
}
