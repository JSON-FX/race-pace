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

import { setFeeMode } from "./commission";

/** The fixture an org admin satisfies. `isAdmin`/`isOrgAdmin` are true here on
 *  purpose: those are the properties a regressed gate would reach for, and this
 *  caller must still be refused. */
function roles(capabilities: string[]) {
  return {
    role: "admin", isAdmin: true, isOrgAdmin: true, orgId: "a1",
    isSuperAdmin: capabilities.includes("manage_platform"), capabilities,
  };
}

const SUPER = ["manage_platform", "manage_team", "manage_org", "check_in"];
const ORG_ADMIN = ["manage_team", "manage_org", "check_in"];

beforeEach(() => {
  getMyRoles.mockReset();
  updateSelect.mockClear().mockResolvedValue({ data: [{ id: "a1" }], error: null });
  updateEq.mockClear();
  updateMock.mockClear();
  revalidatePath.mockClear();
});

describe("setFeeMode", () => {
  it("writes the mode and revalidates /commission for a super admin", async () => {
    getMyRoles.mockResolvedValue(roles(SUPER));
    const res = await setFeeMode("a1", "pass_on");
    expect(res.error).toBeUndefined();
    expect(res.success).toMatch(/Runners now cover processing/);
    expect(updateMock).toHaveBeenCalledWith({ fee_mode: "pass_on" });
    expect(updateEq).toHaveBeenCalledWith("id", "a1");
    expect(revalidatePath).toHaveBeenCalledWith("/commission");
  });

  // A Server Action is a public endpoint. The Commission page 404s an org admin
  // and the control is rendered nowhere else, but neither fact reaches this
  // function — a POST straight at the action ID skips both. This check is the
  // application-level boundary, and the DB trigger from 20260811097000 is the
  // one underneath it.
  it("refuses a caller without manage_platform, without touching the database", async () => {
    getMyRoles.mockResolvedValue(roles(ORG_ADMIN));
    const res = await setFeeMode("a1", "pass_on");
    expect(res.error).toMatch(/super admin/i);
    expect(updateMock).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller", async () => {
    getMyRoles.mockResolvedValue(null);
    const res = await setFeeMode("a1", "absorb");
    expect(res.error).toBeTruthy();
    expect(updateMock).not.toHaveBeenCalled();
  });

  // fee_mode is `text` with a check constraint, so an unknown value would be
  // rejected by Postgres — as a 500-shaped generic error, after a round trip,
  // with nothing said about which value was wrong.
  it("rejects an unknown mode before it reaches the column check", async () => {
    getMyRoles.mockResolvedValue(roles(SUPER));
    const res = await setFeeMode("a1", "invoice_later" as "absorb");
    expect(res.error).toBe("Unknown fee mode.");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects a missing organization before checking anything else", async () => {
    const res = await setFeeMode("", "absorb");
    expect(res.error).toBe("Missing organization.");
    expect(getMyRoles).not.toHaveBeenCalled();
  });

  // The failure mode the whole grant investigation was about. A missing column
  // grant raises ("permission denied for table organizations"); an RLS or
  // trigger refusal can come back as zero rows. Either way the control must not
  // report success — `write()`'s .select("id") is what distinguishes them.
  it("reports failure, not success, when the write affects zero rows", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getMyRoles.mockResolvedValue(roles(SUPER));
    updateSelect.mockResolvedValueOnce({ data: [], error: null });
    const res = await setFeeMode("a1", "pass_on");
    expect(res.success).toBeUndefined();
    expect(res.error).toBeTruthy();
    expect(revalidatePath).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("does not leak raw Postgres text when the grant is missing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getMyRoles.mockResolvedValue(roles(SUPER));
    updateSelect.mockResolvedValueOnce({
      data: null, error: { message: "permission denied for table organizations" },
    });
    const res = await setFeeMode("a1", "pass_on");
    expect(res.error).not.toMatch(/permission denied|postgres/i);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
