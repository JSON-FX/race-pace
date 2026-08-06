import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type MyRoles = {
  role: string | null;
  orgId: string | null;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isOrgAdmin: boolean;
};

/** Resolve the caller's roles server-side. Returns null when unauthenticated.
 *  Mirrors the old useMyRoles() shape exactly so Sidebar needs no changes
 *  beyond taking it as a prop. RLS on user_roles scopes the rows to the caller.
 *  Wrapped in React's cache() so the (admin) layout and each page's query
 *  dedupe into a single call per request. */
export const getMyRoles = cache(async (): Promise<MyRoles | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase.from("user_roles").select("role, org_id");
  if (error) throw error;

  const rows = data ?? [];
  const isSuperAdmin = rows.some((r) => r.role === "super_admin");
  const adminRow = rows.find((r) => r.role === "admin" || r.role === "editor");

  return {
    role: isSuperAdmin ? "super_admin" : adminRow?.role ?? rows[0]?.role ?? null,
    orgId: adminRow?.org_id ?? null,
    isSuperAdmin,
    isAdmin: isSuperAdmin || !!adminRow,
    isOrgAdmin: isSuperAdmin || rows.some((r) => r.role === "admin"),
  };
});

/**
 * Org-scoped pages (Events, Registrations, Payments, Team, Settings, the
 * event editor, ...) all need a concrete org id to query with. The role
 * model genuinely allows `isAdmin: true` with `orgId: null` — a caller with
 * only a `super_admin` row and no org-scoped admin/editor row clears the
 * (admin) layout's `isAdmin` guard but has no organization to scope a query
 * to. Querying with a null id (`org_id=eq.null`) 500s casting against a
 * uuid column; it does NOT degrade to an empty list.
 *
 * Every org-scoped page must call this and branch on the result — render
 * `<NoOrgScope />` (from "@/components/no-org-scope") when it's null,
 * rather than asserting the id is non-null and letting the query crash.
 * Pure and null-safe so it's trivially unit-testable without mocking
 * Supabase or `getMyRoles()` itself.
 */
export function requireOrgId(roles: MyRoles | null): string | null {
  return roles?.orgId ?? null;
}
