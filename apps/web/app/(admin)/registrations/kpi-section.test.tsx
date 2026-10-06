import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { parseTableParams } from "@/lib/table-params";

const getRegistrationAggregates = vi.hoisted(() => vi.fn());
const getEventRegistrationGross = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queries/registrations", () => ({ getRegistrationAggregates, getEventRegistrationGross }));

import { RegistrationsKpiSection } from "./kpi-section";

beforeEach(() => {
  getRegistrationAggregates.mockReset();
  getEventRegistrationGross.mockReset();
  getEventRegistrationGross.mockResolvedValue(0);
});

describe("RegistrationsKpiSection", () => {
  it("renders the cards from the aggregates reader, scoped to the given event and filters", async () => {
    getEventRegistrationGross.mockResolvedValue(650000);
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
    expect(screen.getByText("Retained gross")).toBeInTheDocument();
    expect(screen.getByText("Gross Registration")).toBeInTheDocument();
    expect(screen.getByText("₱6,500")).toBeInTheDocument();
    expect(screen.getByText("Whole event · before fees/refunds")).toBeInTheDocument();
    expect(screen.getByText("₱4,800")).toBeInTheDocument();
    expect(screen.getByText("Refunds")).toBeInTheDocument();
    expect(screen.getByText("₱1,200")).toBeInTheDocument();
    expect(screen.getByText("1 refunded registration")).toBeInTheDocument();
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
    expect(screen.getAllByText("₱0").length).toBe(3);
    expect(screen.getByText("0 refunded registrations")).toBeInTheDocument();
  });

  it("keeps whole-event gross when table search, status, category or pagination exclude sales", async () => {
    getRegistrationAggregates.mockResolvedValue({
      total: 0, paid: 0, grossCents: 0, refundCount: 0, refundedCents: 0, newThisWeek: 0,
    });
    getEventRegistrationGross.mockResolvedValue(619797);
    const params = parseTableParams({ q: "nobody", status: "pending", category: "cat-2", page: "3" });
    render(await RegistrationsKpiSection({ eventId: "ev-2", params }));
    expect(getRegistrationAggregates).toHaveBeenCalledWith("ev-2", params);
    expect(getEventRegistrationGross).toHaveBeenCalledWith("ev-2");
    expect(screen.getByText("₱6,197.97")).toBeInTheDocument();
  });

  it("shows Unavailable when event gross cannot be read instead of implying zero sales", async () => {
    getRegistrationAggregates.mockResolvedValue({
      total: 0, paid: 0, grossCents: 0, refundCount: 0, refundedCents: 0, newThisWeek: 0,
    });
    getEventRegistrationGross.mockResolvedValue(null);
    render(await RegistrationsKpiSection({ eventId: "ev-1", params: parseTableParams({}) }));
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getAllByText("₱0")).toHaveLength(2);
  });
});
