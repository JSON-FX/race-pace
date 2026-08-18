import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const verifyOtp = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp } }),
}));

import { GET } from "./route";

beforeEach(() => verifyOtp.mockReset());

function req(qs: string) {
  return new NextRequest(`https://admin.racepace.lan/auth/confirm${qs}`);
}

describe("GET /auth/confirm", () => {
  it("verifies the token and redirects to `next`", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const res = await GET(req("?token_hash=abc&type=magiclink&next=/team"));

    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type: "magiclink" });
    expect(res.status).toBe(307);
    // RELATIVE Location on purpose — the same lesson auth/callback/route.ts
    // documents: behind Traefik or on Vercel, an absolute origin resolves to
    // the server's own bind address, not the host the operator typed.
    expect(res.headers.get("location")).toBe("/team");
  });

  it("rejects an absolute `next` rather than open-redirecting", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const res = await GET(req("?token_hash=abc&type=magiclink&next=https://evil.example"));
    // Pin safeNextPath's actual fallback, not just the absence of the bad
    // string — `not.toContain` would also pass for an empty or wrong location.
    expect(res.headers.get("location")).toBe("/team");
  });

  it("sends an expired or reused link back to login with a reason", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "Token has expired" } });
    const res = await GET(req("?token_hash=abc&type=magiclink"));
    expect(res.headers.get("location")).toBe("/login?oauth=invite_expired");
  });

  it("does not call verifyOtp when the link carries no token", async () => {
    const res = await GET(req("?type=magiclink"));
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("/login?oauth=invite_expired");
  });

  it("accepts `invite` — the type a real SMTP-emailed link would carry", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const res = await GET(req("?token_hash=abc&type=invite&next=/team"));

    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type: "invite" });
    expect(res.headers.get("location")).toBe("/team");
  });

  it("rejects an unallowlisted `type` without ever calling verifyOtp", async () => {
    // `type` is attacker-controlled on a PUBLIC, session-establishing route.
    // `recovery` has different semantics (password reset) and must never be
    // accepted here, however Supabase's own server would resolve it.
    const res = await GET(req("?token_hash=abc&type=recovery&next=/team"));

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("/login?oauth=invite_expired");
  });
});
