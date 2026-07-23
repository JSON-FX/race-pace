import { describe, it, expect } from "vitest";
import { canCheckIn, canAdminOrg } from "./authz";

const ORG = "org-1";
describe("authz", () => {
  it("canCheckIn allows super_admin and org marshal/editor/admin only", () => {
    expect(canCheckIn([{ role: "super_admin", org_id: null }], ORG)).toBe(true);
    expect(canCheckIn([{ role: "marshal", org_id: ORG }], ORG)).toBe(true);
    expect(canCheckIn([{ role: "marshal", org_id: "other" }], ORG)).toBe(false);
    expect(canCheckIn([{ role: "user", org_id: ORG }], ORG)).toBe(false);
  });
  it("canAdminOrg excludes marshal", () => {
    expect(canAdminOrg([{ role: "marshal", org_id: ORG }], ORG)).toBe(false);
    expect(canAdminOrg([{ role: "admin", org_id: ORG }], ORG)).toBe(true);
  });
});
