import { paymentMethodLabel, todayIsoNow } from "../lib/format";

describe("paymentMethodLabel", () => {
  it("maps known PayMongo methods to display labels", () => {
    expect(paymentMethodLabel("card")).toBe("Card");
    expect(paymentMethodLabel("gcash")).toBe("GCash");
    expect(paymentMethodLabel("maya")).toBe("Maya");
    expect(paymentMethodLabel("paymaya")).toBe("Maya");
  });
  it("falls back to a dash when the method is missing", () => {
    expect(paymentMethodLabel(null)).toBe("—");
    expect(paymentMethodLabel(undefined)).toBe("—");
  });
  it("passes through an unknown method verbatim", () => {
    expect(paymentMethodLabel("grab_pay")).toBe("grab_pay");
  });
});

describe("todayIsoNow", () => {
  afterEach(() => jest.useRealTimers());
  it("returns the pinned local date as YYYY-MM-DD", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-23T09:00:00"));
    expect(todayIsoNow()).toBe("2026-07-23");
  });
});
