import { describe, it, expect } from "vitest";
import { capabilitiesFor, hasCapability, type Capability } from "./capabilities";

const sorted = (c: readonly Capability[]) => [...c].sort();

describe("capabilitiesFor", () => {
  it("gives a super admin every capability", () => {
    expect(sorted(capabilitiesFor(null, true)))
      .toEqual(sorted(["manage_platform", "manage_team", "manage_org", "check_in"]));
  });

  it("gives an org admin team and org management plus check-in, but not platform", () => {
    expect(sorted(capabilitiesFor("admin", false)))
      .toEqual(sorted(["manage_team", "manage_org", "check_in"]));
  });

  // The privilege-escalation guard. /team is admin-only today (nav-items.ts
  // filters it on isOrgAdmin); folding it into manage_org would hand editors
  // org membership management as a side effect of this refactor.
  it("does NOT give an editor manage_team", () => {
    expect(capabilitiesFor("editor", false)).not.toContain("manage_team");
  });

  it("gives an editor org management and check-in", () => {
    expect(sorted(capabilitiesFor("editor", false))).toEqual(sorted(["manage_org", "check_in"]));
  });

  it("gives a marshal check-in and nothing else", () => {
    expect(capabilitiesFor("marshal", false)).toEqual(["check_in"]);
  });

  // `claiming` is assignable in the team UI but has no consumer until the
  // race-kit spec. It must not silently inherit anything.
  it("gives the claiming role nothing yet", () => {
    expect(capabilitiesFor("claiming", false)).toEqual([]);
  });

  it("gives an unknown or absent role nothing", () => {
    expect(capabilitiesFor(null, false)).toEqual([]);
    expect(capabilitiesFor("nonsense", false)).toEqual([]);
  });

  it("lets super admin win over a lesser role held in the resolved org", () => {
    expect(capabilitiesFor("marshal", true)).toContain("manage_platform");
  });
});

describe("hasCapability", () => {
  it("is true when present and false when absent", () => {
    expect(hasCapability(["check_in"], "check_in")).toBe(true);
    expect(hasCapability(["check_in"], "manage_org")).toBe(false);
    expect(hasCapability([], "check_in")).toBe(false);
  });
});
