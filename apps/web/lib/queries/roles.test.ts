import { describe, it, expect, vi, beforeEach } from "vitest";
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

describe("getMyRoles", () => {
  // The role model is additive/dual-role: a caller can hold an `admin` row
  // in one org and an `editor` row in another at the same time. orgId and
  // isOrgAdmin MUST describe the same org, or a write gated on `isOrgAdmin`
  // (e.g. Settings' assertCanEditOrg) can be satisfied for an org the
  // caller is only an editor of. This is a regression test for exactly
  // that bug: it must resolve to the admin org (X) with isOrgAdmin true,
  // and must NEVER report isOrgAdmin: true alongside orgId: "org-Y" (the
  // editor-only org), regardless of what order Postgres returns the rows in.
  async function loadGetMyRoles(rows: { role: string; org_id: string }[]) {
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
        from: () => ({
          select: () => ({
            order: async () => ({ data: rows, error: null }),
          }),
        }),
      }),
    }));
    return (await import("./roles")).getMyRoles;
  }

  beforeEach(() => {
    vi.resetModules();
  });

  it("resolves to the admin org, not the editor org, when the editor row sorts first", async () => {
    const getMyRoles = await loadGetMyRoles([
      { role: "editor", org_id: "org-Y" },
      { role: "admin", org_id: "org-X" },
    ]);
    const result = await getMyRoles();
    expect(result?.orgId).toBe("org-X");
    expect(result?.isOrgAdmin).toBe(true);
    // The failure mode this guards: isOrgAdmin true paired with the
    // editor-only org.
    expect(result?.orgId).not.toBe("org-Y");
  });

  it("resolves to the admin org when the admin row sorts first too (order must not matter)", async () => {
    const getMyRoles = await loadGetMyRoles([
      { role: "admin", org_id: "org-X" },
      { role: "editor", org_id: "org-Y" },
    ]);
    const result = await getMyRoles();
    expect(result?.orgId).toBe("org-X");
    expect(result?.isOrgAdmin).toBe(true);
  });

  it("reports isOrgAdmin: false when resolved to an editor-only org", async () => {
    const getMyRoles = await loadGetMyRoles([{ role: "editor", org_id: "org-Y" }]);
    const result = await getMyRoles();
    expect(result?.orgId).toBe("org-Y");
    expect(result?.isOrgAdmin).toBe(false);
    expect(result?.isAdmin).toBe(true);
  });
});
