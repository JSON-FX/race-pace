import { describe, it, expect, vi, beforeEach } from "vitest";

const getMyRoles = vi.fn();
const getPlatformOrganizations = vi.fn();
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

// requireOrgId isn't used by this page, but roles.ts is mocked wholesale (as
// event/[id]/edit/page.test.tsx does) rather than partially — this page only
// needs getMyRoles.
vi.mock("@/lib/queries/roles", () => ({ getMyRoles: () => getMyRoles() }));
vi.mock("@/lib/queries/organizations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/organizations")>();
  return { ...actual, getPlatformOrganizations: () => getPlatformOrganizations() };
});
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));
// A Client Component (New-organization dialog) with no bearing on the
// authorization gate under test — stubbed so this file only needs to mock
// what the PAGE itself calls, not what a modal it renders would need.
vi.mock("./new-org-dialog", () => ({ NewOrgDialog: () => null }));

import OrganizationsPage from "./page";

function roles(overrides: Partial<{ isSuperAdmin: boolean; capabilities: string[] }> = {}) {
  return {
    role: "admin", isAdmin: true, isOrgAdmin: true, orgId: "a1",
    isSuperAdmin: false, capabilities: ["manage_org", "check_in"],
    ...overrides,
  };
}

const emptyOverview = {
  rows: [],
  kpis: { orgCount: 0, activeCount: 0, gmvCents: 0, commissionCents: 0, owedCents: 0, openStatements: 0 },
};

beforeEach(() => {
  getMyRoles.mockReset();
  getPlatformOrganizations.mockReset().mockResolvedValue(emptyOverview);
  notFound.mockClear();
});

describe("OrganizationsPage", () => {
  // The scope band's whole reason to exist (organizations/page.tsx:14-26) is
  // that this page shows EVERY org's data. An ordinary org admin reaching it
  // — e.g. because the gate regressed from a capability check back to
  // `roles?.isOrgAdmin`, which this exact roles() fixture also satisfies —
  // would read every organization's GMV and commission, not just their own.
  it("404s an org admin who is not a super admin, and never queries platform data", async () => {
    getMyRoles.mockResolvedValue(roles({ isSuperAdmin: false, capabilities: ["manage_org", "manage_team", "check_in"] }));
    await expect(OrganizationsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
    expect(getPlatformOrganizations).not.toHaveBeenCalled();
  });

  it("does not 404 a super admin, and lets the platform query run", async () => {
    getMyRoles.mockResolvedValue(roles({ isSuperAdmin: true, capabilities: ["manage_platform", "manage_team", "manage_org", "check_in"] }));
    await expect(OrganizationsPage()).resolves.toBeTruthy();
    expect(notFound).not.toHaveBeenCalled();
    expect(getPlatformOrganizations).toHaveBeenCalled();
  });
});
