import { describe, it, expect } from "vitest";
import { validateRename, orgStoragePrefixes, isDeleteBlocked, mapDeleteRpcError } from "./orgAdmin";

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

describe("mapDeleteRpcError", () => {
  // delete_organization_tx raises these as plain Postgres error messages, not
  // structured codes, so the mapping has to pattern-match on `.includes`. Kept
  // as one function so the code and the HTTP status can never drift apart —
  // the handler used to compute this twice and could return one status with a
  // code that implies another.
  //
  // Status only branches on org_has_payments (409); every other case,
  // org_not_found included, is 500. That is the behaviour this was extracted
  // from verbatim — org_not_found reaching the RPC means the row vanished
  // between our own SELECT and the call (a race), not a normal 404, so it is
  // treated as unexpected rather than as a routine not-found.
  it("maps a message containing org_has_payments to a 409", () => {
    expect(mapDeleteRpcError("org_has_payments")).toEqual({ code: "org_has_payments", status: 409 });
    expect(mapDeleteRpcError("ERROR: org_has_payments (P0001)")).toEqual({ code: "org_has_payments", status: 409 });
  });
  it("maps a message containing org_not_found to the not_found code, still on a 500 status", () => {
    expect(mapDeleteRpcError("org_not_found")).toEqual({ code: "not_found", status: 500 });
    expect(mapDeleteRpcError("ERROR: org_not_found (P0002)")).toEqual({ code: "not_found", status: 500 });
  });
  it("falls back to server_error/500 for an unrelated message", () => {
    expect(mapDeleteRpcError("connection reset by peer")).toEqual({ code: "server_error", status: 500 });
  });
  it("falls back to server_error/500 when the message is undefined", () => {
    expect(mapDeleteRpcError(undefined)).toEqual({ code: "server_error", status: 500 });
  });
});
