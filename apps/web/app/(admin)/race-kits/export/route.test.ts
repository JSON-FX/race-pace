import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  roles: vi.fn(),
  rpc: vi.fn(),
  range: vi.fn(),
  eq: vi.fn(),
}));
vi.mock("@/lib/queries/roles", () => ({ getMyRoles: mocks.roles }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mocks.rpc }),
}));
import { GET } from "./route";
const event = "00000000-0000-0000-0000-000000000001";
const row = {
  registration_id: "r",
  runner: "=HYPERLINK()",
  bib: "QA",
  category: "10K",
  kit: { shirt_size: "M", addons: [] },
  status: "paid",
  release_id: null,
  released_at: null,
  released_by: null,
  recipient_name: null,
  refund_pending: false,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.roles.mockResolvedValue({ capabilities: ["release_kits"] });
  mocks.rpc.mockImplementation((name: string) =>
    name === "kit_release_events" ? { eq: mocks.eq } : { range: mocks.range },
  );
  mocks.eq.mockResolvedValue({ data: [{ id: event }] });
});
it("exports all batches with identical filters and escapes spreadsheet formulas", async () => {
  mocks.range
    .mockResolvedValueOnce({ data: Array.from({ length: 1000 }, () => row) })
    .mockResolvedValueOnce({ data: [row] });
  const response = await GET(
    new Request(
      `http://localhost/race-kits/export?event=${event}&q=QA&state=unreleased`,
    ),
  );
  const text = await response.text();
  expect(response.status).toBe(200);
  expect(text.trimEnd().split("\r\n")).toHaveLength(1002);
  expect(text).toContain("'=HYPERLINK()");
  expect(mocks.rpc).toHaveBeenCalledWith("kit_release_roster", {
    p_event_id: event,
    p_query: "QA",
    p_state: "unreleased",
  });
  expect(mocks.range).toHaveBeenLastCalledWith(1000, 1999);
});
it("does not return a partial successful CSV when a later page fails", async () => {
  mocks.range
    .mockResolvedValueOnce({ data: Array.from({ length: 1000 }, () => row) })
    .mockResolvedValueOnce({ error: { message: "offline" } });
  expect(
    (await GET(new Request(`http://localhost/race-kits/export?event=${event}`)))
      .status,
  ).toBe(503);
});
it("denies unavailable events", async () => {
  mocks.eq.mockResolvedValue({ data: [] });
  expect(
    (await GET(new Request(`http://localhost/race-kits/export?event=${event}`)))
      .status,
  ).toBe(403);
  expect(mocks.range).not.toHaveBeenCalled();
});
