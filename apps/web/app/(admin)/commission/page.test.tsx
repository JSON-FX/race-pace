import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getMyRoles = vi.fn();
const getCommissionOverview = vi.fn();
const getRateDrift = vi.fn();
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("@/lib/queries/roles", () => ({ getMyRoles: () => getMyRoles() }));
vi.mock("@/lib/queries/commission", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/commission")>();
  return {
    ...actual,
    getCommissionOverview: () => getCommissionOverview(),
    getRateDrift: () => getRateDrift(),
  };
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
    commission: 0, gross: 0, charged_gross: 0, net_to_org: 0, paid_count: 0,
    refunded_cents: 0, refund_count: 0, unpaid_out_cents: 0,
  },
};

beforeEach(() => {
  getMyRoles.mockReset();
  getCommissionOverview.mockReset().mockResolvedValue(emptyOverview);
  getRateDrift.mockReset().mockResolvedValue([]);
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
    expect(getRateDrift).toHaveBeenCalled();
  });

  // The drift read is `security_invoker` over `payments`, so an org admin who
  // reached this page would get their OWN org's sample — a smaller leak than the
  // rate table beside it, but still a platform figure on a page that must not
  // exist for them. Gated by the same single check, and asserted so that a
  // future "fetch drift before the guard" refactor cannot slip it through.
  it("never queries drift for a non-super-admin", async () => {
    getMyRoles.mockResolvedValue(roles({ isSuperAdmin: false, capabilities: ["manage_org", "manage_team", "check_in"] }));
    await expect(CommissionPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getRateDrift).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * What the page actually says
 * ------------------------------------------------------------------ */

const SUPER = roles({
  isSuperAdmin: true,
  capabilities: ["manage_platform", "manage_team", "manage_org", "check_in"],
});

/** One org on 3% with a flat-fee refund policy, absorbing processing. The
 *  design's own worked example: a ₱2,000 GCash entry costs ₱60 in commission and
 *  ₱30 to the processor, so net_to_org is ₱1,910. */
const ORG = {
  id: "o1", name: "Muspo", since: null, fee_mode: "absorb" as const,
  commission_type: "percent", commission_rate: 0.03, commission_flat_cents: 0,
  refund_policy: "flat_fee", refund_fee_cents: 30000,
  event_count: 2, paid_count: 5, gross_revenue: 900000, charged_gross: 1000000,
  platform_fee: 30000, net_to_org: 917500, avg_entry_cents: 200000,
  cheapest_open: null, example_entry_cents: 200000, avg_processor_fee_cents: 3000,
};

async function renderPage() {
  getMyRoles.mockResolvedValue(SUPER);
  render(await CommissionPage());
}

describe("CommissionPage — the three-party surfaces", () => {
  it("renders one drift banner per flagged method, and does not claim a repricing", async () => {
    getRateDrift.mockResolvedValue([{
      method: "card", scope: "local", sample_size: 11, disagreeing: 11,
      median_implied_bps: 450, card_bps: 350, delta_cents: 22000, drifting: true,
    }]);
    await renderPage();

    expect(screen.getByText("Card payments are costing more than the rate card predicts.")).toBeInTheDocument();
    expect(screen.getByText(/11 of the last 11 Card payments came in higher than predicted/)).toBeInTheDocument();
    expect(screen.getByText(/under-collected ₱220 across those payments/)).toBeInTheDocument();
    // The sentence that keeps it from being a claim. `processor_rate_drift_v`
    // hardcodes scope='local', so an international card is sampled here at its
    // own higher rate and reads exactly like a rate change.
    expect(screen.getByText(/does not on its own mean the provider repriced/)).toBeInTheDocument();
  });

  it("says nothing at all when no method is drifting", async () => {
    getRateDrift.mockResolvedValue([]);
    await renderPage();
    expect(screen.queryByText(/rate card predicts/)).not.toBeInTheDocument();
  });

  it("offers the fee-mode control per organization, showing the saved mode", async () => {
    getCommissionOverview.mockResolvedValue({ ...emptyOverview, orgs: [ORG] });
    await renderPage();
    const control = screen.getByRole("combobox", { name: "Fee mode for Muspo" });
    expect(control).toHaveTextContent("Absorb · org pays fees");
  });

  // The refund worked example is the sentence an operator negotiates a refund
  // policy from, and it was quoting the rule this branch superseded: the runner
  // getting `entry - retained` back, and the retention split with Race Pace. Held
  // at the page level as well as in commission.test.ts because the defect was
  // that the SCREEN said it — a correct helper wired to a page that never passed
  // it a processor fee would read exactly as wrong.
  it("works the refund example from net_to_org, and gives the organizer the whole retention", async () => {
    getCommissionOverview.mockResolvedValue({ ...emptyOverview, orgs: [ORG] });
    await renderPage();

    expect(screen.getByText("A runner cancelling a ₱2,000 entry:")).toBeInTheDocument();
    expect(screen.getByText(/^Gets ₱1,610\.00 back\./)).toBeInTheDocument();
    expect(screen.getByText(/The organizer keeps the ₱300\.00 retained in full/)).toBeInTheDocument();
    expect(screen.getByText(/Race Pace keeps its ₱60\.00 commission and the processor keeps ₱30\.00/))
      .toBeInTheDocument();
    // The superseded arithmetic, in the two forms it took on this screen.
    expect(screen.queryByText(/₱1,700\.00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/is commission and .* goes to the organizer/)).not.toBeInTheDocument();
  });

  it("no longer tells the operator a retained fee is a smaller sale", async () => {
    // The strip under the refund table asserted the org's commission rule runs
    // against the retention. refund_registration_tx dropped the parameter that
    // made that possible (20260811094000), so it is the opposite of what happens.
    getCommissionOverview.mockResolvedValue({ ...emptyOverview, orgs: [ORG] });
    await renderPage();

    expect(screen.queryByText(/just a smaller sale/)).not.toBeInTheDocument();
    expect(screen.getByText(/A refund returns what the organizer would have been paid/)).toBeInTheDocument();
    expect(screen.getByText(/no commission is struck on a retention/)).toBeInTheDocument();
  });

  it("labels the charged figure as GMV throughout, never as bare 'Gross'", async () => {
    // Two different quantities on this console both start with "gross":
    // charged_gross (what runners paid) and gross_revenue (what survived
    // refunds, which the organizer Dashboard calls "Gross revenue"). This page
    // only ever shows the charged one, so it only ever uses the GMV vocabulary
    // — a bare "Gross" heading here is the collision.
    getCommissionOverview.mockResolvedValue({
      ...emptyOverview,
      orgs: [ORG],
      events: [{ event_id: "e1", event_name: "Trail 40", org_id: "o1", org_name: "Muspo", paid_count: 5, gross: 1000000, commission: 30000, charged: "3.0% each" }],
      totals: { ...emptyOverview.totals, charged_gross: 1000000, commission: 30000, paid_count: 5 },
    });
    await renderPage();

    expect(screen.queryByRole("columnheader", { name: "Gross" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("columnheader", { name: "GMV" }).length).toBe(2);
    expect(screen.getByText(/5 paid entries · charged, before refunds/)).toBeInTheDocument();
  });
});
