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

  // BY_ROLE today forms a strict superset chain: marshal ⊆ editor ⊆ admin.
  // roles.ts's getMyRoles tests lean on this — with a chain, `capabilitiesFor`
  // applied to the single resolved (highest-tier) row is byte-identical to a
  // union of `capabilitiesFor` over every row the caller holds, so those tests
  // cannot by themselves prove capabilities aren't computed by such a union.
  // This test pins the chain so that guarantee is explicit and checked. The
  // race-kit spec plans to give `claiming` a `release_kits` capability none of
  // these three roles have, which breaks the chain — a claiming-in-org-A +
  // marshal-in-org-B caller would then get different capabilities from
  // "resolved row alone" vs. "union across rows". When this test starts
  // failing, that is the signal to add a test in roles.test.ts that actually
  // discriminates the two (e.g. a resolved marshal row alongside a claiming
  // row in another org must NOT pick up release_kits).
  it("keeps marshal, editor and admin capabilities in a strict superset chain", () => {
    const marshal = capabilitiesFor("marshal", false);
    const editor = capabilitiesFor("editor", false);
    const admin = capabilitiesFor("admin", false);
    expect(marshal.every((c) => editor.includes(c))).toBe(true);
    expect(editor.every((c) => admin.includes(c))).toBe(true);
  });
});

describe("hasCapability", () => {
  it("is true when present and false when absent", () => {
    expect(hasCapability(["check_in"], "check_in")).toBe(true);
    expect(hasCapability(["check_in"], "manage_org")).toBe(false);
    expect(hasCapability([], "check_in")).toBe(false);
  });
});
