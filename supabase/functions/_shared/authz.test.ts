import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canCheckIn, canAdminOrg, isAuthorizedBearer } from "./authz";

const ORG = "org-1";
const EVENT = "event-1";
describe("authz", () => {
  it("canCheckIn allows super_admin and org marshal/editor/admin only", () => {
    expect(canCheckIn([{ role: "super_admin", org_id: null }], ORG, EVENT)).toBe(true);
    expect(canCheckIn([{ role: "marshal", org_id: ORG }], ORG, EVENT)).toBe(true);
    expect(canCheckIn([{ role: "marshal", org_id: "other" }], ORG, EVENT)).toBe(false);
    expect(canCheckIn([{ role: "user", org_id: ORG }], ORG, EVENT)).toBe(false);
  });
  it("canAdminOrg excludes marshal", () => {
    expect(canAdminOrg([{ role: "marshal", org_id: ORG }], ORG)).toBe(false);
    expect(canAdminOrg([{ role: "admin", org_id: ORG }], ORG)).toBe(true);
  });
});

const row = (over: Partial<{ role: string; org_id: string; event_scope: string | null }> = {}) =>
  ({ role: "marshal", org_id: "org-1", event_scope: null, ...over }) as never;

describe("canCheckIn event_scope", () => {
  it("allows an org-wide marshal for any event in their org", () => {
    expect(canCheckIn([row()], "org-1", "event-A")).toBe(true);
  });

  it("allows an event-scoped marshal for their own event", () => {
    expect(canCheckIn([row({ event_scope: "event-A" })], "org-1", "event-A")).toBe(true);
  });

  // The bug: today this returns true, so a marshal scoped to one event can
  // check runners into another. The SQL twin has always refused it.
  it("refuses an event-scoped marshal for a different event in the same org", () => {
    expect(canCheckIn([row({ event_scope: "event-A" })], "org-1", "event-B")).toBe(false);
  });

  it("refuses any role from another org", () => {
    expect(canCheckIn([row({ org_id: "org-2" })], "org-1", "event-A")).toBe(false);
  });

  it("allows a super admin regardless of org or scope", () => {
    expect(canCheckIn([row({ role: "super_admin", org_id: "other" })], "org-1", "event-A")).toBe(true);
  });

  it("refuses a role with no check-in rights", () => {
    expect(canCheckIn([row({ role: "claiming" })], "org-1", "event-A")).toBe(false);
  });
});

describe("check-in/index.ts user_roles select", () => {
  // canCheckIn's event_scope narrowing is only as good as the data it's fed.
  // The tests above build RoleRow objects by hand, so they never touch the
  // actual `.select(...)` string in check-in/index.ts — dropping "event_scope"
  // from that string would silently revert every scoped marshal to org-wide
  // access, and every test above would still pass. This is a blunt
  // string-content assertion (it can't prove event_scope is *used* correctly,
  // only that it's *requested*), but it's the only thing standing between
  // that regression and production, since this repo has no harness that runs
  // the edge function against a real user_roles table.
  it("requests event_scope alongside role and org_id", () => {
    const path = fileURLToPath(new URL("../check-in/index.ts", import.meta.url));
    const source = readFileSync(path, "utf8");
    const selectMatch = source.match(/\.from\("user_roles"\)\.select\("([^"]+)"\)/);
    expect(selectMatch).not.toBeNull();
    expect(selectMatch?.[1]).toContain("event_scope");
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
