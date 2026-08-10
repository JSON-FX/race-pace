import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { MyRoles } from "@/lib/queries/roles";

const { exchangeCodeForSessionMock, getMyRolesMock } = vi.hoisted(() => ({
  exchangeCodeForSessionMock: vi.fn(),
  getMyRolesMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: exchangeCodeForSessionMock },
  }),
}));

vi.mock("@/lib/queries/roles", () => ({ getMyRoles: getMyRolesMock }));

import { GET } from "./route";

function roles(overrides: Partial<MyRoles> = {}): MyRoles {
  return {
    role: "marshal",
    orgId: "org-1",
    isSuperAdmin: false,
    isAdmin: false,
    isOrgAdmin: false,
    capabilities: ["check_in"],
    ...overrides,
  };
}

function callbackRequest(opts: { search?: string; cookie?: string } = {}): NextRequest {
  const url = `http://localhost/auth/callback${opts.search ?? "?code=abc123"}`;
  const headers = opts.cookie ? { cookie: opts.cookie } : undefined;
  return new NextRequest(url, headers ? { headers } : undefined);
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    exchangeCodeForSessionMock.mockReset().mockResolvedValue({ error: null });
    getMyRolesMock.mockReset();
  });

  // THE REGRESSION TEST. Before the fix, the callback had no capability
  // awareness at all: with no `next` cookie/param it fell through to
  // safeNextPath's hardcoded "/events" default regardless of who signed in.
  // A check_in-only (marshal) account landed on /events — a manage_org page
  // — which immediately bounced it to /no-access, so the account could never
  // reach the console. This must fail against the pre-fix code and pass
  // after: verified by running it before the fix landed (see the report).
  it("sends a check_in-only caller to /check-in when there is no explicit next", async () => {
    getMyRolesMock.mockResolvedValue(roles({ capabilities: ["check_in"] }));

    const res = await GET(callbackRequest());

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/check-in");
  });

  it("sends a manage_org caller to /events when there is no explicit next", async () => {
    getMyRolesMock.mockResolvedValue(roles({ capabilities: ["manage_org", "check_in"] }));

    const res = await GET(callbackRequest());

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/events");
  });

  it("sends a caller with no capabilities to /no-access when there is no explicit next", async () => {
    getMyRolesMock.mockResolvedValue(roles({ capabilities: [] }));

    const res = await GET(callbackRequest());

    expect(res.headers.get("location")).toBe("/no-access");
  });

  // A deep link ("someone was sent to /registrations?status=paid, signed in,
  // and should land there") is still honoured as-is — only the FALLBACK
  // became capability-aware. The destination page's own guard, not this
  // route, is what decides whether the account may actually stay there.
  it("still honors a valid explicit next from the OAuth-next cookie, regardless of capabilities", async () => {
    getMyRolesMock.mockResolvedValue(roles({ capabilities: ["check_in"] }));

    const res = await GET(
      callbackRequest({
        cookie: `rp_oauth_next_admin=${encodeURIComponent("/registrations?status=paid")}`,
      }),
    );

    expect(res.headers.get("location")).toBe("/registrations?status=paid");
  });

  it("still honors a valid explicit ?next= query param", async () => {
    getMyRolesMock.mockResolvedValue(roles({ capabilities: ["manage_org"] }));

    const res = await GET(callbackRequest({ search: "?code=abc123&next=%2Fsettings" }));

    expect(res.headers.get("location")).toBe("/settings");
  });

  it("falls back to the capability-aware home, not the raw next, for an unsafe explicit next", async () => {
    getMyRolesMock.mockResolvedValue(roles({ capabilities: ["check_in"] }));

    const res = await GET(callbackRequest({ search: "?code=abc123&next=https%3A%2F%2Fevil.com" }));

    expect(res.headers.get("location")).toBe("/check-in");
  });

  it("does not call getMyRoles at all when the code exchange fails", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: { message: "invalid code" } });

    const res = await GET(callbackRequest());

    expect(res.headers.get("location")).toBe("/login?oauth=failed");
    expect(getMyRolesMock).not.toHaveBeenCalled();
  });
});
