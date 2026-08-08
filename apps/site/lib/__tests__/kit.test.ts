import { describe, it, expect, vi, beforeEach } from "vitest";
import { kitEditLocked, daysUntil, kitEditMessage, updateShirtSize } from "../kit";

const rpc = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }),
}));

beforeEach(() => {
  rpc.mockReset();
});

describe("kitEditLocked", () => {
  it("is unlocked when there is no deadline", () => {
    expect(kitEditLocked(null)).toBe(false);
  });
  it("is unlocked before the deadline", () => {
    expect(kitEditLocked("2099-01-01T00:00:00Z")).toBe(false);
  });
  it("is locked after the deadline", () => {
    expect(kitEditLocked("2020-01-01T00:00:00Z")).toBe(true);
  });

  // The RPC gates on `v_kit_closes < now()` (strict). At the exact cutoff instant the
  // client must agree and stay unlocked, or a runner could see "Locked" here while the
  // RPC would still accept the edit — exactly backwards from the documented failure mode.
  // Frozen system time makes the two Date.now() reads (fixture + comparison) line up
  // exactly instead of racing a real clock.
  it("is unlocked at the exact cutoff instant, matching the RPC's strict `<` comparison", () => {
    const now = new Date("2030-06-15T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      expect(kitEditLocked(now.toISOString())).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("daysUntil", () => {
  it("counts whole days remaining, rounding up so 'today' reads as 1", () => {
    const soon = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
    expect(daysUntil(soon)).toBe(2);
  });
  it("returns 0 once the instant has passed", () => {
    expect(daysUntil("2020-01-01T00:00:00Z")).toBe(0);
  });
});

describe("kitEditMessage", () => {
  it("explains a missed deadline in terms of what to do next", () => {
    expect(kitEditMessage("locked")).toMatch(/organiser|organizer/i);
  });

  it("explains a settled registration", () => {
    expect(kitEditMessage("not_editable")).toMatch(/no longer be changed/i);
  });

  it("says nothing for a successful save", () => {
    expect(kitEditMessage("ok")).toBeNull();
  });

  it("says nothing when the value did not change", () => {
    expect(kitEditMessage("no_change")).toBeNull();
  });

  it("falls back to a generic message for an unexpected failure", () => {
    expect(kitEditMessage("error")).toMatch(/couldn't|could not/i);
  });
});

describe("updateShirtSize", () => {
  // The case that matters most: a save that lands after the cutoff must come back
  // as "locked", not be swallowed into "error" or, worse, treated as "ok". If this
  // pass-through were replaced with `return "ok"` the deadline enforcement would be
  // silently defeated on the client even though the RPC did its job correctly.
  it("passes through a 'locked' result from the RPC rather than collapsing it", async () => {
    rpc.mockResolvedValue({ data: "locked", error: null });
    await expect(updateShirtSize("r1", "M")).resolves.toBe("locked");
  });

  it("calls the RPC with the registration id and the shirt_size change, no actor param", async () => {
    rpc.mockResolvedValue({ data: "ok", error: null });
    await updateShirtSize("r1", "XL");
    expect(rpc).toHaveBeenCalledWith("update_registration_fields_tx", {
      p_registration_id: "r1",
      p_changes: { shirt_size: "XL" },
    });
  });

  it("maps a transport error to 'error' instead of throwing or defaulting to ok", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "network down" } });
    await expect(updateShirtSize("r1", "M")).resolves.toBe("error");
  });

  it("maps an unrecognised RPC payload to 'error' rather than trusting it", async () => {
    rpc.mockResolvedValue({ data: "something_new", error: null });
    await expect(updateShirtSize("r1", "M")).resolves.toBe("error");
  });
});
