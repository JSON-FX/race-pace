import { describe, it, expect, vi, beforeEach } from "vitest";

const getMyRoles = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});
const getUser = vi.fn();

vi.mock("@/lib/queries/roles", () => ({ getMyRoles: () => getMyRoles() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => redirect(path) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: () => getUser() } }),
}));

import LoginPage from "./page";

function roles(capabilities: string[]) {
  return {
    role: capabilities.includes("manage_org") ? "admin" : capabilities.includes("check_in") ? "marshal" : null,
    orgId: "org-1", isSuperAdmin: false, isAdmin: capabilities.includes("manage_org"),
    isOrgAdmin: false, capabilities,
  };
}

beforeEach(() => {
  getMyRoles.mockReset();
  redirect.mockClear();
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "u1", email: "a@b.com" } } });
});

describe("LoginPage", () => {
  // The bug Fix 1 addresses: routing used to be a binary
  // `roles?.isAdmin ? "/events" : "/no-access"`, which sent a marshal
  // (isAdmin is false for marshal) to /no-access even though this branch's
  // whole point is to admit an authenticated caller into the console.
  it("sends a marshal-only account to /check-in, not /no-access", async () => {
    getMyRoles.mockResolvedValue(roles(["check_in"]));
    await expect(LoginPage()).rejects.toThrow("NEXT_REDIRECT:/check-in");
  });

  it("sends an editor to /events", async () => {
    getMyRoles.mockResolvedValue(roles(["manage_org", "check_in"]));
    await expect(LoginPage()).rejects.toThrow("NEXT_REDIRECT:/events");
  });

  it("sends a caller with no capabilities to /no-access", async () => {
    getMyRoles.mockResolvedValue(roles([]));
    await expect(LoginPage()).rejects.toThrow("NEXT_REDIRECT:/no-access");
  });
});
