import { describe, it, expect } from "vitest";
import { isProtectedPath, signInRedirectPath, safeNextPath } from "./routes";

describe("isProtectedPath", () => {
  it("leaves the OAuth callback PUBLIC — it is the request that creates the session", () => {
    // The regression: with /auth/callback protected, middleware bounced Google's
    // return leg to /login?next=%2Fauth%2Fcallback%3Fcode%3D…, so the code was
    // never exchanged. No session was created, no error surfaced, and the sign-in
    // button simply appeared to do nothing. Guarding the one route that cannot
    // possibly carry a session makes OAuth impossible.
    expect(isProtectedPath("/auth/callback")).toBe(false);
  });

  it("still protects anything else under /auth", () => {
    // Default-deny is the point: making the whole /auth prefix public would open
    // any future route added there without anyone deciding to.
    expect(isProtectedPath("/auth")).toBe(true);
    expect(isProtectedPath("/auth/admin-tools")).toBe(true);
  });


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

describe("safeNextPath", () => {
  it("rejects protocol-relative URLs disguised as a path", () => {
    expect(safeNextPath("//evil.com")).toBe("/events");
  });

  it("rejects absolute URLs with a scheme", () => {
    expect(safeNextPath("https://evil.com")).toBe("/events");
  });

  it("rejects backslash variants that browsers treat as protocol-relative", () => {
    expect(safeNextPath("/\\evil.com")).toBe("/events");
  });

  it("allows an ordinary internal path with a query string", () => {
    expect(safeNextPath("/events?status=paid")).toBe("/events?status=paid");
  });

  it("allows the bare root path", () => {
    expect(safeNextPath("/")).toBe("/");
  });

  it("falls back for an empty string", () => {
    expect(safeNextPath("")).toBe("/events");
  });

  it("falls back for null", () => {
    expect(safeNextPath(null)).toBe("/events");
  });

  it("falls back for a value containing a backslash anywhere", () => {
    expect(safeNextPath("/events\\..\\evil")).toBe("/events");
  });

  it("falls back for a value containing a control character", () => {
    expect(safeNextPath("/events\n.evil.com")).toBe("/events");
  });

  it("honors a custom fallback", () => {
    expect(safeNextPath(undefined, "/login")).toBe("/login");
  });
});
