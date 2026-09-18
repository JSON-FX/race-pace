import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const roles = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queries/roles", () => ({ getMyRoles: roles }));
import { GET } from "./route";
it.each([
  ["release_kits", "/race-kits"],
  ["check_in", "/check-in"],
  ["manage_org", "/events"],
])("routes %s using current server authorization", async (cap, path) => {
  roles.mockResolvedValue({ capabilities: [cap] });
  const r = await GET(new NextRequest("https://admin.test/auth/complete"));
  expect(r.headers.get("location")).toBe(path);
});
it("rejects foreign redirect and handles removed access", async () => {
  roles.mockResolvedValue(null);
  expect(
    (
      await GET(
        new NextRequest(
          "https://admin.test/auth/complete?next=https://evil.test",
        ),
      )
    ).headers.get("location"),
  ).toBe("/no-access");
});
