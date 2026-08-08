import { describe, it, expect } from "vitest";
import { ASSIGNABLE_ROLES } from "./team-roles";

describe("team roles", () => {
  it("does not offer a role that grants nothing", () => {
    // `claiming` ("Race Kit") has no authorization consumer until the race-kit
    // spec wires it. Offering it means an org admin can hand a colleague a role
    // that lands them on /no-access. The DB enum value stays; only the picker
    // stops listing it.
    expect(ASSIGNABLE_ROLES).not.toContain("claiming");
  });
});
