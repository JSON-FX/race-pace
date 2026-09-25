import { describe, it, expect, vi, beforeEach } from "vitest";

const { getMyRoles, updateSelect, updateEq, updateMock, lookupMock, revalidatePath } = vi.hoisted(() => ({
  getMyRoles: vi.fn(),
  updateSelect: vi.fn().mockResolvedValue({ data: [{ id: "a1" }], error: null }),
  updateEq: vi.fn(() => ({ select: updateSelect })),
  updateMock: vi.fn(() => ({ eq: updateEq })),
  lookupMock: vi.fn((table: string) => {
    if (table === "psgc_cities") return Promise.resolve({ data: { name: "Digos", province_code: "112400000", region_code: "110000000" }, error: null });
    if (table === "psgc_provinces") return Promise.resolve({ data: { name: "Davao del Sur" }, error: null });
    return Promise.resolve({ data: { name: "Davao Region" }, error: null });
  }),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/queries/roles", () => ({ getMyRoles }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (table: string) => table === "organizations"
    ? { update: updateMock }
    : { select: () => ({ eq: () => ({ maybeSingle: () => lookupMock(table) }) }) },
  }),
}));

import { updateOrgBrandingAction, updateOrgProfileAction, updateOrgCheckInDefaultAction } from "./settings";

function roles(overrides: Partial<{ isOrgAdmin: boolean; orgId: string | null }>) {
  return { role: "admin", isSuperAdmin: false, isAdmin: true, isOrgAdmin: true, orgId: "a1", ...overrides };
}

beforeEach(() => {
  getMyRoles.mockReset();
  updateSelect.mockClear().mockResolvedValue({ data: [{ id: "a1" }], error: null });
  updateEq.mockClear();
  updateMock.mockClear();
  lookupMock.mockClear();
  revalidatePath.mockClear();
});

describe("updateOrgBrandingAction", () => {
  it("saves and clears the optional featured image for an org admin", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    expect((await updateOrgBrandingAction("a1", { featured_image_url: "https://x/photo.png" })).ok).toBe(true);
    expect(updateMock).toHaveBeenCalledWith({ featured_image_url: "https://x/photo.png" });
    expect((await updateOrgBrandingAction("a1", { featured_image_url: null })).ok).toBe(true);
    expect(updateMock).toHaveBeenCalledWith({ featured_image_url: null });
  });
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

describe("updateOrgProfileAction", () => {
  function formData(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  }

  it("updates the name for an org admin", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    const res = await updateOrgProfileAction({}, formData({ orgId: "a1", name: "Renamed Org" }));
    expect(res.success).toBeTruthy();
    expect(updateMock).toHaveBeenCalledWith({
      name: "Renamed Org", description: null,
      home_city_psgc_code: null, home_city_name: null, home_province_name: null, home_region_name: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("saves the description and canonical location labels from PSGC", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    const res = await updateOrgProfileAction({}, formData({
      orgId: "a1", name: "TrailNorth", description: "  Community trail runs.  ", homeCityPsgcCode: "112603000",
    }));
    expect(res.success).toBeTruthy();
    expect(updateMock).toHaveBeenCalledWith({
      name: "TrailNorth", description: "Community trail runs.",
      home_city_psgc_code: "112603000", home_city_name: "Digos",
      home_province_name: "Davao del Sur", home_region_name: "Davao Region",
    });
    expect(lookupMock).toHaveBeenCalledTimes(3);
  });

  it("rejects an invalid home base and an oversized description", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    expect((await updateOrgProfileAction({}, formData({ orgId: "a1", name: "TrailNorth", homeCityPsgcCode: "invalid" }))).error).toBeTruthy();
    expect((await updateOrgProfileAction({}, formData({ orgId: "a1", name: "TrailNorth", description: "x".repeat(2001) }))).error).toBeTruthy();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects an empty name without touching the database", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    const res = await updateOrgProfileAction({}, formData({ orgId: "a1", name: "   " }));
    expect(res.error).toBeTruthy();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("refuses a non-org-admin without touching the database", async () => {
    getMyRoles.mockResolvedValue(roles({ isOrgAdmin: false }));
    const res = await updateOrgProfileAction({}, formData({ orgId: "a1", name: "Renamed Org" }));
    expect(res.error).toBeTruthy();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns a generic error, logs the real one server-side, and does not leak raw Postgres text to the UI", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getMyRoles.mockResolvedValue(roles({}));
    updateSelect.mockResolvedValueOnce({ data: null, error: { message: "permission denied for table organizations" } });
    const res = await updateOrgProfileAction({}, formData({ orgId: "a1", name: "Renamed Org" }));
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
    const res = await updateOrgProfileAction({}, formData({ orgId: "a1", name: "Renamed Org" }));
    expect(res.error).toBeTruthy();
    expect(res.success).toBeUndefined();
  });
});

describe("updateOrgCheckInDefaultAction", () => {
  function formData(orgId: string, enabled: boolean) {
    const fd = new FormData();
    fd.set("orgId", orgId);
    fd.append("checkInRequired", "false");
    if (enabled) fd.append("checkInRequired", "true");
    return fd;
  }

  it("saves a disabled default without changing existing events", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    const result = await updateOrgCheckInDefaultAction({}, formData("a1", false));
    expect(result.success).toMatch(/new events/);
    expect(updateMock).toHaveBeenCalledWith({ check_in_required_default: false });
    expect(revalidatePath).toHaveBeenCalledWith("/events/new");
  });

  it("refuses editors and foreign organizations before a write", async () => {
    getMyRoles.mockResolvedValue(roles({ isOrgAdmin: false }));
    expect((await updateOrgCheckInDefaultAction({}, formData("a1", true))).error).toBeTruthy();
    getMyRoles.mockResolvedValue(roles({ orgId: "other" }));
    expect((await updateOrgCheckInDefaultAction({}, formData("a1", true))).error).toBeTruthy();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
