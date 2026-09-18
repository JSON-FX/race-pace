import { beforeEach, expect, it, vi } from "vitest";
const { roles, settlement } = vi.hoisted(() => ({ roles: vi.fn(), settlement: vi.fn() }));
vi.mock("@/lib/queries/roles", () => ({ getMyRoles: roles }));
vi.mock("@/lib/queries/settlement", () => ({ getEventSettlement: settlement }));
import { GET } from "./route";
const run = () => GET(new Request("https://admin.test/events/e/settlement/export"), { params: Promise.resolve({ id: "e" }) });
beforeEach(() => {
  vi.clearAllMocks();
  roles.mockResolvedValue({ capabilities: ["manage_org"], orgId: "org", isSuperAdmin: false });
  settlement.mockResolvedValue({ org_id: "org", event_name: 'Race "unsafe"\r\nname', rows: [] });
});
it("returns a downloadable private CSV with a safe filename", async () => {
  const res = await run();
  expect(res.status).toBe(200);
  expect(res.headers.get("content-disposition")).toBe('attachment; filename="race-unsafe-name-settlement.csv"');
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(await res.text()).toContain("registration_id,runner_name");
});
it("denies operational staff before reading settlement", async () => {
  roles.mockResolvedValue({ capabilities: ["release_kits"] });
  expect((await run()).status).toBe(403);
  expect(settlement).not.toHaveBeenCalled();
});
it("hides a foreign event from organization admins", async () => {
  settlement.mockResolvedValue({ org_id: "foreign", rows: [] });
  expect((await run()).status).toBe(404);
});
it("allows a platform admin to export other organizations", async () => {
  roles.mockResolvedValue({ capabilities: ["manage_org"], orgId: "other", isSuperAdmin: true });
  expect((await run()).status).toBe(200);
});
it("returns 404 for missing events", async () => {
  settlement.mockResolvedValue(null);
  expect((await run()).status).toBe(404);
});
it("fails before sending a success attachment on database errors", async () => {
  settlement.mockRejectedValue(new Error("private database detail"));
  const res = await run();
  expect(res.status).toBe(500);
  expect(res.headers.has("content-disposition")).toBe(false);
  expect(await res.text()).not.toContain("private database detail");
});
