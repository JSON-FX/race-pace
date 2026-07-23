// Pure, runtime-agnostic guards for the org-members edge function. No Deno or
// Supabase imports, so these run under the root vitest suite.

export const ASSIGNABLE_ROLES = ["admin", "editor", "marshal", "claiming"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/** Roles an org admin may assign. Excludes 'user' (runner self-signup) and
 *  'super_admin' (platform-only). */
export function isAssignableRole(role: string): role is AssignableRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(role);
}

export type OrgRoleRow = { user_id: string; role: string };

/** Would changing `userId`'s org role to `newRole` (null = removing them)
 *  leave the org with zero admins? The org must always keep >= 1 admin. */
export function wouldLeaveNoAdmin(roles: OrgRoleRow[], userId: string, newRole: string | null): boolean {
  const otherAdmins = roles.filter((r) => r.user_id !== userId && r.role === "admin").length;
  const selfAdminAfter = newRole === "admin" ? 1 : 0;
  return otherAdmins + selfAdminAfter === 0;
}
