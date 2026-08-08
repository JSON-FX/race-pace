import { describe, it, expect } from "vitest";
import { visibleOrgItems, visibleSuperItems, primaryMobileItems, moreMobileItems } from "./nav-items";
import type { MyRoles } from "@/lib/queries/roles";
import type { Capability } from "@/lib/capabilities";

const who = (capabilities: Capability[], over: Partial<MyRoles> = {}): MyRoles => ({
  role: null, orgId: "org-1", isSuperAdmin: false, isAdmin: true, isOrgAdmin: false,
  capabilities, ...over,
});

const paths = (items: { to: string }[]) => items.map((i) => i.to);

describe("visibleOrgItems", () => {
  it("shows a marshal only check-in", () => {
    expect(paths(visibleOrgItems(who(["check_in"])))).toEqual(["/check-in"]);
  });

  // The privilege-escalation guard, mirrored from capabilities.test.ts: /team
  // is admin-only today and must not become visible to an editor.
  it("hides Team from an editor", () => {
    expect(paths(visibleOrgItems(who(["manage_org", "check_in"])))).not.toContain("/team");
  });

  it("shows Team to an org admin", () => {
    expect(paths(visibleOrgItems(who(["manage_team", "manage_org", "check_in"])))).toContain("/team");
  });

  it("shows every org destination to an org admin", () => {
    const p = paths(visibleOrgItems(who(["manage_team", "manage_org", "check_in"])));
    expect(p).toEqual(expect.arrayContaining(
      ["/dashboard", "/events", "/registrations", "/payments", "/check-in", "/team", "/settings"],
    ));
  });
});

describe("visibleSuperItems", () => {
  it("is empty without manage_platform", () => {
    expect(visibleSuperItems(who(["manage_team", "manage_org", "check_in"]))).toEqual([]);
  });

  it("lists the platform destinations with manage_platform", () => {
    expect(paths(visibleSuperItems(who(["manage_platform"]))))
      .toEqual(["/organizations", "/commission", "/payouts"]);
  });
});

describe("mobile nav", () => {
  it("gives a marshal a bottom bar of just check-in", () => {
    expect(paths(primaryMobileItems(who(["check_in"])))).toEqual(["/check-in"]);
  });

  it("gives a marshal no More groups, since nothing else is reachable", () => {
    expect(moreMobileItems(who(["check_in"]))).toEqual([]);
  });
});
