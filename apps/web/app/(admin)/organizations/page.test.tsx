import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

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
// Same reason as NewOrgDialog above: OrgActions is a Client Component that
// reaches for the browser Supabase client, and the Status column under test
// does not go through it.
vi.mock("./org-actions", () => ({ OrgActions: () => null }));

import OrganizationsPage from "./page";

function roles(overrides: Partial<{ isSuperAdmin: boolean; capabilities: string[] }> = {}) {
  return {
    role: "admin", isAdmin: true, isOrgAdmin: true, orgId: "a1",
    isSuperAdmin: false, capabilities: ["manage_org", "check_in"],
    ...overrides,
  };
}

function orgRow(overrides: Partial<{ id: string; name: string; slug: string; isActive: boolean }> = {}) {
  return {
    id: "o1", name: "Muspo", slug: "muspo", isActive: true,
    eventCount: 2, regCount: 40, grossRevenue: 100000, chargedGross: 100000,
    platformFee: 3000, netToOrg: 97000,
    commission_type: "percent" as const, commission_rate: 0.03, commission_flat_cents: 0,
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

  // Spec §11 lists this under Console tests and it was never written. The
  // Status column is the ONLY place the console shows that suspension took
  // effect — the row-actions menu flips to "Unsuspend" but that is inside a
  // dropdown nobody has open. A regression here would leave an operator who
  // just suspended an org with a list that looks unchanged.
  it("renders Suspended in the Status column for an inactive org, and Active for a live one", async () => {
    getMyRoles.mockResolvedValue(roles({ isSuperAdmin: true, capabilities: ["manage_platform"] }));
    getPlatformOrganizations.mockResolvedValue({
      rows: [
        orgRow({ id: "o1", name: "Muspo", slug: "muspo", isActive: true }),
        orgRow({ id: "o2", name: "Dormant Trails", slug: "dormant", isActive: false }),
      ],
      kpis: { orgCount: 2, activeCount: 1, gmvCents: 200000, commissionCents: 6000, owedCents: 0, openStatements: 0 },
    });

    render(await OrganizationsPage());

    const live = screen.getByText("Muspo").closest("tr")!;
    const suspended = screen.getByText("Dormant Trails").closest("tr")!;
    expect(within(live).getByText("Active")).toBeInTheDocument();
    expect(within(suspended).getByText("Suspended")).toBeInTheDocument();
  });
});
