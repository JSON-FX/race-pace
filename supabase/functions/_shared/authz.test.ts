import { describe, it, expect } from "vitest";
import { canCheckIn, canAdminOrg, isAuthorizedBearer } from "./authz";

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

describe("isAuthorizedBearer", () => {
  it("accepts the exact expected secret", () => {
    expect(isAuthorizedBearer("Bearer s3cr3t", "s3cr3t")).toBe(true);
  });
  it("rejects a missing Authorization header", () => {
    expect(isAuthorizedBearer(null, "s3cr3t")).toBe(false);
  });
  it("rejects the wrong secret", () => {
    expect(isAuthorizedBearer("Bearer wrong", "s3cr3t")).toBe(false);
  });
  it("fails closed when the expected secret is unset (misconfiguration)", () => {
    expect(isAuthorizedBearer("Bearer anything", undefined)).toBe(false);
    expect(isAuthorizedBearer("Bearer ", "")).toBe(false);
  });
});
