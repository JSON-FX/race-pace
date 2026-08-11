import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

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

/* ------------------------------------------------------------------ *
 * The rendered breakdown
 * ------------------------------------------------------------------ */

const superAdmin = () => roles({
  isSuperAdmin: true,
  capabilities: ["manage_platform", "manage_team", "manage_org", "check_in"],
});

/** Five paid ₱2,000 card entries: Race Pace's 6% is ₱600 each, the processor
 *  takes ₱105 each, the organizer is owed ₱1,295 each. */
const READY = {
  id: "s1", event_id: "e1", org_id: "o1", event_name: "Dumalinao Trail 40", org_name: "Muspo",
  event_date: "2026-01-05", end_date: null, event_status: "completed",
  gross_cents: 1000000, commission_cents: 60000, processing_cents: 52500,
  refunds_in_period_cents: 0, refunds_cents: 0, net_owed_cents: 887500,
  status: "open" as const, reference: null, note: null,
  opened_at: "2026-01-08T00:00:00Z", paid_at: null, event_finished: true,
};

/** The same event a fortnight later: nothing new sold, and one entry that the
 *  first statement already paid out has since been refunded. */
const CLAWBACK = {
  ...READY, id: "s2",
  gross_cents: 0, commission_cents: 0, processing_cents: 0,
  refunds_in_period_cents: 0, refunds_cents: 177500, net_owed_cents: -177500,
};

/** The money cells of the one data row, left to right: the five terms and the
 *  net owed they have to reach. Read off the ROW, not off the document —
 *  the same peso figure also appears in the KPI tile and the scope band, and a
 *  bare getByText would match whichever came first. */
async function moneyRow(rows: (typeof READY)[]) {
  getMyRoles.mockResolvedValue(superAdmin());
  listPayoutStatements.mockResolvedValue(rows);
  render(await PayoutsPage());
  const tr = screen.getAllByRole("row")[1];
  return within(tr).getAllByRole("cell").slice(2, 8).map((c) => c.textContent);
}

describe("the payout breakdown reads left to right", () => {
  it("prints all five deductions, and they reach the net owed", async () => {
    // ₱10,000 − ₱600 − ₱525 − ₱0 − ₱0 = ₱8,875. Before Task 13 the table showed
    // gross, commission and refunds only, so the processor's ₱525 was missing
    // and the printed row landed ₱525 above the figure beside it.
    expect(await moneyRow([READY])).toEqual([
      "₱10,000", "−₱600", "−₱525", "₱0", "₱0", "₱8,875",
    ]);
  });

  it("keeps a clawback in its own column so a negative statement still adds up", async () => {
    // THE CASE FOUR TERMS CANNOT RENDER. Everything the statement earned is
    // zero and the whole figure is a recovery of money an earlier statement
    // paid out. Folded into "refunds" — or omitted — this row prints ₱0 beside
    // a net owed of −₱1,775.
    expect(await moneyRow([CLAWBACK])).toEqual([
      "₱0", "₱0", "₱0", "₱0", "−₱1,775", "−₱1,775owed back",
    ]);
  });

  it("says nothing about reconciliation while every statement reconciles", async () => {
    getMyRoles.mockResolvedValue(superAdmin());
    listPayoutStatements.mockResolvedValue([READY, CLAWBACK]);
    render(await PayoutsPage());
    expect(screen.queryByText(/do(es)? not add up/)).not.toBeInTheDocument();
  });

  it("names a statement whose own lines do not explain its net owed", async () => {
    // Not expected to fire — `statementResidual` documents why the five columns
    // are exhaustive — but a table somebody keys a bank transfer from must say
    // so rather than print numbers that quietly disagree.
    getMyRoles.mockResolvedValue(superAdmin());
    listPayoutStatements.mockResolvedValue([{ ...READY, net_owed_cents: 900000 }]);
    render(await PayoutsPage());
    expect(screen.getByText(/does not add up/)).toBeInTheDocument();
    expect(screen.getByText(/Dumalinao Trail 40 \(₱125 unexplained\)/)).toBeInTheDocument();
  });
});
