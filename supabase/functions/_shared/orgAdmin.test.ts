import { describe, it, expect } from "vitest";
import {
  validateRename,
  orgStoragePrefixes,
  isDeleteBlocked,
  mapDeleteRpcError,
  adminConfirmRedirect,
  buildInviteLink,
} from "./orgAdmin";

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
  // delete_organization_tx (20260818120000_org_management.sql) raises with a
  // real SQLSTATE — `using errcode = 'P0001'` for org_has_payments, 'P0002'
  // for org_not_found — and supabase-js surfaces that on `error.code`. That
  // is the primary discriminator. Message `.includes` is only a fallback for
  // an error that somehow arrives without a code, so a future reword of the
  // raise text (e.g. "organization has settled payments") can't silently
  // turn a blocked delete into a 500 instead of a 409 — the P0001 on the
  // error object still fires even if the wording no longer matches.
  it("maps SQLSTATE P0001 to org_has_payments/409, regardless of message wording", () => {
    expect(mapDeleteRpcError({ code: "P0001", message: "org_has_payments: 3 settled payment(s)" }))
      .toEqual({ code: "org_has_payments", status: 409 });
    // Reworded message, code untouched — this is the exact drift scenario the
    // code-first check exists to survive.
    expect(mapDeleteRpcError({ code: "P0001", message: "organization has settled payments" }))
      .toEqual({ code: "org_has_payments", status: 409 });
  });
  it("maps SQLSTATE P0002 to not_found/404, regardless of message wording", () => {
    expect(mapDeleteRpcError({ code: "P0002", message: "org_not_found" }))
      .toEqual({ code: "not_found", status: 404 });
    expect(mapDeleteRpcError({ code: "P0002", message: "no such organization" }))
      .toEqual({ code: "not_found", status: 404 });
  });
  it("falls back to matching the message when no code is present", () => {
    expect(mapDeleteRpcError({ message: "org_has_payments: 1 settled payment(s)" }))
      .toEqual({ code: "org_has_payments", status: 409 });
    expect(mapDeleteRpcError({ message: "org_not_found" }))
      .toEqual({ code: "not_found", status: 404 });
  });
  it("falls back to server_error/500 for an unrelated error", () => {
    expect(mapDeleteRpcError({ code: "08006", message: "connection reset by peer" }))
      .toEqual({ code: "server_error", status: 500 });
  });
  it("falls back to server_error/500 when the error is undefined", () => {
    expect(mapDeleteRpcError(undefined)).toEqual({ code: "server_error", status: 500 });
  });
});

describe("adminConfirmRedirect", () => {
  it("appends /auth/confirm to a bare ADMIN_APP_URL", () => {
    expect(adminConfirmRedirect("http://localhost:3001")).toBe("http://localhost:3001/auth/confirm");
  });
  // ADMIN_APP_URL is hand-typed in Vercel and Docker Compose, and either
  // shape has shown up in this repo's other env vars — a trailing slash must
  // not produce a doubled "//auth/confirm".
  it("strips a trailing slash before appending", () => {
    expect(adminConfirmRedirect("http://localhost:3001/")).toBe("http://localhost:3001/auth/confirm");
  });
  it("strips multiple trailing slashes", () => {
    expect(adminConfirmRedirect("https://race-pace-admin.vercel.app///")).toBe(
      "https://race-pace-admin.vercel.app/auth/confirm",
    );
  });
  // Unconfigured secret: callers must be able to omit `redirectTo` rather
  // than pass a bare "/auth/confirm" that resolves against Supabase's own
  // host instead of the console's.
  it("returns null when ADMIN_APP_URL is unset", () => {
    expect(adminConfirmRedirect("")).toBeNull();
  });
});

describe("buildInviteLink", () => {
  it("builds a link to the console's /auth/confirm with the hashed token", () => {
    expect(buildInviteLink("http://localhost:3001", "abc123")).toBe(
      "http://localhost:3001/auth/confirm?token_hash=abc123&type=magiclink&next=%2Fteam",
    );
  });
  it("normalizes a trailing slash on ADMIN_APP_URL the same way as adminConfirmRedirect", () => {
    expect(buildInviteLink("http://localhost:3001/", "abc123")).toBe(
      "http://localhost:3001/auth/confirm?token_hash=abc123&type=magiclink&next=%2Fteam",
    );
  });
  // Best-effort contract: the org and its admin role are already committed
  // by the time this runs, so a missing ingredient must degrade to null, not
  // throw or emit a broken URL.
  it("returns null when ADMIN_APP_URL is unset", () => {
    expect(buildInviteLink("", "abc123")).toBeNull();
  });
  it("returns null when generateLink returned no hashed_token", () => {
    expect(buildInviteLink("http://localhost:3001", null)).toBeNull();
  });
});
