import { describe, it, expect } from "vitest";
import { breakdown, PAY_METHODS } from "../payment";

describe("breakdown", () => {
  it("splits a total into entry fee and add-ons", () => {
    expect(breakdown(310000, 250000)).toEqual({ entry: 250000, addons: 60000 });
  });

  it("reports zero add-ons when the total equals the base price", () => {
    expect(breakdown(250000, 250000)).toEqual({ entry: 250000, addons: 0 });
  });

  // basePrice is null when the category embed is missing; the whole total is
  // then the entry fee rather than a negative add-on line.
  it("treats the whole total as entry fee when base price is unknown", () => {
    expect(breakdown(250000, null)).toEqual({ entry: 250000, addons: 0 });
  });

  // A category price cut after registration must never render as negative.
  it("never reports a negative add-on total", () => {
    expect(breakdown(200000, 250000).addons).toBe(0);
  });
});

describe("PAY_METHODS", () => {
  it("offers the three methods the payment-session function accepts", () => {
    expect(PAY_METHODS.map((m) => m.key)).toEqual(["card", "gcash", "maya"]);
  });
});
