import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

/**
 * Which organization the console is currently acting as.
 *
 * Before this, useMyRoles() took `rows.find(r => r.role === 'admin' || 'editor')`
 * — the FIRST admin row — and there was no way to reach any other. With one org
 * that was invisible; with two, half the data was simply unreachable.
 *
 * Everything downstream is already keyed by orgId (useOrgEvents, usePayments,
 * useRegistrations…), so switching orgs invalidates and refetches through
 * React Query's key change alone. There is deliberately no manual cache
 * clearing here — that would be a second mechanism to keep in sync.
 */

export type Membership = { orgId: string; role: string };

export type OrgContextValue = {
  /** Orgs this user can administer, ordered deterministically by id. */
  memberships: Membership[];
  activeOrgId: string | null;
  /** Role held in the ACTIVE org — not "any role anywhere". */
  activeRole: string | null;
  isSuperAdmin: boolean;
  setActiveOrg: (orgId: string) => void;
  isLoading: boolean;
};

const Ctx = createContext<OrgContextValue | undefined>(undefined);

export const ACTIVE_ORG_KEY = "rp-active-org";

/**
 * Which org to open with. Pure so the rule is testable without a browser.
 *
 * The stored id is VALIDATED against current memberships rather than trusted.
 * An org can be deleted, or your access to it revoked, between sessions — and
 * an unvalidated stored id then pins the console to an org whose every query
 * returns nothing, which reads as "the app is broken" rather than "you were
 * removed from that org".
 */
export function pickActiveOrg(memberships: Membership[], stored: string | null): string | null {
  if (stored && memberships.some((m) => m.orgId === stored)) return stored;
  return memberships[0]?.orgId ?? null;
}

/** Admin and editor can both operate the console; other roles (marshal,
 *  claiming) are not org-management roles and must not appear in the picker. */
const MANAGING_ROLES = new Set(["admin", "editor"]);

function readStored(): string | null {
  try {
    return localStorage.getItem(ACTIVE_ORG_KEY);
  } catch {
    // Private mode / disabled storage: fall back to the default org rather
    // than taking the whole console down over a preference.
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
      // ORDER BY matters: PostgREST gives no ordering guarantee, so without it
      // "the first membership" — the default org for anyone with no stored
      // preference — can differ between page loads.
      const { data, error } = await supabase.from("user_roles").select("role, org_id").order("org_id");
      if (error) throw error;
      return (data ?? []) as { role: string; org_id: string | null }[];
    },
  });

  const rows = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);
  const isSuperAdmin = rows.some((r) => r.role === "super_admin");

  const memberships = useMemo<Membership[]>(() => {
    const seen = new Set<string>();
    const out: Membership[] = [];
    for (const r of rows) {
      if (!r.org_id || !MANAGING_ROLES.has(r.role) || seen.has(r.org_id)) continue;
      seen.add(r.org_id);
      out.push({ orgId: r.org_id, role: r.role });
    }
    return out;
  }, [rows]);

  const [selected, setSelected] = useState<string | null>(null);

  // Re-resolve whenever memberships change: on first load, and again if the
  // selected org disappears from under us.
  useEffect(() => {
    if (rolesQuery.isLoading) return;
    setSelected((prev) => pickActiveOrg(memberships, prev ?? readStored()));
  }, [memberships, rolesQuery.isLoading]);

  const setActiveOrg = useCallback((orgId: string) => {
    setSelected(orgId);
    try {
      localStorage.setItem(ACTIVE_ORG_KEY, orgId);
    } catch {
      // Preference just won't survive a reload; the switch itself still works.
    }
  }, []);

  const value = useMemo<OrgContextValue>(
    () => ({
      memberships,
      activeOrgId: selected,
      activeRole: memberships.find((m) => m.orgId === selected)?.role ?? null,
      isSuperAdmin,
      setActiveOrg,
      isLoading: rolesQuery.isLoading,
    }),
    [memberships, selected, isSuperAdmin, setActiveOrg, rolesQuery.isLoading],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOrgContext(): OrgContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOrgContext must be used inside <OrgProvider>");
  return v;
}
