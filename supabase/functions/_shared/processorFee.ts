/** A processor's price for one payment method, VAT-INCLUSIVE.
 *
 *  `percent_bps` is basis points: 350 = 3.50%. Basis points rather than a float
 *  rate so the whole calculation stays in integer arithmetic — a float rate
 *  reintroduces exactly the rounding drift this module exists to avoid. */
export interface ProcessorRate {
  percent_bps: number;
  fixed_cents: number;
}

/**
 * What the rate card says a payment of `amount` will cost, in centavos.
 *
 * PREDICTION ONLY. The ledger never uses this — it reads the provider's own
 * reported fee. This feeds the pass-on surcharge and the estimates shown to
 * humans, which are the only two surfaces a stale rate can affect.
 */
export function predictProcessorFee(amount: number, rate: ProcessorRate): number {
  if (amount <= 0) return 0;
  return Math.round((amount * rate.percent_bps) / 10000) + rate.fixed_cents;
}

/**
 * The amount to charge so that exactly `target` survives the processor's cut.
 *
 * THE GROSS-UP IS NOT OPTIONAL. PayMongo charges its percentage on the FINAL
 * amount, so adding the fee to the base under-collects on every transaction:
 * for a ₱2,060 target on a card, naive addition charges ₱2,147.10 and lands
 * ₱3.16 short, forever, silently.
 *
 *   charge = ceil((target + fixed) / (1 - rate))
 *
 * Expressed with a *10000 numerator so it is integer division throughout.
 *
 * `ceil` rather than `round`: it puts the sub-centavo remainder on the
 * organizer's side of the split — at most ₱0.01 per transaction, and never a
 * shortfall. Rounding down would make roughly half of all payments a penny
 * short, which is a reconciliation problem out of all proportion to a penny.
 */
export function grossUpCharge(target: number, rate: ProcessorRate): number {
  if (target <= 0) return 0;
  if (rate.percent_bps >= 10000) {
    // At exactly 100% this is a division by zero; above it the "charge" comes
    // out negative, which would move money the wrong way. Neither is a number
    // to hand a payment provider.
    throw new Error(`processor rate of ${rate.percent_bps}bps is not chargeable`);
  }
  return Math.ceil(((target + rate.fixed_cents) * 10000) / (10000 - rate.percent_bps));
}

/** The itemised lines a pass-on runner sees, and the total they are charged.
 *
 *  The processor line is derived as `total - base - platformFee` rather than
 *  predicted independently, so the three lines ALWAYS sum to the total. Showing
 *  a breakdown whose parts do not add up is worse than showing no breakdown —
 *  and here it is not even cosmetic: PayMongo computes the amount it charges
 *  FROM the line items, so lines that sum to something other than `total` are a
 *  different charge, not a different display.
 *
 *  The derived line is therefore up to ₱0.01 above what the processor actually
 *  takes (₱31.38 vs ₱31.37 on a ₱2,000 GCash entry) — that is grossUpCharge's
 *  ceil, and the centavo survives the cut and lands in the organizer's net. */
export function passOnBreakdown(
  baseTotal: number,
  platformFee: number,
  rate: ProcessorRate,
): { base: number; platformFee: number; processorFee: number; total: number } {
  const total = grossUpCharge(baseTotal + platformFee, rate);
  return { base: baseTotal, platformFee, processorFee: total - baseTotal - platformFee, total };
}
