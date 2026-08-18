import { describe, it, expect } from "vitest";
import { validateRename, orgStoragePrefixes, isDeleteBlocked } from "./orgAdmin";

describe("validateRename", () => {
  it("accepts an ordinary name", () => {
    expect(validateRename("Muspo Trail Events")).toBeNull();
  });
  // The slug is immutable and the name is not, so a rename to whitespace would
  // leave an organization with no readable identity anywhere in the console.
  it("rejects empty and whitespace-only names", () => {
    expect(validateRename("")).toBe("name_required");
    expect(validateRename("   ")).toBe("name_required");
  });
  it("rejects a name longer than 120 characters", () => {
    expect(validateRename("x".repeat(121))).toBe("name_too_long");
    expect(validateRename("x".repeat(120))).toBeNull();
  });
});

describe("isDeleteBlocked", () => {
  // Blocking on `refunded` is deliberate: a refund is still money that moved
  // and still a PayMongo record that may have to be reconciled.
  it("blocks on paid, refunded and partially_refunded", () => {
    expect(isDeleteBlocked({ paid: 1, refunded: 0, partially_refunded: 0 })).toBe(true);
    expect(isDeleteBlocked({ paid: 0, refunded: 2, partially_refunded: 0 })).toBe(true);
    expect(isDeleteBlocked({ paid: 0, refunded: 0, partially_refunded: 1 })).toBe(true);
  });
  it("does not block when nothing settled", () => {
    expect(isDeleteBlocked({ paid: 0, refunded: 0, partially_refunded: 0 })).toBe(false);
  });
});

describe("orgStoragePrefixes", () => {
  it("names the two buckets an organization owns files in", () => {
    expect(orgStoragePrefixes("abc")).toEqual([
      { bucket: "event-images", prefix: "abc" },
      { bucket: "org-images", prefix: "abc" },
    ]);
  });
});
