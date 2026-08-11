import type { SettlementRow } from "@/lib/settlement-csv";

/**
 * Settlement arithmetic, deliberately server-free.
 *
 * No `@/lib/supabase/server`, no `next/headers`, no imports beyond a type —
 * so unit tests and the client export button can both use it. The read model
 * in `lib/queries/settlement.ts` re-exports everything here, which keeps the
 * page's import list short without dragging server-only modules into the
 * browser bundle. Same split, and same reason, as `lib/commission-terms.ts`.
 *
 * Everything that DECIDES a figure lives here rather than beside the query, on
 * purpose: `lib/queries/settlement.ts` cannot be unit-tested at all (it reaches
 * next/headers through the Supabase server client), so every line left in it is
 * a line no test can hold. What remains there is fetching and nothing else.
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
 *
 * THE WATERFALL MUST CLOSE: gross − commission − processing − refunds = net,
 * for every row, which is the one promise the page's headline makes. That is
 * why the two refund statuses source their refund figure from DIFFERENT
 * columns, and this is not an oversight to tidy up:
 *
 * - `refunded` takes it from **net_to_org**. Three writers have set
 *   `refunded_amount` on a full refund and they do not agree: the current
 *   `refund_registration_tx` writes `v_net` (20260811094000), but the
 *   pre-2026-08-11 body wrote the GROSS `v_amount` (20260808140000), and the
 *   demo seeder — which IS the hosted dataset — writes `r.total_amount`
 *   (scripts/seed-demo/03-registrations.sql). On a gross-scale row the identity
 *   collapses to −(commission + processing) and the summary visibly fails to
 *   add up. `net_to_org` is the figure `payout_open_statement` sizes the
 *   clawback from, unconditionally, so reading it here makes the page agree
 *   with the statement for every writer — and costs nothing under the current
 *   one, which sets the two equal.
 * - `partially_refunded` takes it from **refunded_amount**, because there
 *   `net_to_org` holds the RETENTION, not the refund. The split is guaranteed
 *   by the RPC itself (`p_refunded_amount + p_retained_net = v_net`, raised as
 *   `refund_split_mismatch`), so both figures on that row are trustworthy and
 *   each means a different thing.
 */
export function settlementTotals(rows: SettlementRow[]): SettlementTotals {
  const t: SettlementTotals = { gross: 0, commission: 0, processing: 0, refunds: 0, net: 0 };
  for (const r of rows) {
    t.gross += r.gross_paid;
    t.commission += r.rp_commission;
    t.processing += r.processing_fee;
    if (r.status === "refunded") {
      t.refunds += r.net_to_org;
    } else {
      t.refunds += r.refunded_amount;
      t.net += r.net_to_org;
    }
  }
  return t;
}

/** One `payments` row as the settlement read model selects it. */
export type SettlementPayment = {
  registration_id: string;
  amount: number;
  platform_fee: number;
  processor_fee_cents: number;
  processor_fee_source: string;
  net_to_org: number;
  status: string;
  refunded_amount: number;
  method: string | null;
  created_at: string;
  registrations: {
    user_id: string | null;
    categories: { label: string } | null;
  } | null;
};

/** The two name columns on `profiles`, in fallback order. */
export type RunnerName = { full_name: string | null; bib_name: string | null };

/**
 * The only two `processor_fee_source` values on which the ORGANIZER bore the
 * processing cost — i.e. the only two on which `net_to_org` had a processor fee
 * deducted from it, and so the only two whose fee may be shown as a cost of
 * theirs.
 *
 * AN ALLOWLIST, and the shape is the point. `payout_open_statement`
 * (20260811095000, re-emitted by 20260811095500), the clawback
 * (20260811095700) and `admin_payment_aggregates` (20260811095500) all spell
 * `processor_fee_source in ('actual','predicted')`. This file used to spell the
 * complement — "anything except 'historical'" — which is the same set only for
 * as long as the enum has exactly four values and no `'none'` row ever carries a
 * non-zero fee. Both of those are assumptions about OTHER files:
 * 20260811092000's own header calls "never 'none' with a non-zero fee" an
 * invariant it maintains by construction, and a fifth source value would split
 * the two definitions with nothing to notice. Stating the same two values the
 * server states makes the agreement a fact rather than a coincidence.
 */
const ORG_BORNE_FEE_SOURCES = ["actual", "predicted"];

