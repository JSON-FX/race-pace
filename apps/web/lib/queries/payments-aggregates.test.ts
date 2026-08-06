import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TableParams } from "@/lib/table-params";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: rpcMock }),
}));

import { getPaymentAggregates } from "./payments";

const params = (overrides: Partial<TableParams> = {}): TableParams => ({
  page: 1,
  per: 25,
  sort: [],
  filters: { status: "all", method: "all" },
  q: "",
  ...overrides,
});

describe("getPaymentAggregates", () => {
  beforeEach(() => rpcMock.mockReset());

  it("calls the RPC with the SAME org id and filters as the table query — filter parity is structural", async () => {
    rpcMock.mockResolvedValue({ data: [{ gross_cents: 0, fee_cents: 0, net_cents: 0, refunded_cents: 0 }], error: null });

    await getPaymentAggregates("org-1", params({ filters: { status: "paid", method: "gcash" }, q: "  cruz  " }));

    expect(rpcMock).toHaveBeenCalledWith("admin_payment_aggregates", {
      p_org_id: "org-1",
      p_status: "paid",
      p_method: "gcash",
      p_q: "cruz",
    });
  });

  it("passes net_to_org straight through — it must never be recomputed as amount minus fee client-side", async () => {
    // A row deliberately chosen so amount - fee !== net, to prove the reader
    // does not silently "fix" it — that would let the card disagree with the
    // ledger the moment a real-world adjustment makes the two diverge.
    rpcMock.mockResolvedValue({
      data: [{ gross_cents: 600000, fee_cents: 30000, net_cents: 555000, refunded_cents: 120000 }],
      error: null,
    });

    const result = await getPaymentAggregates("org-1", params());

    expect(result.netCents).toBe(555000);
    expect(result.netCents).not.toBe(result.grossCents - result.feeCents);
  });

  it("coerces bigint-as-string wire values to numbers", async () => {
    rpcMock.mockResolvedValue({
      data: [{ gross_cents: "600000", fee_cents: "30000", net_cents: "456000", refunded_cents: "120000" }],
      error: null,
    });

    const result = await getPaymentAggregates("org-1", params());

    expect(result).toEqual({ grossCents: 600000, feeCents: 30000, netCents: 456000, refundedCents: 120000 });
  });

  it("degrades to zeroed aggregates on query error rather than throwing", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    const result = await getPaymentAggregates("org-1", params());

    expect(result).toEqual({ grossCents: 0, feeCents: 0, netCents: 0, refundedCents: 0 });
  });

  it("returns zeroed aggregates (not blank) for a genuinely empty filtered set", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    const result = await getPaymentAggregates("org-1", params());

    expect(result).toEqual({ grossCents: 0, feeCents: 0, netCents: 0, refundedCents: 0 });
  });
});
