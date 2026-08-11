/** Keys must match METHOD_MAP in supabase/functions/payment-session/index.ts —
 *  it rejects anything else. Maya is "paymaya" to PayMongo; the function maps it. */
export const PAY_METHODS = [
  { key: "card", label: "Card" },
  { key: "gcash", label: "GCash" },
  { key: "maya", label: "Maya" },
];

export const POLL_MS = 3000;
export const TIMEOUT_MS = 90_000;

export function breakdown(total: number, basePrice: number | null): { entry: number; addons: number } {
  const entry = basePrice ?? total;
  return { entry, addons: Math.max(0, total - entry) };
}

/** A site method key -> the `processor_rates.method` that prices it.
 *
 *  MIRRORS METHOD_MAP in supabase/functions/payment-session/index.ts, which is
 *  where the same translation decides what is actually charged. Maya is
 *  "paymaya" to PayMongo and therefore to the rate card; looking a rate up under
 *  "maya" finds nothing, and nothing is indistinguishable here from "this method
 *  has no published price". */
export const RATE_METHOD: Record<string, string> = { card: "card", gcash: "gcash", maya: "paymaya" };

/** One method's price, VAT-INCLUSIVE, as stored on `processor_rates`.
 *  `percent_bps` is basis points (350 = 3.50%) so the arithmetic below stays in
 *  integers — a float rate reintroduces exactly the drift the centavo maths
 *  exists to avoid. Mirrors `ProcessorRate` in
 *  supabase/functions/_shared/processorFee.ts. */
export type ProcessorRate = { percent_bps: number; fixed_cents: number };

/** The fee half of an organization's terms, as stored on `organizations`.
 *  Mirrors `FeeTerms` in supabase/functions/_shared/fee.ts. */
export type FeeTerms = {
  commission_type: string;
  commission_rate: number | null;
  commission_flat_cents: number;
};

/**
 * The platform's commission on ONE registration, in centavos.
 *
 * A LINE-FOR-LINE PORT of `computeFee` in `supabase/functions/_shared/fee.ts`
 * (and identical to `feeOn` in apps/web/lib/commission-terms.ts, which ports it
 * for the organizer side). It must stay one: in pass-on mode this decides the
 * "Race Pace service fee" line the runner is shown, and `computeFee` decides the
 * one they are charged.
 *
 * ALL THREE TERMS MATTER. Reading only `fee_mode` and assuming a percentage
 * would send a `fixed`-commission org down the percent branch and its 10%
 * default — quoting a ₱200 fee where the org's terms are ₱75, with nothing on
 * screen to indicate it.
 *
 * The clamp is not decoration: a flat fee above the entry price would otherwise
 * make the derived processing line negative to keep the total honest.
 */
export function feeOn(total: number, terms: FeeTerms): number {
  if (total <= 0) return 0;
  if (terms.commission_type === "fixed") {
    return Math.min(terms.commission_flat_cents, total);
  }
  const rate = terms.commission_rate ?? 0.10;
  return Math.min(Math.round(total * rate), total);
}

/**
 * The itemised lines a pass-on runner sees, and the total they will be charged.
 *
 * DISPLAY ONLY. `payment-session` recomputes the authoritative amount
 * server-side when the runner actually pays; this exists so the screen can show
 * the total BEFORE that call, and so it moves when they switch payment method.
 * Never send this number to a provider.
 *
 * DELIBERATE DUPLICATE of `passOnBreakdown` in
 * supabase/functions/_shared/processorFee.ts. apps/site cannot import from
 * supabase/functions — different runtime, different tsconfig, no path alias — so
 * the formula is written twice on purpose, structured the same way (a private
 * `grossUp` standing in for `grossUpCharge`) so the two diff cleanly.
 *
 * THE DUPLICATION IS PINNED, not merely documented: supabase/tests/processor-fee.test.ts
 * imports THIS module — the root vitest config runs `supabase/**` under node and
 * this file has no imports of its own — and fuzzes the two implementations
 * against each other over the whole rate/base/commission grid. Divergence is a
 * red test, not a comment asking the next person to be careful.
 *
 * THE GROSS-UP IS NOT ADDITION. The processor charges its percentage on the
 * FINAL amount, so adding a fee to the base under-collects on every payment:
 *
 *   total = ceil((base + platformFee + fixed) * 10000 / (10000 - percent_bps))
 *
 * written with a *10000 numerator so it is integer division throughout. `ceil`
 * puts the sub-centavo remainder on the organizer's side — at most ₱0.01 over,
 * never a shortfall.
 *
 * The processor line is DERIVED (`total - base - platformFee`) rather than
 * predicted independently, so the three lines always sum to the total. That is
 * not cosmetic: PayMongo computes the amount it charges FROM the line items, so
 * lines summing to something else are a different charge, not a different
 * display. The derived line therefore reads up to ₱0.01 above what the processor
 * really takes (₱31.38 vs ₱31.37 on a ₱2,000 GCash entry); the centavo survives
 * the cut and lands in the organizer's net.
 */
export function passOnLines(
  baseTotal: number,
  platformFee: number,
  rate: ProcessorRate,
): { base: number; platformFee: number; processorFee: number; total: number } {
  const total = grossUp(baseTotal + platformFee, rate);
  return { base: baseTotal, platformFee, processorFee: total - baseTotal - platformFee, total };
}

/** The amount to charge so that exactly `target` survives the processor's cut —
 *  `grossUpCharge` in supabase/functions/_shared/processorFee.ts, line for line.
 *
 *  The guard is on the TARGET, not on the base: a free entry carrying a flat
 *  commission still has something to gross up, and guarding on `baseTotal <= 0`
 *  instead would silently return zeros where the server charges ₱77.73. */
function grossUp(target: number, rate: ProcessorRate): number {
  if (target <= 0) return 0;
  if (rate.percent_bps >= 10000) {
    // At exactly 100% this divides by zero; above it the total comes out
    // negative. Refusing leaves the screen with no breakdown to show, which is
    // the honest rendering of a method that cannot be priced — quoting a
    // negative or infinite total is not.
    throw new Error(`processor rate of ${rate.percent_bps}bps is not chargeable`);
  }
  return Math.ceil(((target + rate.fixed_cents) * 10000) / (10000 - rate.percent_bps));
}
