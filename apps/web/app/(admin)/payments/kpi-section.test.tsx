import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { parseTableParams } from "@/lib/table-params";

const getPaymentAggregates = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queries/payments", () => ({ getPaymentAggregates }));

import { PaymentsKpiSection } from "./kpi-section";

beforeEach(() => getPaymentAggregates.mockReset());

describe("PaymentsKpiSection", () => {
  it("renders the cards from the aggregates reader, scoped to the same org and filters as the table", async () => {
    getPaymentAggregates.mockResolvedValue({ grossCents: 600000, feeCents: 30000, netCents: 456000, refundedCents: 120000 });
    const params = parseTableParams({}, { sort: [], filters: { status: "all", method: "all", event: "all" } });

    render(await PaymentsKpiSection({ orgId: "org-1", params }));

    expect(getPaymentAggregates).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ filters: expect.objectContaining({ status: "all", method: "all" }) }),
    );

    expect(screen.getByText("Gross")).toBeInTheDocument();
    expect(screen.getByText("₱6,000")).toBeInTheDocument();
    expect(screen.getByText("Platform fees")).toBeInTheDocument();
    expect(screen.getByText("₱300")).toBeInTheDocument();
    expect(screen.getByText("Net to org")).toBeInTheDocument();
    // Deliberately not amount - fee (₱5,700): proves the section renders
    // whatever getPaymentAggregates returns for net rather than recomputing it.
    expect(screen.getByText("₱4,560")).toBeInTheDocument();
    expect(screen.getByText("Refunded")).toBeInTheDocument();
    expect(screen.getByText("₱1,200")).toBeInTheDocument();
  });

  // Pins the degrade-gracefully posture: getPaymentAggregates returns zeroes
  // rather than throwing when the RPC fails, and the row must render those
  // zeroes rather than collapsing to nothing.
  it("renders zeroed cards, not a blank row, when the filtered set is empty", async () => {
    getPaymentAggregates.mockResolvedValue({ grossCents: 0, feeCents: 0, netCents: 0, refundedCents: 0 });
    const params = parseTableParams({}, { sort: [], filters: { status: "all", method: "all", event: "all" } });

    render(await PaymentsKpiSection({ orgId: "org-1", params }));

    expect(screen.getAllByText("₱0").length).toBe(4);
  });
});
