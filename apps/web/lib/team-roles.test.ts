import { it, expect } from "vitest";
import { ASSIGNABLE_ROLES } from "./team-roles";
import { capabilitiesFor } from "./capabilities";
it("offers only roles with working capabilities", () => {
  expect(ASSIGNABLE_ROLES).toContain("claiming");
  for (const role of ASSIGNABLE_ROLES) expect(capabilitiesFor(role, false).length).toBeGreaterThan(0);
});
