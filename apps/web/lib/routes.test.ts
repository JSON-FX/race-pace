import { describe, it, expect } from "vitest";
import { isProtectedPath, signInRedirectPath } from "./routes";

describe("isProtectedPath", () => {
  it("protects admin pages", () => {
    expect(isProtectedPath("/events")).toBe(true);
    expect(isProtectedPath("/registrations")).toBe(true);
    expect(isProtectedPath("/events/abc/edit")).toBe(true);
    expect(isProtectedPath("/")).toBe(true);
  });

  it("leaves the auth pages open", () => {
    expect(isProtectedPath("/login")).toBe(false);
    expect(isProtectedPath("/no-access")).toBe(false);
  });
});

describe("signInRedirectPath", () => {
  it("preserves the target path and its query string", () => {
    expect(signInRedirectPath("/registrations", "?status=paid")).toBe(
      "/login?next=%2Fregistrations%3Fstatus%3Dpaid",
    );
  });

  it("omits next for a bare root request", () => {
    expect(signInRedirectPath("/", "")).toBe("/login");
  });
});
