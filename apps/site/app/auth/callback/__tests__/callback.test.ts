import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { OAUTH_NEXT_COOKIE } from "@/lib/routes";
import { GET } from "../route";

const exchangeCodeForSession = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession: (...a: unknown[]) => exchangeCodeForSession(...a) } }),
}));

/** The callback is reached by a top-level GET from Supabase, so build the
 *  request the same way: real URL, cookies via the Cookie header. */
function req(url: string, cookie?: string): NextRequest {
  return new NextRequest(url, cookie ? { headers: { cookie } } : undefined);
}

beforeEach(() => {
  exchangeCodeForSession.mockReset();
  exchangeCodeForSession.mockResolvedValue({ error: null });
});

describe("OAuth callback", () => {
  it("sends the runner to the cookie's destination after exchanging the code", async () => {
    const res = await GET(req("https://racepace.lan/auth/callback?code=abc", `${OAUTH_NEXT_COOKIE}=%2Fraces`));

    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(res.headers.get("location")).toBe("https://racepace.lan/races");
  });

  it("clears the destination cookie so a later visit can't be misrouted by a stale one", async () => {
    const res = await GET(req("https://racepace.lan/auth/callback?code=abc", `${OAUTH_NEXT_COOKIE}=%2Fraces`));

    // Deleting a cookie is expressed as a Set-Cookie with an empty value and
    // an immediate expiry — assert the header, not just the absence of a value.
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${OAUTH_NEXT_COOKIE}=`);
    expect(setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });

  it("refuses an absolute destination in the cookie", async () => {
    // The cookie is written by client-side JS and therefore untrusted: without
    // safeNextPath this is an open redirect handing a fresh session to a
    // phishing origin.
    const res = await GET(
      req("https://racepace.lan/auth/callback?code=abc", `${OAUTH_NEXT_COOKIE}=https%3A%2F%2Fevil.example%2Fsteal`),
    );

    expect(res.headers.get("location")).toBe("https://racepace.lan/");
  });

  it("refuses a protocol-relative destination in the cookie", async () => {
    // `//evil.example` has no scheme but browsers navigate it as absolute.
    const res = await GET(
      req("https://racepace.lan/auth/callback?code=abc", `${OAUTH_NEXT_COOKIE}=%2F%2Fevil.example`),
    );

    expect(res.headers.get("location")).toBe("https://racepace.lan/");
  });

  it("survives a malformed cookie instead of throwing", async () => {
    // A bare "%" is an invalid escape; decodeURIComponent throws URIError on
    // it, which would 500 the one route a runner cannot skip.
    const res = await GET(req("https://racepace.lan/auth/callback?code=abc", `${OAUTH_NEXT_COOKIE}=%`));

    expect(res.headers.get("location")).toBe("https://racepace.lan/");
  });

  it("still honours ?next= when no cookie is present", async () => {
    const res = await GET(req("https://racepace.lan/auth/callback?code=abc&next=%2Fraces"));

    expect(res.headers.get("location")).toBe("https://racepace.lan/races");
  });

  it("bounces to sign-in when the code exchange fails", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: "bad code" } });

    const res = await GET(req("https://racepace.lan/auth/callback?code=abc", `${OAUTH_NEXT_COOKIE}=%2Fraces`));

    expect(res.headers.get("location")).toBe("https://racepace.lan/sign-in?error=oauth");
  });

  it("bounces to sign-in when no code is present", async () => {
    const res = await GET(req("https://racepace.lan/auth/callback"));

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://racepace.lan/sign-in?error=oauth");
  });
});
