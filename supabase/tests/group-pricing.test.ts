import { expect, it } from "vitest";
import { allocateCents, quoteGroup, type GroupFeeTerms } from "../functions/_shared/groupPricing";
const terms: GroupFeeTerms = { fee_mode: "pass_on", commission_type: "fixed", commission_flat_cents: 1000, commission_bps: 300 };
const rate = { percent_bps: 350, fixed_cents: 1500 };
it("charges the processor fixed fee once and commission per paid entry", () => {
  const q = quoteGroup([{ id: "a", base_cents: 100000 }, { id: "b", base_cents: 100000 }], terms, rate);
  expect(q.platform_fee_cents).toBe(2000);
  expect(q.gross_cents).toBe(Math.ceil((202000 + 1500) * 10000 / 9650));
  expect(q.gross_cents).toBeLessThan(2 * quoteGroup([{ id: "a", base_cents: 100000 }], terms, rate).gross_cents);
});
it("supports zero-commission pilots and free orders", () => {
  for (const fee_mode of ["absorb", "pass_on"] as const) {
    const q = quoteGroup([{ id: "a", base_cents: 100000 }], { ...terms, fee_mode, commission_flat_cents: 0 }, rate);
    expect(q.platform_fee_cents).toBe(0);
    const free = quoteGroup([{ id: "a", base_cents: 0 }, { id: "b", base_cents: 0 }], { ...terms, fee_mode }, rate);
    expect(free.gross_cents).toBe(0); expect(free.processor_fee_predicted_cents).toBe(0); expect(free.platform_fee_cents).toBe(0);
  }
});
it("uses stable largest remainders, preserving totals after input reordering", () => {
  expect(Object.fromEntries(allocateCents(2, [{ id: "b", weight: 1 }, { id: "a", weight: 1 }, { id: "c", weight: 1 }]))).toEqual({ a: 1, b: 1, c: 0 });
  expect(() => allocateCents(1, [{ id: "a", weight: 0 }])).toThrow("zero_allocation_weight");
});
it("conserves every total across a deterministic range of fees and uneven entries", () => {
  for (let i = 0; i < 250; i++) {
    const lines = [{ id: "a", base_cents: i * 137 }, { id: "b", base_cents: 1 + i * 509 }, { id: "c", base_cents: 0 }];
    const t: GroupFeeTerms = { ...terms, fee_mode: i % 2 ? "absorb" : "pass_on", commission_type: i % 3 ? "fixed" : "percent", commission_bps: 333 };
    const q = quoteGroup(lines, t, rate), reversed = quoteGroup([...lines].reverse(), t, rate);
    for (const key of ["base_cents", "platform_fee_cents", "processor_surcharge_cents", "gross_cents", "processor_fee_predicted_cents", "net_to_org_predicted_cents"] as const) {
      expect(q.lines.reduce((n, line) => n + line[key], 0)).toBe(q[key]);
    }
    expect([...q.lines].sort((a, b) => a.registration_id.localeCompare(b.registration_id))).toEqual([...reversed.lines].sort((a, b) => a.registration_id.localeCompare(b.registration_id)));
    expect(q.lines.find((line) => line.registration_id === "c")!.gross_cents).toBe(0);
  }
});
it("rejects noninteger, negative, oversized and unchargeable inputs", () => {
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER]) expect(() => quoteGroup([{ id: "a", base_cents: value }], terms, rate)).toThrow();
  expect(() => quoteGroup([{ id: "a", base_cents: 2147483647 }], terms, rate)).toThrow("order_amount_too_large");
  expect(() => quoteGroup([{ id: "a", base_cents: 1 }], terms, { ...rate, percent_bps: 10000 })).toThrow();
});
