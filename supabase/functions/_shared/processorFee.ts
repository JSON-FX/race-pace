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
