import type { SettlementRow } from "@/lib/settlement-csv";

/**
 * Settlement arithmetic, deliberately server-free.
 *
 * No `@/lib/supabase/server`, no `next/headers`, no imports beyond a type —
 * so unit tests and the client export button can both use it. The read model
 * in `lib/queries/settlement.ts` re-exports everything here, which keeps the
 * page's import list short without dragging server-only modules into the
 * browser bundle. Same split, and same reason, as `lib/commission-terms.ts`.
 */

export type ProcessorRateLite = { percent_bps: number; fixed_cents: number };

export type SettlementTotals = {
  gross: number; commission: number; processing: number; refunds: number; net: number;
};

/**
 * Column sums for the settlement summary.
 *
 * `net` counts only rows that still owe the organizer something. A fully
 * refunded row KEEPS its net_to_org — that is what lets the payout clawback
 * size itself — so summing the column blindly would report money owed for an
 * entry the organizer has already given back.
 */
export function settlementTotals(rows: SettlementRow[]): SettlementTotals {
  const t: SettlementTotals = { gross: 0, commission: 0, processing: 0, refunds: 0, net: 0 };
  for (const r of rows) {
    t.gross += r.gross_paid;
    t.commission += r.rp_commission;
    t.processing += r.processing_fee;
    t.refunds += r.refunded_amount;
    if (r.status !== "refunded") t.net += r.net_to_org;
  }
  return t;
}

/**
 * What the organizer will be paid, cheapest to dearest payment method.
 *
 * In absorb mode the organizer bears processing, so their net genuinely depends
 * on how runners choose to pay: a ₱2,000 entry costs ₱30 on GCash and ₱85 on a
 * card. Across 500 entries that is ₱27,500 they cannot forecast.
 *
 * Stating the range up front is the whole point. An organizer who discovers the
 * swing at settlement experiences it as an unexplained shortfall.
 */
export function projectedRange(
  paidCount: number,
  avgEntry: number,
  commissionCents: number,
  rates: { cheap: ProcessorRateLite; dear: ProcessorRateLite },
): { low: number; high: number } {
  if (paidCount <= 0) return { low: 0, high: 0 };
  const per = (r: ProcessorRateLite) =>
    avgEntry - commissionCents - (Math.round((avgEntry * r.percent_bps) / 10000) + r.fixed_cents);
  return { low: per(rates.dear) * paidCount, high: per(rates.cheap) * paidCount };
}

/**
 * How many payments still carry an ESTIMATED processing fee — or `null` when
 * that could not be established.
 *
 * `null` is not a stylistic choice, it is the whole reason this is a function
 * rather than `data ?? 0` at the call site.
 * `20260811095000_payout_open_statement_v2.sql` widened
 * `payout_unreconciled_count` from super-admin-only to "super admin OR
 * editor/admin of the event's own org" precisely so this page could call it,
 * and its header names the failure mode it was avoiding: a caller that reads
 * `{ data }` and coerces with `?? 0` turns a 42501 — or a dropped connection,
 * or a renamed argument — into a confident "0 unreconciled". The banner then
 * never renders, the organizer is never told their figures are estimates, and
 * no test fails, because "0" is a perfectly ordinary answer.
 *
 * So: an error is UNKNOWN, never zero, and the page says so in its own banner.
 * Degrading rather than throwing is deliberate — this is a caveat ABOUT the
 * money, not the money itself, and taking the whole settlement view down
 * because a warning count failed would trade a small silence for a large one.
 */
export function unreconciledCount(
  res: { data: number | null; error: { message: string } | null },
): number | null {
  // Checked before the payload: PostgREST can return both, and a figure that
  // arrived alongside an error has not earned any trust.
  if (res.error) return null;
  // `?? null`, not `?? 0` — a genuine 0 is a number and survives; a missing
  // payload stays unknown.
  return res.data ?? null;
}
