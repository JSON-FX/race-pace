import { useOrgContext } from "./orgContext";

export type MyRoles = { role: string | null; orgId: string | null; isSuperAdmin: boolean; isAdmin: boolean; isOrgAdmin: boolean };

/**
 * Roles as every route already consumes them — `roles.data?.orgId` etc.
 *
 * `orgId` is the ACTIVE org (lib/orgContext.tsx). For org staff that is their
 * one org and never changes; for a super admin it is whichever org they have
 * selected.
 *
 * `isOrgAdmin` is the role held IN that org rather than "an admin of
 * something, somewhere" — an editor on org A must not get admin-only controls
 * because they administer org B. A super admin is org-admin everywhere, which
 * matches `auth_can_admin_org()`: it returns true for a super admin on any
 * org, so the UI and the RLS agree instead of the UI hiding a control the
 * database would have allowed.
 */
export function useMyRoles(): { data: MyRoles | undefined; isLoading: boolean } {
  const { activeOrgId, activeRole, isSuperAdmin, availableOrgs, isLoading } = useOrgContext();

  if (isLoading) return { data: undefined, isLoading: true };

  return {
    isLoading: false,
    data: {
      role: activeRole,
      orgId: activeOrgId,
      isSuperAdmin,
      // Gates the console route itself, so it must not depend on which org is
      // selected — that would lock a super admin out mid-switch, or before any
      // org exists at all.
      isAdmin: isSuperAdmin || availableOrgs.length > 0,
      isOrgAdmin: isSuperAdmin || activeRole === "admin",
    },
  };
}
