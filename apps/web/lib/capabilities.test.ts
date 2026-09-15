import { describe, it, expect } from "vitest";
import { capabilitiesFor, hasCapability, type Capability } from "./capabilities";
import { ASSIGNABLE_ROLES } from "./team-roles";

const sorted = (c: readonly Capability[]) => [...c].sort();

describe("capabilitiesFor", () => {
  it("gives a super admin every capability", () => {
    expect(sorted(capabilitiesFor(null, true)))
      .toEqual(sorted(["manage_platform", "manage_team", "manage_org", "check_in", "release_kits"]));
  });

  it("gives an org admin team and org management plus check-in, but not platform", () => {
    expect(sorted(capabilitiesFor("admin", false)))
      .toEqual(sorted(["manage_team", "manage_org", "check_in", "release_kits"]));
  });

  // The privilege-escalation guard. /team is admin-only today (nav-items.ts
  // filters it on isOrgAdmin); folding it into manage_org would hand editors
  // org membership management as a side effect of this refactor.
  it("does NOT give an editor manage_team", () => {
    expect(capabilitiesFor("editor", false)).not.toContain("manage_team");
  });

  it("gives an editor org management and check-in", () => {
    expect(sorted(capabilitiesFor("editor", false))).toEqual(sorted(["manage_org", "check_in", "release_kits"]));
  });

  it("gives a marshal check-in and nothing else", () => {
    expect(capabilitiesFor("marshal", false)).toEqual(["check_in"]);
  });

  // Kit crew must not inherit registration, payment, or check-in access.
  it("gives kit crew only kit release", () => {
    expect(capabilitiesFor("claiming", false)).toEqual(["release_kits"]);
  });

  it("gives an unknown or absent role nothing", () => {
    expect(capabilitiesFor(null, false)).toEqual([]);
    expect(capabilitiesFor("nonsense", false)).toEqual([]);
  });

  it("lets super admin win over a lesser role held in the resolved org", () => {
    expect(capabilitiesFor("marshal", true)).toContain("manage_platform");
  });

  // The actual property that makes union-vs-resolved-row indistinguishable in
  // roles.ts's getMyRoles tests: the union of every assignable role's
  // capabilities is no bigger than admin's. While that holds, computing
  // capabilities as `capabilitiesFor(resolvedRow.role)` and computing them as
  // a union of `capabilitiesFor(role)` over every row the caller holds
  // produce the same result whenever admin is among the rows (and a subset of
  // it otherwise) — so a reintroduced union-across-rows bug would be
  // byte-identical to the correct behaviour and no test could catch it by
  // checking output alone.
  //
  // Iterate the assignable roles so any future capability outside the admin
  // set triggers a review of resolved-role versus cross-org union behavior.
  it("has no role whose capabilities escape admin's — the union of every assignable role never exceeds admin's set", () => {
    const admin = capabilitiesFor("admin", false);
    const union = new Set<Capability>();
    for (const role of ASSIGNABLE_ROLES) {
      for (const cap of capabilitiesFor(role, false)) union.add(cap);
    }
    for (const cap of capabilitiesFor(null, false)) union.add(cap); // the no-role case
    expect([...union].every((c) => admin.includes(c))).toBe(true);
  });
});

describe("hasCapability", () => {
  it("is true when present and false when absent", () => {
    expect(hasCapability(["check_in"], "check_in")).toBe(true);
    expect(hasCapability(["check_in"], "manage_org")).toBe(false);
    expect(hasCapability([], "check_in")).toBe(false);
  });
});