/**
 * A payment row as the organizer's settlement table and CSV show it.
 *
 * This mapping is pure and lives here — NOT beside the query — because of the
 * one line inside it. `processor_fee_source = 'historical'` marks a real
 * processing fee that the PLATFORM absorbed under pre-2026-08-11 terms
 * (20260811090000's column comment), so it was never deducted from the
 * organizer: `net_to_org` on such a row deliberately violates
 * `amount - processor_fee - commission`. Reporting the stored fee in the
 * organizer's "Payment processing" column would bill them for a cost they never
 * bore AND break the page's own waterfall for exactly those rows. A `'none'` row
 * is excluded for the ordinary reason — no fee was deducted there either.
 * `payout_open_statement` applies the same allowlist (20260811095000); these two
 * must agree or an organizer's page disagrees with their statement.
 *
 * Names are resolved from a map rather than embedded in the payments select:
 * there is no foreign key from `registrations` to `profiles` (user_id points at
 * auth.users, profiles.id points at auth.users separately), so PostgREST cannot
 * embed them. See `lib/queries/settlement.ts`.
 */
export function toSettlementRow(
  p: SettlementPayment,
  names: ReadonlyMap<string, RunnerName>,
): SettlementRow {
  const who = p.registrations?.user_id ? names.get(p.registrations.user_id) : undefined;
  // `.trim() ||` rather than `??`: an empty full_name is present-but-useless and
  // would otherwise render a blank cell in the middle of a money table.
  const runner_name =
    (who?.full_name ?? "").trim() || (who?.bib_name ?? "").trim() || "Unknown runner";
  return {
    registration_id: p.registration_id,
    runner_name,
    category: p.registrations?.categories?.label ?? "—",
    // `payments` has no paid_at column; created_at is the row's creation, which
    // for a paid row is when its checkout was opened. Close enough to date-stamp
    // the entry, and only ever shown for rows that really did pay — the read
    // model filters status before this mapping ever sees them.
    paid_at: p.created_at,
    method: p.method,
    gross_paid: p.amount,
    rp_commission: p.platform_fee,
    processing_fee: ORG_BORNE_FEE_SOURCES.includes(p.processor_fee_source) ? p.processor_fee_cents : 0,
    net_to_org: p.net_to_org,
    status: p.status,
    refunded_amount: p.refunded_amount,
    // `payments` has no refunded_at column either — the refund RPCs stamp it
    // into `raw` (20260807090400). Left null rather than dug out of jsonb.
    refunded_at: null,
  };
}

export function toSettlementRows(
  pays: SettlementPayment[],
  names: ReadonlyMap<string, RunnerName>,
): SettlementRow[] {
  return pays.map((p) => toSettlementRow(p, names));
}

/** A rate-card row as the forecast reads it. */
export type ProcessorRateCandidate = ProcessorRateLite & {
  scope: string;
  offered: boolean;
  note: string | null;
};

/** What one entry costs to process at a given rate, at THIS event's price. */
function processorCost(entryCents: number, r: ProcessorRateLite): number {
  return Math.round((entryCents * r.percent_bps) / 10000) + r.fixed_cents;
}

/**
 * The cheapest and dearest rate an organizer's runners can actually reach.
 *
 * Two filters, and both are load-bearing:
 *
 * 1. `offered` — a runner can only pick what METHOD_MAP offers
 *    (payment-session/index.ts: card, gcash, maya). The rate card seeds more
 *    than that so enabling a method is a UI change rather than a schema change,
 *    and ranking over all of them made `dob` at 80 bps the cheapest — quoting an
 *    optimistic end of a money forecast that no runner could reach.
 * 2. `note` mentioning UNCONFIRMED — independent of `offered`, and deliberately
 *    so. A row whose own seed note says the figure is unconfirmed has no place
 *    at either end of a number an organizer will plan around; if such a method
 *    is ever enabled, the note comes off when the rate is confirmed from real
 *    settlements, not when the button is added.
 *
 * Ranked at the event's own average entry, not at a notional one. `percent_bps`
 * alone would misorder a future rate with a small percentage and a large fixed
 * fee on a cheap event — 0 bps + ₱20 beats 350 bps only above ₱571.
 */
