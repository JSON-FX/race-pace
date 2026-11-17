import { expect, it } from "vitest";
import { breakdown } from "@/lib/payment";
import { mapReg } from "@/lib/registration";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "r1", user_id: "u1", status: "pending", total_amount: 10_000,
  org_id: "o1", event_id: "e1", events: { name: "Race" },
  categories: { label: "5K", distance_km: 5, base_price: 1_000 },
  organizations: { name: "Org" }, payments: null, registration_addons: [],
  ...overrides,
});
it("does not invent add-ons when the live category price changed", () => {
  const mapped = mapReg(row());
  expect(mapped.basePrice).toBe(10_000);
  expect(breakdown(mapped.total_amount, mapped.basePrice)).toEqual({ entry: 10_000, addons: 0 });
});

it("uses the selected add-on price snapshots for the checkout breakdown", () => {
  const mapped = mapReg(row({
    registration_addons: [{ price: 500 }, { price: 1_000 }],
  }));
  expect(mapped.basePrice).toBe(8_500);
  expect(breakdown(mapped.total_amount, mapped.basePrice)).toEqual({ entry: 8_500, addons: 1_500 });
});

it("preserves the frozen Pay Later deadline and defaults older rows to ordinary payment", () => {
  expect(mapReg(row()).payLaterDueAt).toBeNull();
  const mapped = mapReg(row({ pay_later_grant_id: "g1", pay_later_due_at: "2027-02-21T16:00:00Z" }));
  expect(mapped.payLaterGrantId).toBe("g1");
  expect(mapped.payLaterDueAt).toBe("2027-02-21T16:00:00Z");
});
