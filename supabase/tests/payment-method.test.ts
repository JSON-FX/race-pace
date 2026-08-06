import { describe, it, expect } from "vitest";
import { pmMethodFromAttributes } from "../functions/_shared/paymongo.ts";

const payment = (type: string, status = "paid") => ({
  attributes: { status, source: { type } },
});

describe("pmMethodFromAttributes", () => {
  it("reads the instrument from a single payment", () => {
    expect(pmMethodFromAttributes({ payments: [payment("gcash")] })).toBe("gcash");
    expect(pmMethodFromAttributes({ payments: [payment("card")] })).toBe("card");
    expect(pmMethodFromAttributes({ payments: [payment("paymaya")] })).toBe("paymaya");
  });

  it("prefers the PAID payment over an earlier failed attempt", () => {
    // The bug in the old inline `payments[0]`: a runner whose card is declined
    // and who then pays with GCash would have been recorded as paying by card.
    const attrs = { payments: [payment("card", "failed"), payment("gcash", "paid")] };
    expect(pmMethodFromAttributes(attrs)).toBe("gcash");
  });

  it("falls back to the first payment when none is marked paid", () => {
    const attrs = { payments: [payment("maya", "pending")] };
    expect(pmMethodFromAttributes(attrs)).toBe("maya");
  });

  it("returns 'paymongo' when the shape is absent, rather than guessing", () => {
    // A known-unknown. Guessing "card" here would silently produce wrong data
    // that nobody could later distinguish from a real card payment.
    expect(pmMethodFromAttributes({})).toBe("paymongo");
    expect(pmMethodFromAttributes({ payments: [] })).toBe("paymongo");
    expect(pmMethodFromAttributes(null)).toBe("paymongo");
    expect(pmMethodFromAttributes(undefined)).toBe("paymongo");
    expect(pmMethodFromAttributes({ payments: [{ attributes: {} }] })).toBe("paymongo");
  });

  it("survives a non-array payments field", () => {
    expect(pmMethodFromAttributes({ payments: "nope" })).toBe("paymongo");
  });
});
