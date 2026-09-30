import { expect, it } from "vitest";
import { discountInputSchema, discountUnits } from "./discounts";
it("parses exact decimal percentage and peso values", () => {
  expect(discountUnits("0.29")).toBe(29);
  expect(discountUnits("100")).toBe(10000);
  for (const v of ["-1", "NaN", "1.001", "1e3", "21474836.48"])
    expect(discountUnits(v)).toBeNull();
});
it("validates limits and compares dates by instant, including different offsets", () => {
  const base = {
    kind: "regular",
    code: "trail20",
    discount_type: "percent",
    value: 2000,
    coverage: "entry",
    scope: "organization",
  };
  expect(discountInputSchema.parse(base).code).toBe("TRAIL20");
  for (const extra of [
    { value: 10001 },
    { max_uses: 0 },
    { absorb_fees: true },
    { scope: "events" },
  ])
    expect(discountInputSchema.safeParse({ ...base, ...extra }).success).toBe(
      false,
    );
  expect(
    discountInputSchema.safeParse({
      ...base,
      starts_at: "2026-10-01T10:00:00+08:00",
      ends_at: "2026-10-01T03:00:00Z",
    }).success,
  ).toBe(true);
});
