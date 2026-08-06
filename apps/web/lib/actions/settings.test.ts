import { describe, it, expect, vi, beforeEach } from "vitest";

const { getMyRoles, updateEq, updateMock, revalidatePath } = vi.hoisted(() => ({
  getMyRoles: vi.fn(),
  updateEq: vi.fn().mockResolvedValue({ error: null }),
  updateMock: vi.fn(() => ({ eq: updateEq })),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/queries/roles", () => ({ getMyRoles }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => ({ update: updateMock }) }),
}));

import { updateOrgBrandingAction, updateOrgNameAction } from "./settings";

function roles(overrides: Partial<{ isOrgAdmin: boolean; orgId: string | null }>) {
  return { role: "admin", isSuperAdmin: false, isAdmin: true, isOrgAdmin: true, orgId: "a1", ...overrides };
}

beforeEach(() => {
  getMyRoles.mockReset();
  updateEq.mockClear().mockResolvedValue({ error: null });
  updateMock.mockClear();
  revalidatePath.mockClear();
});

describe("updateOrgBrandingAction", () => {
  it("writes the patch and revalidates /settings for an org admin", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    const res = await updateOrgBrandingAction("a1", { logo_url: "https://x/a.png" });
    expect(res.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledWith({ logo_url: "https://x/a.png" });
    expect(updateEq).toHaveBeenCalledWith("id", "a1");
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });

  // The RLS policy on organizations (organizations_update_branding_org_admin)
  // already restricts UPDATE to auth_can_admin_org(id) — but a Postgres
  // UPDATE blocked by RLS silently affects zero rows rather than erroring,
  // so relying on RLS alone would report `{ ok: true }` to a non-admin
  // while nothing was written. This test is what catches a regression that
  // removes the explicit application-level check.
  it("refuses a non-org-admin without touching the database", async () => {
    getMyRoles.mockResolvedValue(roles({ isOrgAdmin: false }));
    const res = await updateOrgBrandingAction("a1", { logo_url: "https://x/a.png" });
    expect(res.ok).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("refuses a request for an org the caller isn't scoped to", async () => {
    getMyRoles.mockResolvedValue(roles({ orgId: "other-org" }));
    const res = await updateOrgBrandingAction("a1", { logo_url: "https://x/a.png" });
    expect(res.ok).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("updateOrgNameAction", () => {
  function formData(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  }

  it("updates the name for an org admin", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    const res = await updateOrgNameAction({}, formData({ orgId: "a1", name: "Renamed Org" }));
    expect(res.success).toBeTruthy();
    expect(updateMock).toHaveBeenCalledWith({ name: "Renamed Org" });
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("rejects an empty name without touching the database", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    const res = await updateOrgNameAction({}, formData({ orgId: "a1", name: "   " }));
    expect(res.error).toBeTruthy();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("refuses a non-org-admin without touching the database", async () => {
    getMyRoles.mockResolvedValue(roles({ isOrgAdmin: false }));
    const res = await updateOrgNameAction({}, formData({ orgId: "a1", name: "Renamed Org" }));
    expect(res.error).toBeTruthy();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
