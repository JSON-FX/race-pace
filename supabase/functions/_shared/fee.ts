/** An organization's commercial terms, as stored on `organizations`. */
export interface FeeTerms {
  commission_type: string;
  commission_rate: number | null;
  commission_flat_cents: number;
}

/**
 * The platform's commission on ONE registration, in centavos.
 *
 * Commission has always been per-registration — this function just makes the
 * shape of it configurable, so an org can be charged a flat peso amount per
 * entry instead of a percentage.
 *
 * THE CLAMP IS NOT OPTIONAL. A flat fee larger than the entry price would make
 * `net_to_org` negative — the organizer owing the platform money for a sale they
 * made. `Math.min` floors net at zero. It also handles a ₱0 entry (a free event
 * or a fully-discounted comp) with no special case, and guards the percent
 * branch against a mis-entered rate above 100%.
 *
 * Callers pass the RETAINED amount rather than the original when a flat-fee
 * refund has shrunk the sale — see `_shared/refund.ts`. That is the whole reason
 * this is a standalone function: the retained fee must be struck by exactly the
 * same rule as the original, or a partial refund would quietly change an org's
 * commercial terms.
 */
export function computeFee(total: number, org: FeeTerms): number {
  if (total <= 0) return 0;
  if (org.commission_type === "fixed") {
    return Math.min(org.commission_flat_cents, total);
  }
  const rate = org.commission_rate ?? 0.10;
  return Math.min(Math.round(total * rate), total);
}
