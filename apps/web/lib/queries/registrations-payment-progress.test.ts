import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TableParams } from "@/lib/table-params";

const { rpc, listData } = vi.hoisted(() => ({ rpc: vi.fn(), listData: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc,
    from: () => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "range", "or"]) builder[method] = () => builder;
      builder.then = (resolve: (value: unknown) => unknown) => resolve(listData());
      return builder;
    },
  }),
}));
import { listEventRegistrations } from "./registrations";

const params: TableParams = { page: 1, per: 25, sort: [], filters: {}, q: "" };
const opts = { includeEmails: false, includeAddons: false };
const processing = { booking_order_id: "order-1", attempt_id: "attempt-1", state: "processing",
  received_at: "2026-10-16T06:25:00Z", attempts: 2, last_error_code: "42703", last_attempt_at: null };

beforeEach(() => {
  rpc.mockReset(); listData.mockReset();
  listData.mockReturnValue({ error: null, count: 4, data: [
    { id: "r1", booking_order_id: "order-1" }, { id: "r2", booking_order_id: "order-1" },
    { id: "r3", booking_order_id: "order-2" }, { id: "r4", booking_order_id: null },
  ] });
});

describe("registration payment progress", () => {
  it("batches unique order IDs and attaches receipts only to the matching registrations", async () => {
    rpc.mockResolvedValue({ data: [processing], error: null });
    const { rows } = await listEventRegistrations("event-1", params, opts);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("booking_payment_progress", { p_orders: ["order-1", "order-2"] });
    expect(rows[0].payment_progress).toEqual(processing);
    expect(rows[1].payment_progress).toEqual(processing);
    expect(rows[2].payment_progress).toBeNull();
    expect(rows[3].payment_progress).toBeNull();
    expect(rows.every(row => !row.payment_progress_unavailable)).toBe(true);
  });

  it("marks failed progress reads as unavailable instead of asserting no payment exists", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
    const { rows } = await listEventRegistrations("event-1", params, opts);
    expect(rows.slice(0, 3).every(row => row.payment_progress_unavailable)).toBe(true);
    expect(rows[3].payment_progress_unavailable).toBe(false);
    expect(rows.every(row => row.payment_progress == null)).toBe(true);
  });
});