export function forecastRates(
  rows: ProcessorRateCandidate[],
  entryCents: number,
  scope = "local",
): { cheap: ProcessorRateLite; dear: ProcessorRateLite } | null {
  const usable = rows.filter(
    (r) => r.scope === scope && r.offered && !/unconfirmed/i.test(r.note ?? ""),
  );
  if (usable.length === 0) return null;
  const cost = (r: ProcessorRateLite) => processorCost(entryCents, r);
  const cheap = usable.reduce((a, b) => (cost(a) <= cost(b) ? a : b));
  const dear = usable.reduce((a, b) => (cost(a) >= cost(b) ? a : b));
  return {
    cheap: { percent_bps: cheap.percent_bps, fixed_cents: cheap.fixed_cents },
    dear: { percent_bps: dear.percent_bps, fixed_cents: dear.fixed_cents },
  };
}

/**
 * Entries this event can still sell, or `null` when that is not knowable.
 *
 * `slots_total` defaults to 0 (20260718182858), so "no capacity configured" and
 * "sold out" are the same zero on a category read in isolation. They are told
 * apart at the event level: an event whose categories sum to zero total slots
 * has not configured capacity, and `null` says so rather than claiming it is
 * full. Both cases end the same way on the page — no forecast — but only one of
 * them is a fact.
 */
export function remainingCapacity(
  cats: { slots_total: number; slots_taken: number }[],
): number | null {
  if (cats.length === 0) return null;
  const total = cats.reduce((s, c) => s + c.slots_total, 0);
  if (total <= 0) return null;
  const taken = cats.reduce((s, c) => s + c.slots_taken, 0);
  return Math.max(0, total - taken);
}

/**
 * What this event's next entry is worth, judged by the ones already sold.
 *
 * Refunded rows are excluded from both means. They tell you what an entry
 * fetched, but not what the organizer kept — their commission went back with the
 * refund — and a forecast of future net that averaged in a returned commission
 * would understate every unsold entry.
 *
 * Zeroes when nothing has sold, which `projectedRange` reads as "no basis" and
 * answers with no forecast at all.
 */
export function soldAverages(
  rows: SettlementRow[],
): { avgEntry: number; avgCommission: number } {
  const sold = rows.filter((r) => r.status !== "refunded");
  if (sold.length === 0) return { avgEntry: 0, avgCommission: 0 };
  const mean = (pick: (r: SettlementRow) => number) =>
    Math.round(sold.reduce((s, r) => s + pick(r), 0) / sold.length);
  return { avgEntry: mean((r) => r.gross_paid), avgCommission: mean((r) => r.rp_commission) };
}

/**
 * What the organizer ends up with once the entries they have NOT yet sold sell.
 *
 * The forecast is over the unknown part only. `bankedNet` is the exact net from
 * entries already paid — it is not estimated, not ranged, and it appears at both
 * ends of the band unchanged. Only the remaining capacity moves.
 *
 * This is the correction to a projection that used to forecast money already
 * collected: a one-entry event read "Projected net ₱1,855–₱1,924" directly under
 * a summary card stating "Net to you ₱1,910", because the range was struck over
 * runners who had already chosen how to pay. Nothing about them is unknown.
 *
 * In absorb mode the organizer bears processing, so a ₱2,000 entry nets them
 * ₱1,970 on GCash and ₱1,915 on a card. Across 500 unsold entries that is
 * ₱27,500 they cannot forecast — and an organizer who first meets that swing at
 * settlement experiences it as an unexplained shortfall.
 *
 * Returns `null` — no band at all — when there is nothing left to forecast:
 * capacity is full or unconfigured (`remaining <= 0`), or no entry has sold yet
 * so there is no price to extrapolate from (`avgEntry <= 0`). A band around a
 * figure that is already exact only casts doubt on a known number.
 */
export function projectedRange(
  bankedNet: number,
  remaining: number,
  avgEntry: number,
  avgCommission: number,
  rates: { cheap: ProcessorRateLite; dear: ProcessorRateLite },
): { low: number; high: number } | null {
  if (remaining <= 0 || avgEntry <= 0) return null;
  const per = (r: ProcessorRateLite) => avgEntry - avgCommission - processorCost(avgEntry, r);
  // The CHEAPEST rate produces the HIGHEST net: less is taken out per entry.
  return {
    low: bankedNet + per(rates.dear) * remaining,
    high: bankedNet + per(rates.cheap) * remaining,
  };
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
