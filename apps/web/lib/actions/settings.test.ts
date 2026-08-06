import { describe, it, expect, vi, beforeEach } from "vitest";

const { getMyRoles, updateSelect, updateEq, updateMock, revalidatePath } = vi.hoisted(() => ({
  getMyRoles: vi.fn(),
  updateSelect: vi.fn().mockResolvedValue({ data: [{ id: "a1" }], error: null }),
  updateEq: vi.fn(() => ({ select: updateSelect })),
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
  updateSelect.mockClear().mockResolvedValue({ data: [{ id: "a1" }], error: null });
  updateEq.mockClear();
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

  // assertCanEditOrg (in settings.ts) is the ONLY authorization boundary
  // here — RLS permits editors too (auth_can_admin_org accepts role IN
  // ('admin','editor')), it does not reject them. This test is what catches
  // a regression that removes the explicit application-level check.
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

  // A GRANT-blocked write is a loud Postgres error (e.g. "permission denied
  // for table organizations") — the DB layer errors, unlike the RLS-blocked
  // silent-zero-rows case below. Must not leak that raw text to the UI, but
  // must still be recoverable from server logs (console.error).
  it("returns a generic error, logs the real one server-side, and does not leak raw Postgres text to the UI", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getMyRoles.mockResolvedValue(roles({}));
    updateSelect.mockResolvedValueOnce({ data: null, error: { message: "permission denied for table organizations" } });
    const res = await updateOrgBrandingAction("a1", { logo_url: "https://x/a.png" });
    expect(res.ok).toBe(false);
    expect(res.error).not.toMatch(/permission denied|postgres/i);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[settings]"),
      expect.objectContaining({ error: expect.objectContaining({ message: "permission denied for table organizations" }) }),
    );
    errorSpy.mockRestore();
  });

  // RLS-blocked (as opposed to grant-blocked) UPDATEs return success with
  // zero affected rows, not an error — this is what .select("id") + the
  // empty-result check exist to catch.
  it("reports failure, not success, when the update silently affects zero rows", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    updateSelect.mockResolvedValueOnce({ data: [], error: null });
    const res = await updateOrgBrandingAction("a1", { logo_url: "https://x/a.png" });
    expect(res.ok).toBe(false);
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

  it("returns a generic error, logs the real one server-side, and does not leak raw Postgres text to the UI", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getMyRoles.mockResolvedValue(roles({}));
    updateSelect.mockResolvedValueOnce({ data: null, error: { message: "permission denied for table organizations" } });
    const res = await updateOrgNameAction({}, formData({ orgId: "a1", name: "Renamed Org" }));
    expect(res.error).toBeTruthy();
    expect(res.error).not.toMatch(/permission denied|postgres/i);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[settings]"),
      expect.objectContaining({ error: expect.objectContaining({ message: "permission denied for table organizations" }) }),
    );
    errorSpy.mockRestore();
  });

  it("reports failure, not success, when the update silently affects zero rows", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    updateSelect.mockResolvedValueOnce({ data: [], error: null });
    const res = await updateOrgNameAction({}, formData({ orgId: "a1", name: "Renamed Org" }));
    expect(res.error).toBeTruthy();
    expect(res.success).toBeUndefined();
  });
});
