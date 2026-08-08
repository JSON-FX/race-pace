import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { parseTableParams } from "@/lib/table-params";

const getRegistrationAggregates = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queries/registrations", () => ({ getRegistrationAggregates }));

import { RegistrationsKpiSection } from "./kpi-section";

beforeEach(() => getRegistrationAggregates.mockReset());

describe("RegistrationsKpiSection", () => {
  it("renders the cards from the aggregates reader, scoped to the given event and filters", async () => {
    getRegistrationAggregates.mockResolvedValue({
      total: 4, paid: 2, grossCents: 480000, refundCount: 1, refundedCents: 120000, newThisWeek: 2,
    });
    const params = parseTableParams({}, { sort: [], filters: { status: "all", category: "all" } });

    render(await RegistrationsKpiSection({ eventId: "ev-1", params }));

    expect(getRegistrationAggregates).toHaveBeenCalledWith(
      "ev-1",
      expect.objectContaining({ filters: expect.objectContaining({ status: "all", category: "all" }) }),
    );
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("+2 this week")).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("50.0% conversion")).toBeInTheDocument();
    expect(screen.getByText("Gross revenue")).toBeInTheDocument();
    expect(screen.getByText("₱4,800")).toBeInTheDocument();
    expect(screen.getByText("Refunds")).toBeInTheDocument();
    expect(screen.getByText("₱1,200")).toBeInTheDocument();
    // "1 request", NOT "1 request · 0 pending" — there is no refund-approval
    // queue backing a pending count, so asserting "0 pending" would claim an
    // answer the system doesn't have. See IMPORTANT 3 in the V2 review. (The
    // page header subtitle DOES say "pending payment" — that's the org-wide
    // payment_status='pending' count, a real query, not the same "no data"
    // case as the refund queue.)
    expect(screen.getByText("1 request")).toBeInTheDocument();
  });

  // Pins the degrade-gracefully posture: getRegistrationAggregates returns
  // zeroes rather than throwing when the RPC fails, and the row must render
  // those zeroes rather than collapsing to nothing.
  it("renders zeroed cards, not a blank row, when the filtered set is empty", async () => {
    getRegistrationAggregates.mockResolvedValue({
      total: 0, paid: 0, grossCents: 0, refundCount: 0, refundedCents: 0, newThisWeek: 0,
    });
    const params = parseTableParams({}, { sort: [], filters: { status: "all", category: "all" } });

    render(await RegistrationsKpiSection({ eventId: "ev-1", params }));

    expect(screen.getByText("+0 this week")).toBeInTheDocument();
    expect(screen.getByText("0.0% conversion")).toBeInTheDocument();
    expect(screen.getAllByText("₱0").length).toBe(2);
    // Refunds delta stays "0 requests" (not "0 requests · 0 pending" — no
    // refund-approval queue exists to answer that question, see the test
    // above). The header subtitle's "0 pending payment" is a different,
    // real figure (org-wide payment_status='pending' count) and lives in
    // page.test.tsx, not here.
    expect(screen.getByText("0 requests")).toBeInTheDocument();
  });
});
