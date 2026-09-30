import { z } from "zod";
export const discountInputSchema = z
  .object({
    kind: z.enum(["regular", "special"]),
    code: z.string().trim().toUpperCase().optional(),
    discount_type: z.enum(["percent", "flat"]),
    value: z.number().int().positive().max(2147483647),
    coverage: z.enum(["entry", "subtotal"]),
    scope: z.enum(["organization", "events", "categories"]),
    event_ids: z.array(z.string().uuid()).max(100).default([]),
    category_ids: z.array(z.string().uuid()).max(500).default([]),
    max_uses: z
      .number()
      .int()
      .positive()
      .max(2147483647)
      .nullable()
      .default(null),
    quantity: z.number().int().min(1).max(500).default(1),
    absorb_fees: z.boolean().default(false),
    passport_ids: z.array(z.string().uuid()).max(500).default([]),
    starts_at: z.string().datetime({ offset: true }).nullable().default(null),
    ends_at: z.string().datetime({ offset: true }).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    const fail = (message: string, path: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] });
    if (
      v.kind === "regular" &&
      !/^[A-Z0-9][A-Z0-9_-]{3,39}$/.test(v.code ?? "")
    )
      fail("Use 4–40 letters, numbers, hyphens, or underscores.", "code");
    if (v.discount_type === "percent" && v.value > 10000)
      fail("Percentage cannot exceed 100%.", "value");
    if (
      (v.scope === "events" && !v.event_ids.length) ||
      (v.scope === "categories" && !v.category_ids.length)
    )
      fail("Select at least one eligible event or category.", "scope");
    if (
      v.starts_at &&
      v.ends_at &&
      Date.parse(v.ends_at) <= Date.parse(v.starts_at)
    )
      fail("End must be after start.", "ends_at");
    if (
      v.passport_ids.length &&
      (v.passport_ids.length !== v.quantity ||
        new Set(v.passport_ids).size !== v.quantity)
    )
      fail("Assign one different Passport per code.", "passport_ids");
    if (v.kind === "regular" && (v.absorb_fees || v.passport_ids.length))
      fail(
        "Fee absorption and Passport assignment require special codes.",
        "kind",
      );
  });
export type DiscountInput = z.infer<typeof discountInputSchema>;
export type DiscountQuote = {
  code: string | null;
  discount_cents: number;
  total_cents: number;
  snapshot: { fee_mode: "absorb" | "pass_on"; absorb_fees: boolean } | null;
};
export const DISCOUNT_ERRORS: Record<string, string> = {
  discount_invalid: "That code is not valid for this organizer.",
  discount_inactive: "This code is inactive, expired, or not yet available.",
  discount_ineligible: "This code does not apply to this event category.",
  discount_wrong_passport: "This code is assigned to a different Passport.",
  discount_already_used:
    "This Passport has already used or reserved this code.",
  discount_exhausted: "All uses of this code are taken.",
  discount_payment_locked:
    "Payment has already started. Close the existing checkout before changing a code.",
  discount_balance_too_small:
    "This discount leaves less than the minimum payment. Use a smaller discount or a fully free code.",
  discount_fees_exceed_balance:
    "The remaining amount cannot cover the included fees. Use a smaller discount or a fully free code.",
  discount_mixed_fee_modes:
    "Participants with fee-waived paid entries need a separate booking. Free entries can stay in either booking.",
  discount_rate_limited: "Too many attempts. Wait a minute, then try again.",
  discount_unavailable: "We could not apply this code. Please try again.",
};
/** Parse a decimal percentage/peso input without floating-point money math. */
export function discountUnits(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return result > 2147483647n ? null : Number(result);
}
