import { beforeEach, expect, it, vi } from "vitest";
import { fetchMyRegistrations } from "../registration";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), eq: vi.fn(), order: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  auth: { getUser: mocks.getUser }, from: mocks.from,
}) }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "helper" } }, error: null });
  mocks.from.mockReturnValue({ select: () => ({ eq: mocks.eq }) });
  mocks.eq.mockReturnValue({ order: mocks.order });
  mocks.order.mockResolvedValue({ data: [], error: null });
});
it("restricts personal race history to the participant despite broader booking access", async () => {
  await expect(fetchMyRegistrations()).resolves.toEqual([]);
  expect(mocks.eq).toHaveBeenCalledWith("user_id", "helper");
});
it("does not query registrations without a verified user", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  await expect(fetchMyRegistrations()).resolves.toEqual([]);
  expect(mocks.from).not.toHaveBeenCalled();
});
it("surfaces authentication failures instead of querying with missing ownership", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("offline") });
  await expect(fetchMyRegistrations()).rejects.toThrow("offline");
  expect(mocks.from).not.toHaveBeenCalled();
});
