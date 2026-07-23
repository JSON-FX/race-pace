// Shared role checks (service-role bypasses RLS, so these gate authorization in code).
export type RoleRow = { role: string; org_id: string | null };

export function canAdminOrg(roles: RoleRow[], orgId: string): boolean {
  return roles.some((r) => r.role === "super_admin" || (r.org_id === orgId && (r.role === "editor" || r.role === "admin")));
}
export function canCheckIn(roles: RoleRow[], orgId: string): boolean {
  return roles.some((r) => r.role === "super_admin" ||
    (r.org_id === orgId && (r.role === "marshal" || r.role === "editor" || r.role === "admin")));
}
