import { beforeAll, describe, expect, it, vi } from "vitest";

let validateCreateInput: (input: {
  name: string; slug: string; admin_email: string;
  commission_type: string; commission_rate: number | null;
  commission_flat_cents: number; refund_policy: string; refund_fee_cents: number;
}) => string | null;

beforeAll(async () => {
  vi.stubGlobal("Deno", { serve: () => undefined });
  ({ validateCreateInput } = await import("../functions/org-provision/index.ts"));
});

describe("explicit pilot commission", () => {
  const base = {
    name: "Pilot organizer", slug: "pilot-organizer", admin_email: "qa@example.com",
    commission_type: "percent", commission_rate: 0.03,
    commission_flat_cents: 0, refund_policy: "full", refund_fee_cents: 0,
  };

  it("accepts an explicit zero percentage or fixed amount", () => {
    expect(validateCreateInput({ ...base, commission_rate: 0 })).toBeNull();
    expect(validateCreateInput({ ...base, commission_type: "fixed", commission_rate: null, commission_flat_cents: 0 })).toBeNull();
  });

  it("still rejects omitted and negative commercial terms", () => {
    expect(validateCreateInput({ ...base, commission_rate: null })).toBe("bad_commission");
    expect(validateCreateInput({ ...base, commission_rate: -0.01 })).toBe("bad_commission");
    expect(validateCreateInput({ ...base, commission_type: "fixed", commission_rate: null, commission_flat_cents: NaN })).toBe("bad_commission");
    expect(validateCreateInput({ ...base, commission_type: "fixed", commission_rate: null, commission_flat_cents: -1 })).toBe("bad_commission");
  });
});
