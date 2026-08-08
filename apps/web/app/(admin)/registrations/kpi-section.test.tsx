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
    expect(screen.getByText("50.0% conversion")).toBeInTheDocument();
    expect(screen.getByText("₱4,800")).toBeInTheDocument();
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

    expect(screen.getAllByText("₱0").length).toBe(2);
    expect(screen.getByText("0.0% conversion")).toBeInTheDocument();
  });
});
