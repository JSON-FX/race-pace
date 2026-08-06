import { describe, it, expect, vi, beforeEach } from "vitest";

const { getUser, rpc, revalidatePath } = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    rpc,
  }),
}));

import { cancelRegistrationsAction } from "./registrations";

beforeEach(() => {
  getUser.mockReset();
  rpc.mockReset();
  revalidatePath.mockClear();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
});

describe("cancelRegistrationsAction", () => {
  it("refuses an unauthenticated caller without calling the RPC", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await cancelRegistrationsAction(["r1"]);
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns ok:false with nothing to do for an empty selection", async () => {
    const res = await cancelRegistrationsAction([]);
    expect(res.ok).toBe(false);
    expect(res.cancelled).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  // The RPC (admin_cancel_registration) does its own auth_can_admin_org
  // check server-side and returns 'unauthorized' rather than throwing —
  // this is the case where the CALLER IS authenticated but not an
  // admin/editor of the registration's org (e.g. an editor's session token
  // reused against another org's registration id, or the UI's role gate
  // being bypassed entirely by calling the Server Action directly). UI
  // gating must not be mistaken for authorization — this proves the
  // server-side check is what actually blocks it.
  it("surfaces 'unauthorized' from the RPC as a real error, not a silent success", async () => {
    rpc.mockResolvedValue({ data: "unauthorized", error: null });
    const res = await cancelRegistrationsAction(["r1"]);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/permission/i);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("cancels every id and revalidates on full success", async () => {
    rpc.mockResolvedValueOnce({ data: "cancelled", error: null })
       .mockResolvedValueOnce({ data: "cancelled", error: null });
    const res = await cancelRegistrationsAction(["r1", "r2"]);
    expect(res.ok).toBe(true);
    expect(res.cancelled).toBe(2);
    expect(res.error).toBeUndefined();
    expect(revalidatePath).toHaveBeenCalledWith("/registrations");
  });

  it("reports a partial success when some rows aren't cancellable (already paid)", async () => {
    rpc.mockResolvedValueOnce({ data: "cancelled", error: null })
       .mockResolvedValueOnce({ data: "not_cancellable", error: null });
    const res = await cancelRegistrationsAction(["r1", "r2"]);
    expect(res.ok).toBe(true);
    expect(res.cancelled).toBe(1);
    expect(res.error).toMatch(/1 of 2/);
  });

  it("fails outright (not a false 'success') when every row is ineligible", async () => {
    rpc.mockResolvedValue({ data: "not_cancellable", error: null });
    const res = await cancelRegistrationsAction(["r1"]);
    expect(res.ok).toBe(false);
    expect(res.cancelled).toBe(0);
    expect(res.error).toMatch(/refund/i);
  });

  // A genuine transport/DB error from .rpc() (network blip, function
  // dropped, etc.) must be surfaced, never swallowed into a reported
  // success — same discipline as the RLS-empty-result rule for `.update()`.
  it("surfaces a hard RPC error rather than reporting success", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "connection reset" } });
    const res = await cancelRegistrationsAction(["r1"]);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("connection reset");
  });
});
