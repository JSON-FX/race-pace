import { describe, it, expect, vi, beforeEach } from "vitest";
import { kitEditLocked, daysUntil, kitEditMessage, updateShirtSize, deadlineNotice } from "../kit";

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

describe("deadlineNotice", () => {
  it("says nothing when the event has no deadline", () => {
    expect(deadlineNotice(null)).toBeNull();
  });

  it("says nothing once the deadline has passed — the closed state covers it", () => {
    expect(deadlineNotice("2020-01-01T00:00:00Z")).toBeNull();
  });

  it("names the date when the deadline is far off, not a relative count", () => {
    const far = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const notice = deadlineNotice(far);
    expect(notice).toMatch(/^Registration closes /);
    // A hardcoded-relative-form regression would still print *something*
    // starting with a date-shaped string; assert the relative phrasing is
    // specifically absent so that mutation is caught here, not just below.
    expect(notice).not.toMatch(/Closes in/);
  });

  it("switches to relative time inside the final week, where urgency reads better", () => {
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    expect(deadlineNotice(soon)).toBe("Closes in 3 days");
  });

  it("uses the singular on the last day", () => {
    const tomorrow = new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString();
    expect(deadlineNotice(tomorrow)).toBe("Closes in 1 day");
  });

  // The boundary itself: 7 days out must still read as an instruction (relative),
  // 8 days out must read as trivia (absolute). Neither the 3-day nor the 30-day
  // case above exercises this edge, so a fence-post error in the `<= 7` check
  // (e.g. `< 7`, or `< 8`) would slip past them undetected.
  it("uses relative form at exactly seven days, the edge of the final week", () => {
    const sevenDays = new Date(Date.now() + 7 * 86_400_000).toISOString();
    expect(deadlineNotice(sevenDays)).toBe("Closes in 7 days");
  });

  it("uses absolute form at exactly eight days, just outside the final week", () => {
    const eightDays = new Date(Date.now() + 8 * 86_400_000).toISOString();
    expect(deadlineNotice(eightDays)).toMatch(/^Registration closes /);
  });
});
