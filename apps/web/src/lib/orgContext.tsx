import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

/**
 * Which organization the console is acting as.
 *
 * The tenancy model (docs/00-product-overview.md §8) is: editor/admin/marshal
 * grants are bound to ONE org_id; `super_admin` holds org_id null and is "the
 * only role that can see across organizations". Plan 09 files the cross-org
 * switcher under Plan 14, super_admin only.
 *
 * So switching is gated on super_admin, NOT on how many memberships you happen
 * to hold. An org admin has exactly one org and no picker; a super admin picks
 * from every organization on the platform.
 *
 * This is a UI affordance, not the security boundary. The database is the
 * boundary: every staff-facing policy is `auth_can_admin_org(org_id)`, which
 * checks user_roles for that specific org. Verified by probe — an org admin
 * reading another org's registrations gets zero rows, and a cross-org UPDATE
 * changes zero rows. Nothing here can widen that; hiding the switcher only
 * stops the console from offering a door the DB would slam anyway.
 *
 * Everything downstream is keyed by orgId (useOrgEvents, usePayments,
 * useRegistrations, useMyOrg), so a switch refetches through React Query's key
 * change alone — no manual invalidation to keep in sync.
 */

export type OrgOption = { orgId: string; name: string; role: string | null };

export type OrgContextValue = {
  /** Orgs this account may act as: its own for staff, all of them for a
   *  super admin. Sorted by name — this is what the picker renders. */
  availableOrgs: OrgOption[];
  activeOrgId: string | null;
  /** Role held in the ACTIVE org. "super_admin" is platform-wide, so it holds
   *  for whichever org is selected. */
  activeRole: string | null;
  isSuperAdmin: boolean;
  /** Only a super admin with more than one org gets a picker. */
  canSwitch: boolean;
  setActiveOrg: (orgId: string) => void;
  isLoading: boolean;
};

const Ctx = createContext<OrgContextValue | undefined>(undefined);

export const ACTIVE_ORG_KEY = "rp-active-org";

/**
 * Which org to open with. Pure so the rule is testable without a browser.
 *
 * `stored` is VALIDATED against the available list rather than trusted. An org
 * can be deleted, or access revoked, between sessions — and an unvalidated id
 * then pins the console to an org whose every query returns nothing, which
 * reads as "the app is broken" rather than "you no longer have that org".
 *
 * Callers pass `stored: null` when the account cannot switch: a remembered
 * preference is meaningless when there is no choice to remember.
 */
export function pickActiveOrg(orgIds: string[], stored: string | null): string | null {
  if (stored && orgIds.includes(stored)) return stored;
  return orgIds[0] ?? null;
}

/** Admin and editor operate the console. `marshal` is race-day check-in only
 *  and `user`/`claiming` are not staff at all — none may act as the org here. */
const MANAGING_ROLES = new Set(["admin", "editor"]);

function readStored(): string | null {
  try {
    return localStorage.getItem(ACTIVE_ORG_KEY);
  } catch {
    // Private mode / disabled storage: fall back to the default rather than
    // taking the console down over a preference.
    return null;
  }
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const uid = session?.user.id;

  const rolesQuery = useQuery({
    queryKey: ["my-roles", uid],
    enabled: !!uid,
    queryFn: async () => {
      // `user_roles_read_own` restricts this to the caller's own rows.
      const { data, error } = await supabase.from("user_roles").select("role, org_id").order("org_id");
      if (error) throw error;
      return (data ?? []) as { role: string; org_id: string | null }[];
    },
  });

  const rows = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);
  const isSuperAdmin = rows.some((r) => r.role === "super_admin");

  // Names for the label, and the full list a super admin picks from. `is_active`
  // filtering is the `orgs_read_active` policy's job, not ours.
  const orgsQuery = useQuery({
    queryKey: ["orgs-for-switcher", uid],
    enabled: !!uid && !rolesQuery.isLoading,
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const availableOrgs = useMemo<OrgOption[]>(() => {
    const allOrgs = orgsQuery.data ?? [];
    const roleFor = new Map<string, string>();
    for (const r of rows) {
      if (r.org_id && MANAGING_ROLES.has(r.role) && !roleFor.has(r.org_id)) roleFor.set(r.org_id, r.role);
    }
    const source = isSuperAdmin ? allOrgs : allOrgs.filter((o) => roleFor.has(o.id));
    return source.map((o) => ({
      orgId: o.id,
      name: o.name,
      role: isSuperAdmin ? "super_admin" : roleFor.get(o.id) ?? null,
    }));
  }, [orgsQuery.data, rows, isSuperAdmin]);

  const canSwitch = isSuperAdmin && availableOrgs.length > 1;

  const [selected, setSelected] = useState<string | null>(null);

  const ids = useMemo(() => availableOrgs.map((o) => o.orgId), [availableOrgs]);
  const isLoading = rolesQuery.isLoading || orgsQuery.isLoading;

  // Re-resolve when the list changes: on first load, and again if the selected
  // org disappears from under us.
  useEffect(() => {
    if (isLoading) return;
    setSelected((prev) => pickActiveOrg(ids, canSwitch ? prev ?? readStored() : null));
  }, [ids, canSwitch, isLoading]);

  const setActiveOrg = useCallback((orgId: string) => {
    setSelected(orgId);
    try {
      localStorage.setItem(ACTIVE_ORG_KEY, orgId);
    } catch {
      // The preference just won't survive a reload; the switch still works.
    }
  }, []);

  const value = useMemo<OrgContextValue>(
    () => ({
      availableOrgs,
      activeOrgId: selected,
      activeRole: isSuperAdmin
        ? "super_admin"
        : availableOrgs.find((o) => o.orgId === selected)?.role ?? null,
      isSuperAdmin,
      canSwitch,
      setActiveOrg,
      isLoading,
    }),
    [availableOrgs, selected, isSuperAdmin, canSwitch, setActiveOrg, isLoading],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOrgContext(): OrgContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOrgContext must be used inside <OrgProvider>");
  return v;
}
