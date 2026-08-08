import { describe, it, expect, vi, beforeEach } from "vitest";

const getMyRoles = vi.fn();
const listPayoutStatements = vi.fn();
const listOpenableEvents = vi.fn();
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("@/lib/queries/roles", () => ({ getMyRoles: () => getMyRoles() }));
vi.mock("@/lib/queries/payouts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/payouts")>();
  return {
    ...actual,
    listPayoutStatements: () => listPayoutStatements(),
    listOpenableEvents: () => listOpenableEvents(),
  };
});
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));

import PayoutsPage from "./page";

function roles(overrides: Partial<{ isSuperAdmin: boolean; capabilities: string[] }> = {}) {
  return {
    role: "admin", isAdmin: true, isOrgAdmin: true, orgId: "a1",
    isSuperAdmin: false, capabilities: ["manage_org", "check_in"],
    ...overrides,
  };
}

beforeEach(() => {
  getMyRoles.mockReset();
  listPayoutStatements.mockReset().mockResolvedValue([]);
  listOpenableEvents.mockReset().mockResolvedValue([]);
  notFound.mockClear();
});

describe("PayoutsPage", () => {
  // payouts/page.tsx:53-59 spells out why this 404s rather than rendering an
  // explanatory notice: an org admin must not learn other organizations'
  // settlements even exist. If the gate regressed from a capability check
  // back to `roles?.isOrgAdmin` — which this fixture also satisfies — the
  // 404 disappears and every org's payout statements (money owed to every
  // OTHER organizer) become readable.
  it("404s an org admin who is not a super admin, and never queries payout data", async () => {
    getMyRoles.mockResolvedValue(roles({ isSuperAdmin: false, capabilities: ["manage_org", "manage_team", "check_in"] }));
    await expect(PayoutsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
    expect(listPayoutStatements).not.toHaveBeenCalled();
    expect(listOpenableEvents).not.toHaveBeenCalled();
  });

  it("does not 404 a super admin, and lets the payout queries run", async () => {
    getMyRoles.mockResolvedValue(roles({ isSuperAdmin: true, capabilities: ["manage_platform", "manage_team", "manage_org", "check_in"] }));
    await expect(PayoutsPage()).resolves.toBeTruthy();
    expect(notFound).not.toHaveBeenCalled();
    expect(listPayoutStatements).toHaveBeenCalled();
    expect(listOpenableEvents).toHaveBeenCalled();
  });
});
