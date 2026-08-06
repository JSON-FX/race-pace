import { useOrgContext } from "./orgContext";

export type MyRoles = { role: string | null; orgId: string | null; isSuperAdmin: boolean; isAdmin: boolean; isOrgAdmin: boolean };

/**
 * Roles as every route already consumes them — `roles.data?.orgId` etc.
 *
 * The one semantic change: `orgId` is now the ACTIVE org, not "the first admin
 * row we happened to find", and `isOrgAdmin` is your role IN that org rather
 * than "you are an admin of something, somewhere". Scoping the role to the org
 * being viewed is what the permission checks meant all along — an editor on
 * org A shouldn't get admin-only controls just because they administer org B.
 *
 * Shape is unchanged (still `{ data, isLoading }`) so the call sites did not
 * need to move. See lib/orgContext.tsx for the selection itself.
 */
export function useMyRoles(): { data: MyRoles | undefined; isLoading: boolean } {
  const { memberships, activeOrgId, activeRole, isSuperAdmin, isLoading } = useOrgContext();

  if (isLoading) return { data: undefined, isLoading: true };

  return {
    isLoading: false,
    data: {
      role: isSuperAdmin ? "super_admin" : activeRole,
      orgId: activeOrgId,
      isSuperAdmin,
      // "Can use the console at all" — a super admin, or a managing role in at
      // least one org. Kept org-independent on purpose: it gates the route,
      // and gating it on the ACTIVE org would lock out a user mid-switch.
      isAdmin: isSuperAdmin || memberships.length > 0,
      isOrgAdmin: isSuperAdmin || activeRole === "admin",
    },
  };
}
