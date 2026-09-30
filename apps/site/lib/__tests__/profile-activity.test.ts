import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeProfileRegistrations, completedRaceStats, fetchProfileScreeningUpdates, type ProfileRegistration } from "../profile-activity";
const { getUser, from, select, eq, order, limit, returns } = vi.hoisted(() => ({
  getUser: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), returns: vi.fn(),
}));
vi.mock("../supabase/client", () => ({ createClient: () => ({ auth: { getUser }, from }) }));
const registration = (extra: Partial<ProfileRegistration> = {}): ProfileRegistration => ({
  id: "reg", participantUserId: "user", status: "paid", eventStatus: "completed", categoryDistance: 13,
  expiresAt: null, eventName: "Trail race", categoryLabel: "13K", ...extra,
});
beforeEach(() => {
  vi.clearAllMocks();
  const query = { select, eq, order, limit, returns };
  for (const method of [from, select, eq, order, limit]) method.mockReturnValue(query);
  getUser.mockResolvedValue({ data: { user: { id: "user" } }, error: null });
  returns.mockResolvedValue({ data: [], error: null });
});
describe("completed profile activity", () => {
  it("counts only the account owner's paid entries in completed events", () => {
    const entries = [registration(), registration({ categoryDistance: 7.5 }),
      registration({ status: "pending" }), registration({ status: "refunded" }),
      registration({ eventStatus: "open" }), registration({ eventStatus: "cancelled" }),
      registration({ participantUserId: null }), registration({ participantUserId: "another-runner" })];
    expect(completedRaceStats(entries, "user")).toEqual({ races: 2, km: 20.5, longestKm: 13 });
  });
  it("counts a completed entry with unknown distance without inventing a longest distance", () => {
    expect(completedRaceStats([registration({ categoryDistance: null })], "user")).toEqual({ races: 1, km: 0, longestKm: null });
  });
  it("excludes expired pending holds and managed entries from registered events", () => {
    const entries = [registration({ id: "paid", eventStatus: "open" }),
      registration({ id: "pending", eventStatus: "open", status: "pending", expiresAt: "2999-01-01T00:00:00Z" }),
      registration({ eventStatus: "open", status: "pending", expiresAt: "2000-01-01T00:00:00Z" }),
      registration({ eventStatus: "open", participantUserId: null }), registration({ eventStatus: "cancelled" }), registration()];
    expect(activeProfileRegistrations(entries, "user").map(entry => entry.id)).toEqual(["paid", "pending"]);
  });
});
describe("profile screening read", () => {
  it("uses the authenticated owner and selects only bounded presentation fields", async () => {
    await fetchProfileScreeningUpdates("user");
    expect(eq).toHaveBeenCalledWith("booked_by_user_id", "user");
    expect(limit).toHaveBeenCalledWith(20);
    expect(select.mock.calls[0][0]).not.toMatch(/proof|email|explanation|contact/);
  });
  it("makes no data request after the account changes", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "another-runner" } }, error: null });
    expect(await fetchProfileScreeningUpdates("user")).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });
  it("propagates a data failure instead of turning it into an empty inbox", async () => {
    returns.mockResolvedValue({ data: null, error: new Error("Unavailable") });
    await expect(fetchProfileScreeningUpdates("user")).rejects.toThrow("Unavailable");
  });
});
