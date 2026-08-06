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
