import { describe, it, expect } from "vitest";
import { requireOrgId, type MyRoles } from "./roles";

function roles(overrides: Partial<MyRoles>): MyRoles {
  return { role: "admin", orgId: "org-1", isSuperAdmin: false, isAdmin: true, isOrgAdmin: false, ...overrides };
}

describe("requireOrgId", () => {
  it("returns the org id when present", () => {
    expect(requireOrgId(roles({ orgId: "org-1" }))).toBe("org-1");
  });

  it("returns null for an admin with no org-scoped row (e.g. a bare super_admin)", () => {
    expect(requireOrgId(roles({ orgId: null, isSuperAdmin: true }))).toBeNull();
  });

  it("returns null when roles is null (unauthenticated)", () => {
    expect(requireOrgId(null)).toBeNull();
  });
});
