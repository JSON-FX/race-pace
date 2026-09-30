"use server";
import { revalidatePath } from "next/cache";
import { discountInputSchema } from "@race-pace/shared";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
export type DiscountPassportOption = {
  id: string;
  label: string;
  email: string | null;
};
export async function createDiscounts(
  raw: unknown,
): Promise<{ error?: string; created?: number }> {
  const roles = await getMyRoles(),
    org = requireOrgId(roles);
  if (!org || (!roles?.isOrgAdmin && !roles?.isSuperAdmin))
    return { error: "Only organization admins can create discounts." };
  const parsed = discountInputSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const db = await createClient();
  const result = await db.rpc("discount_create", {
    p_org: org,
    p_input: parsed.data,
  });
  if (result.error)
    return {
      error:
        result.error.code === "23505"
          ? "That code already exists. Choose another."
          : result.error.message === "invalid_assignment"
            ? "Select one eligible Passport per special code."
            : "Could not create discounts. Check the selected scope and try again.",
    };
  revalidatePath("/discounts");
  return { created: result.data.length };
}
export async function setDiscountActive(
  id: string,
  active: boolean,
): Promise<{ error?: string }> {
  const roles = await getMyRoles(),
    org = requireOrgId(roles);
  if (!org || (!roles?.isOrgAdmin && !roles?.isSuperAdmin))
    return { error: "Only organization admins can manage discounts." };
  const db = await createClient();
  const own = await db
    .from("discount_codes")
    .select("id")
    .eq("org_id", org)
    .eq("id", id)
    .maybeSingle();
  if (!own.data) return { error: "Discount not found." };
  const result = await db.rpc("discount_set_active", {
    p_id: id,
    p_active: active,
  });
  if (result.error) return { error: "Could not update this code." };
  revalidatePath("/discounts");
  return {};
}
export async function searchDiscountPassports(
  query: string,
): Promise<DiscountPassportOption[]> {
  const roles = await getMyRoles(),
    org = requireOrgId(roles);
  if (!org || (!roles?.isOrgAdmin && !roles?.isSuperAdmin))
    throw new Error("Forbidden");
  const db = await createClient();
  const result = await db.rpc("discount_passport_options", {
    p_org: org,
    p_search: query.slice(0, 100),
  });
  if (result.error) throw new Error("Passport search is unavailable.");
  return result.data;
}
