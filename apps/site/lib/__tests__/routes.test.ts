import { describe, it, expect } from "vitest";
import { isProtectedPath, signInRedirectPath } from "../routes";

describe("isProtectedPath", () => {
  it("protects the authenticated flow", () => {
    expect(isProtectedPath("/register/abc")).toBe(true);
    expect(isProtectedPath("/pay/abc")).toBe(true);
    expect(isProtectedPath("/ticket/abc")).toBe(true);
    expect(isProtectedPath("/races")).toBe(true);
    expect(isProtectedPath("/profile")).toBe(true);
  });

  it("leaves the public catalog open", () => {
    expect(isProtectedPath("/")).toBe(false);
    expect(isProtectedPath("/events")).toBe(false);
    expect(isProtectedPath("/events/abc")).toBe(false);
    expect(isProtectedPath("/sign-in")).toBe(false);
    expect(isProtectedPath("/sign-up")).toBe(false);
  });

  // /pay/callback is protected like the rest of /pay — it verifies a payment
  // for the signed-in runner and must not be reachable anonymously.
  it("protects the pay callback", () => {
    expect(isProtectedPath("/pay/callback")).toBe(true);
  });

  // A public route must not be protected just because a protected name
  // appears later in the path.
  it("matches on prefix only, not substring", () => {
    expect(isProtectedPath("/events/register-info")).toBe(false);
    expect(isProtectedPath("/about/profile")).toBe(false);
  });

  // "/racesomething" must not match the "/races" prefix.
  it("requires a segment boundary", () => {
    expect(isProtectedPath("/racesomething")).toBe(false);
    expect(isProtectedPath("/profiles")).toBe(false);
  });
});

describe("signInRedirectPath", () => {
  it("round-trips the target path so the runner resumes where they landed", () => {
    expect(signInRedirectPath("/register/abc", "")).toBe("/sign-in?next=%2Fregister%2Fabc");
  });

  it("preserves the query string in the encoded target", () => {
    expect(signInRedirectPath("/pay/callback", "?rid=r1&status=paid")).toBe(
      "/sign-in?next=%2Fpay%2Fcallback%3Frid%3Dr1%26status%3Dpaid",
    );
  });
});
