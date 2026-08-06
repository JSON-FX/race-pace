import { describe, it, expect } from "vitest";
import { pickActiveOrg, type Membership } from "../lib/orgContext";

const A: Membership = { orgId: "org-a", role: "admin" };
const B: Membership = { orgId: "org-b", role: "editor" };

describe("pickActiveOrg", () => {
  it("honours a stored id that is still a membership", () => {
    expect(pickActiveOrg([A, B], "org-b")).toBe("org-b");
  });

  it("falls back to the first membership when nothing is stored", () => {
    expect(pickActiveOrg([A, B], null)).toBe("org-a");
  });

  it("ignores a stored org the user no longer belongs to", () => {
    // The exact case that motivated validating rather than trusting: an org is
    // deleted (or access revoked) between sessions. Trusting it pins the
    // console to an org whose every query returns nothing.
    expect(pickActiveOrg([A, B], "org-deleted")).toBe("org-a");
  });

  it("returns null when there are no memberships at all", () => {
    expect(pickActiveOrg([], "org-a")).toBeNull();
    expect(pickActiveOrg([], null)).toBeNull();
  });

  it("is stable — re-picking with the resolved value keeps it put", () => {
    const first = pickActiveOrg([A, B], null);
    expect(pickActiveOrg([A, B], first)).toBe(first);
  });

  it("treats an empty stored string as absent", () => {
    expect(pickActiveOrg([A, B], "")).toBe("org-a");
  });
});
