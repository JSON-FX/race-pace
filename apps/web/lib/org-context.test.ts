import { describe, it, expect } from "vitest";
import { pickActiveOrg } from "./org-context";

const IDS = ["org-a", "org-b"];

describe("pickActiveOrg", () => {
  it("honours a stored id that is still available", () => {
    expect(pickActiveOrg(IDS, "org-b")).toBe("org-b");
  });

  it("falls back to the first org when nothing is stored", () => {
    expect(pickActiveOrg(IDS, null)).toBe("org-a");
  });

  it("ignores a stored org that is no longer available", () => {
    // An org is deleted, or access revoked, between sessions. Trusting the
    // stored id pins the console to an org whose every query returns nothing,
    // which reads as "the app is broken" rather than "you lost that org".
    expect(pickActiveOrg(IDS, "org-deleted")).toBe("org-a");
  });

  it("returns null when there are no orgs at all", () => {
    expect(pickActiveOrg([], "org-a")).toBeNull();
    expect(pickActiveOrg([], null)).toBeNull();
  });

  it("is stable — re-picking with the resolved value keeps it put", () => {
    const first = pickActiveOrg(IDS, null);
    expect(pickActiveOrg(IDS, first)).toBe(first);
  });

  it("treats an empty stored string as absent", () => {
    expect(pickActiveOrg(IDS, "")).toBe("org-a");
  });

  it("pins to the single org when the caller cannot switch", () => {
    // Callers pass stored=null for an account that cannot switch, so a leftover
    // preference from a super-admin session on the same browser can never move
    // an org admin off their own org.
    expect(pickActiveOrg(["org-a"], null)).toBe("org-a");
  });
});
