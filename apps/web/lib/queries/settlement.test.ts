import { beforeEach, describe, expect, it, vi } from "vitest";

let groupRows: Record<string, unknown>[] = [];
let legacyRows: Record<string, unknown>[] = [];
let categories: Record<string, unknown>[] = [];
let rates: Record<string, unknown>[] = [];
let groupError: { message: string } | null = null;
const ranges: number[] = [];
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async () => ({ data: 0, error: null }),
    from: (table: string) => {
      let start = 0;
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "order", "is"]) builder[method] = () => builder;
      builder.range = (from: number) => { start = from; if (table === "admin_group_allocations_v") ranges.push(from); return builder; };
      builder.maybeSingle = async () => ({ data: { name: "Race", org_id: "org", organizations: { name: "Organizer", fee_mode: "absorb" } }, error: null });
      builder.then = (resolve: (value: unknown) => unknown) => resolve({
        data: table === "admin_group_allocations_v" ? groupRows.slice(start, start + 1000)
          : table === "payments" ? legacyRows.slice(start, start + 1000)
          : table === "categories" ? categories : table === "processor_rates" ? rates : [],
        error: table === "admin_group_allocations_v" ? groupError : null,
      });
      return builder;
    },
  }),
}));
import { getEventSettlement } from "./settlement";
const allocation = { registration_id: "reg", full_name: "Managed Runner", category_label: "10K", paid_at: "2026-09-17", method: "card", amount: 10000, platform_fee: 100, processor_fee_cents: 200, net_to_org: 9700, status: "paid", refunded_amount: 0 };
beforeEach(() => { groupRows = [allocation]; legacyRows = []; categories = []; rates = []; groupError = null; ranges.length = 0; });
describe("group settlement read", () => {
  it("maps participant identity and allocated money, not a repeated capture", async () => {
    const result = await getEventSettlement("event");
    expect(result?.rows[0]).toMatchObject({ runner_name: "Managed Runner", gross_paid: 10000, net_to_org: 9700 });
    expect(result?.totals.net).toBe(9700);
  });
  it("keeps missing actual fees unknown and suppresses a net forecast", async () => {
    groupRows = [{ ...allocation, processor_fee_cents: null, net_to_org: null }];
    const result = await getEventSettlement("event");
    expect(result?.totals.processing).toBeNull();
    expect(result?.totals.net).toBeNull();
    expect(result?.projected).toBeNull();
  });
  it("reads across the provider row limit", async () => {
    groupRows = Array.from({ length: 1001 }, (_, i) => ({ ...allocation, registration_id: `reg-${i}` }));
    const result = await getEventSettlement("event");
    expect(result?.rows).toHaveLength(1001);
    expect(ranges).toEqual([0, 1000]);
  });
  it("refuses a settlement when group rows cannot be read", async () => {
    groupError = { message: "unavailable" };
    await expect(getEventSettlement("event")).rejects.toMatchObject(groupError);
  });
});


it("forecasts absorb-mode group-only sales using participant averages", async () => {
  categories = [{ slots_total: 3, slots_taken: 1 }];
  rates = [{ method: "gcash", scope: "local", percent_bps: 200, fixed_cents: 0, offered: true }];
  const result = await getEventSettlement("event");
  expect(result?.projected).toEqual({ low: 29100, high: 29100, remaining: 2 });
});
it("weights legacy and group entries equally and sorts the merged ledger by paid date", async () => {
  categories = [{ slots_total: 3, slots_taken: 2 }];
  rates = [{ method: "gcash", scope: "local", percent_bps: 200, fixed_cents: 0, offered: true }];
  legacyRows = [{ ...allocation, registration_id: "legacy", amount: 20000, platform_fee: 200,
    processor_fee_cents: 400, processor_fee_source: "actual", net_to_org: 19400,
    paid_at: "2026-09-18", created_at: "2026-09-18", registrations: null }];
  const result = await getEventSettlement("event");
  expect(result?.projected).toEqual({ low: 43650, high: 43650, remaining: 1 });
  expect(result?.rows.map(row => row.registration_id)).toEqual(["reg", "legacy"]);
});
