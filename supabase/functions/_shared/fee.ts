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
 * STRUCK ONCE PER ENTRY, AT CAPTURE, AND NEVER AGAIN. This used to say that a
 * flat-fee refund calls it a second time with the RETAINED amount, "so the
 * retained fee is struck by exactly the same rule as the original" — true of
 * `_shared/refund.ts` until 2026-08-11 and of nothing since. The commission is
 * now an earned service fee: it is kept in full on a refund, so re-striking it
 * on the organizer's retention would charge twice for one sale.
 * `20260811094000_refund_net_to_org.sql` deleted the RPC parameter that carried
 * the second fee, and `_shared/refund.ts` says "No computeFee here" where the
 * second call used to be. Both remaining callers are pre-capture:
 * `_shared/confirm.ts`, which freezes the fee onto the payment row, and
 * `payment-session`, which needs the same figure to size a pass-on gross-up.
 */
export function computeFee(total: number, org: FeeTerms): number {
  if (total <= 0) return 0;
  if (org.commission_type === "fixed") {
    return Math.min(org.commission_flat_cents, total);
  }
  const rate = org.commission_rate ?? 0.10;
  return Math.min(Math.round(total * rate), total);
}
