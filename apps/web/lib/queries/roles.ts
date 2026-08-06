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

  // .order() so PostgREST's row order is never load-bearing for anything
  // below — the org-resolution logic reads every row and picks explicitly,
  // it does not rely on which row the database happened to return first.
  const { data, error } = await supabase.from("user_roles").select("role, org_id").order("role");
  if (error) throw error;

  const rows = data ?? [];
  const isSuperAdmin = rows.some((r) => r.role === "super_admin");

  // The role model is additive/dual-role: a user can hold an `admin` row in
  // org X AND an `editor` row in org Y at the same time. getMyRoles must
  // resolve to exactly ONE org, and `orgId`/`isOrgAdmin` must describe THAT
  // SAME org — they must never be able to disagree. Bug this fixes: the old
  // code picked `orgId` from `rows.find(admin-or-editor)` (whichever row
  // Postgres returned first) but computed `isOrgAdmin` from `rows.some(role
  // === "admin")` across ALL rows. For an admin-in-X + editor-in-Y user
  // whose Y row sorted first, that returned `{orgId: "Y", isOrgAdmin:
  // true}" — "admin of Y" — when the user is only an editor of Y. Every
  // downstream isOrgAdmin gate (Team, Settings) trusted that false signal
  // for org Y. Fix: resolve a single `resolvedRow` FIRST (preferring an
  // `admin` row over an `editor` row, deterministically, regardless of scan
  // order), then derive every other field from that same row.
  const resolvedRow = rows.find((r) => r.role === "admin") ?? rows.find((r) => r.role === "editor");

  return {
    role: isSuperAdmin ? "super_admin" : resolvedRow?.role ?? rows[0]?.role ?? null,
    orgId: resolvedRow?.org_id ?? null,
    isSuperAdmin,
    isAdmin: isSuperAdmin || !!resolvedRow,
    // "admin of the resolved org" — NOT "admin of any org the caller
    // belongs to". See the resolvedRow comment above: this must be computed
    // from the same row `orgId` came from, or the two fields can describe
    // different organizations.
    isOrgAdmin: isSuperAdmin || resolvedRow?.role === "admin",
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
