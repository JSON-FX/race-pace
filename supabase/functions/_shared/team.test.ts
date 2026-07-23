import { describe, it, expect } from "vitest";
import { isAssignableRole, wouldLeaveNoAdmin, ASSIGNABLE_ROLES } from "./team";

describe("isAssignableRole", () => {
  it("accepts the four assignable roles", () => {
    for (const r of ASSIGNABLE_ROLES) expect(isAssignableRole(r)).toBe(true);
  });
  it("rejects user, super_admin, and unknown roles", () => {
    expect(isAssignableRole("user")).toBe(false);
    expect(isAssignableRole("super_admin")).toBe(false);
    expect(isAssignableRole("wizard")).toBe(false);
  });
});

describe("wouldLeaveNoAdmin", () => {
  const roles = [
    { user_id: "a", role: "admin" },
    { user_id: "b", role: "editor" },
    { user_id: "c", role: "admin" },
  ];
  it("blocks removing the last admin", () => {
    expect(wouldLeaveNoAdmin([{ user_id: "a", role: "admin" }], "a", null)).toBe(true);
  });
  it("allows removing an admin when another admin remains", () => {
    expect(wouldLeaveNoAdmin(roles, "a", null)).toBe(false);
  });
  it("blocks demoting the only admin to a non-admin role", () => {
    expect(wouldLeaveNoAdmin([{ user_id: "a", role: "admin" }, { user_id: "b", role: "editor" }], "a", "editor")).toBe(true);
  });
  it("allows promoting a non-admin to admin", () => {
    expect(wouldLeaveNoAdmin([{ user_id: "b", role: "editor" }], "b", "admin")).toBe(false);
  });
  it("allows removing a non-admin", () => {
    expect(wouldLeaveNoAdmin(roles, "b", null)).toBe(false);
  });
  it("blocks (fail-safe) when the roles list is empty", () => {
    expect(wouldLeaveNoAdmin([], "z", null)).toBe(true);
  });
  it("treats duplicate role rows for one user as that single user", () => {
    const dup = [{ user_id: "a", role: "admin" }, { user_id: "a", role: "admin" }];
    expect(wouldLeaveNoAdmin(dup, "a", "editor")).toBe(true); // demoting the only admin, even with dup rows
  });
});
