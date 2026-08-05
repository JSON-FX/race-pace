// Shared role checks (service-role bypasses RLS, so these gate authorization in code).
export type RoleRow = { role: string; org_id: string | null };

/** Gate for `verify_jwt = false` functions invoked server-to-server with a
 *  fixed shared secret instead of a caller JWT (send-push's PUSH_CRON_SECRET
 *  pattern). Fails CLOSED: an unset `expected` (misconfigured env) rejects
 *  every request rather than letting them all through. */
export function isAuthorizedBearer(authorizationHeader: string | null, expected: string | undefined): boolean {
  if (!expected) return false;
  const provided = (authorizationHeader ?? "").replace("Bearer ", "");
  return provided === expected;
}

export function canAdminOrg(roles: RoleRow[], orgId: string): boolean {
  return roles.some((r) => r.role === "super_admin" || (r.org_id === orgId && (r.role === "editor" || r.role === "admin")));
}
export function canCheckIn(roles: RoleRow[], orgId: string): boolean {
  return roles.some((r) => r.role === "super_admin" ||
    (r.org_id === orgId && (r.role === "marshal" || r.role === "editor" || r.role === "admin")));
}
