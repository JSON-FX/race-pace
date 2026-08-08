import { describe, it, expect, vi, beforeEach } from "vitest";

const getMyRoles = vi.fn();
const getCommissionOverview = vi.fn();
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("@/lib/queries/roles", () => ({ getMyRoles: () => getMyRoles() }));
vi.mock("@/lib/queries/commission", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/commission")>();
  return { ...actual, getCommissionOverview: () => getCommissionOverview() };
});
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));

import CommissionPage from "./page";

function roles(overrides: Partial<{ isSuperAdmin: boolean; capabilities: string[] }> = {}) {
  return {
    role: "admin", isAdmin: true, isOrgAdmin: true, orgId: "a1",
    isSuperAdmin: false, capabilities: ["manage_org", "check_in"],
    ...overrides,
  };
}

const emptyOverview = {
  orgs: [],
  events: [],
  totals: {
    commission: 0, gross: 0, net_to_org: 0, paid_count: 0,
    refunded_cents: 0, refund_count: 0, unpaid_out_cents: 0,
  },
};

beforeEach(() => {
  getMyRoles.mockReset();
  getCommissionOverview.mockReset().mockResolvedValue(emptyOverview);
  notFound.mockClear();
});

describe("CommissionPage", () => {
  // Commission is unscoped by org by design (commission.ts's getCommissionOverview
  // doc comment: "the page's subject IS the comparison between orgs"). An org
  // admin let through here — e.g. by a gate that regressed to `roles?.isOrgAdmin`,
  // which this fixture also satisfies — sees every organization's rates and
  // earnings, not just their own.
  it("404s an org admin who is not a super admin, and never queries commission data", async () => {
    getMyRoles.mockResolvedValue(roles({ isSuperAdmin: false, capabilities: ["manage_org", "manage_team", "check_in"] }));
    await expect(CommissionPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
    expect(getCommissionOverview).not.toHaveBeenCalled();
  });

  it("does not 404 a super admin, and lets the commission query run", async () => {
    getMyRoles.mockResolvedValue(roles({ isSuperAdmin: true, capabilities: ["manage_platform", "manage_team", "manage_org", "check_in"] }));
    await expect(CommissionPage()).resolves.toBeTruthy();
    expect(notFound).not.toHaveBeenCalled();
    expect(getCommissionOverview).toHaveBeenCalled();
  });
});
