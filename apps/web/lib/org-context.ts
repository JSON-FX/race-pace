import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { cache } from "react";

export const ACTIVE_ORG_COOKIE = "rp-active-org";

export type OrgOption = { orgId: string; name: string };

/**
 * Which org to open with. Pure so the rule is testable without a browser.
 *
 * `stored` is VALIDATED against the available list rather than trusted: an org
 * can be deleted, or access revoked, between sessions, and an unvalidated id
 * then pins the console to an org whose every query returns nothing.
 *
 * Callers pass `stored: null` when the account cannot switch — a remembered
 * preference is meaningless when there is no choice to remember, and it stops a
 * leftover super-admin preference moving an org admin off their own org.
 */
export function pickActiveOrg(orgIds: string[], stored: string | null): string | null {
  if (stored && orgIds.includes(stored)) return stored;
  return orgIds[0] ?? null;
}

/**
 * Cross-org switching is a super_admin capability by design
 * (docs/00-product-overview.md §8) — gated on the ROLE, not on how many
 * memberships a caller happens to hold.
 *
 * This is a UI affordance, not the security boundary. Every staff-facing policy
 * is `auth_can_admin_org(org_id)`, which the database enforces independently.
 * Hiding the switcher only stops the console offering a door the DB would slam.
 */
export const getOrgContext = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { availableOrgs: [], activeOrgId: null, isSuperAdmin: false, canSwitch: false };

  const { data: roleRows } = await supabase.from("user_roles").select("role, org_id").order("org_id");
  const rows = roleRows ?? [];
  const isSuperAdmin = rows.some((r) => r.role === "super_admin");

  const { data: orgRows } = await supabase.from("organizations").select("id,name").order("name");
  const allOrgs = orgRows ?? [];

  const managed = new Set(
    rows.filter((r) => r.org_id && (r.role === "admin" || r.role === "editor")).map((r) => r.org_id!),
  );
  const availableOrgs: OrgOption[] = (isSuperAdmin ? allOrgs : allOrgs.filter((o) => managed.has(o.id)))
    .map((o) => ({ orgId: o.id, name: o.name }));

  const canSwitch = isSuperAdmin && availableOrgs.length > 1;
  const stored = canSwitch ? (await cookies()).get(ACTIVE_ORG_COOKIE)?.value ?? null : null;

  return {
    availableOrgs,
    activeOrgId: pickActiveOrg(availableOrgs.map((o) => o.orgId), stored),
    isSuperAdmin,
    canSwitch,
  };
});

/** The shape the (admin) layout threads down to <OrgSwitcher />. Derived from
 *  getOrgContext rather than declared, so the two can never drift apart — and
 *  imported as a TYPE by client components, which erases this module (and its
 *  `next/headers` import) from their bundle. */
export type OrgContext = Awaited<ReturnType<typeof getOrgContext>>;
