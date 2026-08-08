import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org-context";
import { capabilitiesFor, hasCapability, type Capability } from "@/lib/capabilities";

export type MyRoles = {
  role: string | null;
  orgId: string | null;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isOrgAdmin: boolean;
  /** What this caller may do IN THE RESOLVED ORG. An array, not a Set: MyRoles
   *  is passed as a prop into AppShell and must cross the server→client
   *  boundary, which a Set does not survive. */
  capabilities: Capability[];
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

  // .order() does NOT make row order irrelevant to org selection — that's
  // done below by the explicit two-step `find(admin) ?? find(editor)`,
  // which already guarantees an admin row wins over an editor row
  // regardless of scan order (ascending-by-role just happens to put "admin"
  // before "editor" too, so this is belt-and-suspenders for that choice,
  // not the mechanism the security fix depends on). What .order() actually
  // buys: a stable, non-arbitrary value for the `rows[0]` fallback used
  // below for `role` when the caller has no admin/editor row, and a
  // secondary key (org_id) so that if the caller holds an `admin` row in
  // TWO orgs, which one wins is at least deterministic rather than
  // whatever order Postgres feels like today. See the resolvedRow comment
  // for why a stable *choice* still isn't the same as a *correct* one in
  // that two-admin-orgs case.
  const { data, error } = await supabase.from("user_roles").select("role, org_id").order("role").order("org_id");
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
  // for org Y. Fix: resolve a single `resolvedRow` FIRST — the explicit
  // `find(role === "admin") ?? find(role === "editor")` below is what
  // guarantees an admin row always wins over an editor row, independent of
  // row order — then derive every other field from that same row.
  //
  // KNOWN LIMITATION, not fixed here: a user holding `admin` rows in TWO
  // different orgs (also a legitimate, supported state) still has no way to
  // pick between them — `find(role === "admin")` returns whichever admin
  // row is first after the `.order("role").order("org_id")` above, which
  // only makes that choice STABLE (same org every call), not a considered
  // one. That user is silently pinned to one org across Events,
  // Registrations, Payments, Team and Settings, with no org switcher and no
  // indication the other org exists. This is not a privilege-escalation bug
  // (both orgs are legitimately theirs) so it's out of scope here — an org
  // switcher is a product decision beyond this PR — but a future reader
  // should not mistake the `.order()` above for having solved it.
  // Marshal last, after admin and editor, so a user holding both keeps the
  // stronger row. Without this a marshal-only account resolves to no row at
  // all, orgId stays null, and every org-scoped page renders <NoOrgScope />.
  const resolvedRow =
    rows.find((r) => r.role === "admin")
    ?? rows.find((r) => r.role === "editor")
    ?? rows.find((r) => r.role === "marshal");

  // A super admin legitimately has no org-scoped admin/editor row. Rather than
  // leaving orgId null — which sends every org-scoped page to <NoOrgScope /> —
  // fall back to the org they have selected. This is the "KNOWN LIMITATION"
  // noted above finally being resolved for the super-admin case.
  //
  // Only fetched for a super admin: getOrgContext reads `organizations`, and a
  // non-super-admin's orgId already comes from resolvedRow, so the extra round
  // trip would buy nothing. Both functions are cache()d, so a page that also
  // calls getOrgContext (the TopBar switcher does) shares this one call.
  const orgCtx = isSuperAdmin ? await getOrgContext() : null;

  return {
    role: isSuperAdmin ? "super_admin" : resolvedRow?.role ?? rows[0]?.role ?? null,
    // resolvedRow first: a super admin who ALSO holds a real org-scoped admin
    // row keeps that org, so the fallback only fires when there is nothing else.
    orgId: resolvedRow?.org_id ?? orgCtx?.activeOrgId ?? null,
    isSuperAdmin,
    isAdmin: isSuperAdmin || !!resolvedRow,
    // "admin of the resolved org" — NOT "admin of any org the caller
    // belongs to". See the resolvedRow comment above: this must be computed
    // from the same row `orgId` came from, or the two fields can describe
    // different organizations.
    isOrgAdmin: isSuperAdmin || resolvedRow?.role === "admin",
    // From resolvedRow's role, NOT from a scan across rows — same reason
    // isOrgAdmin is computed this way. See the resolvedRow comment above.
    capabilities: capabilitiesFor(resolvedRow?.role ?? null, isSuperAdmin),
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

/**
 * Assert a capability inside a server component, before anything renders.
 *
 * Hiding a nav link is a convenience; this is the control. A marshal typing
 * /payments is redirected here rather than reaching a page whose emptiness
 * depends on RLS — the difference between an authorization boundary and a
 * data-layer accident.
 *
 * Takes `roles` rather than fetching it: every caller already has it (from
 * the layout's `getMyRoles()`, itself `cache()`d), so fetching again here
 * would just be a second name for the same call — and a pure `(roles, cap)`
 * function is trivially unit-testable without mocking this module against
 * itself.
 *
 * Platform pages (Organizations, Commission, Payouts) deliberately do NOT
 * use this — they call `notFound()` instead, because whether they exist is
 * itself information not to disclose to a non-super-admin. See
 * organizations/page.tsx.
 */
export function requireCapability(roles: MyRoles | null, cap: Capability): MyRoles {
  if (!roles || !hasCapability(roles.capabilities, cap)) redirect("/no-access");
  return roles;
}
