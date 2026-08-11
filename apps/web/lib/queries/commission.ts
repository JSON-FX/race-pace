import { createClient } from "@/lib/supabase/server";
import {
  describeChargedFee,
  type CheapestCategory,
  type FeeTerms,
  type RateDrift,
  type RefundTerms,
} from "@/lib/commission-terms";

/**
 * The terms logic itself lives in `@/lib/commission-terms` and is re-exported
 * here so this module stays the page's single import — and, more importantly,
 * so the inline editors can import it WITHOUT dragging `@/lib/supabase/server`
 * (and therefore `next/headers`) into the client bundle, which is a build
 * error, not a size regression.
 */
export * from "@/lib/commission-terms";

/* ------------------------------------------------------------------ *
 * The read model
 * ------------------------------------------------------------------ */

export type OrgCommissionRow = RefundTerms & {
  id: string;
  name: string;
  /** Who bears the payment processor's cut. A PLATFORM term, editable only by a
   *  super admin — see `setFeeMode` and 20260811097000_org_fee_mode_grant.sql. */
  fee_mode: "absorb" | "pass_on";
  since: string | null;
  event_count: number;
  paid_count: number;
  /** Revenue RETAINED — the charge less anything already refunded. Never render
   *  this under a "GMV" heading; that column is `charged_gross`. */
  gross_revenue: number;
  /** Gross merchandise value: what runners were CHARGED, before any refund.
   *  This is the denominator every rate on this page is struck against, so it is
   *  what the GMV column and the effective rate must use — `gross_revenue`
   *  would print 15.4% for a 3% org the moment one entry is partially refunded. */
  charged_gross: number;
  platform_fee: number;
  net_to_org: number;
  /** What runners were CHARGED per paid entry — `charged_gross / paid_count`,
   *  not `gross_revenue / paid_count`. The denominator of every "≈" on the row,
   *  and the price the refund worked example is written about, so it has to be a
   *  price somebody actually paid. gross_revenue now nets a partial refund out
   *  (20260811095500), which is right for "revenue we hold" and wrong for "an
   *  average entry". */
  avg_entry_cents: number;
  /** Cheapest `categories.base_price` across the org's OPEN events — what a
   *  flat fee is measured against. Null when the org has nothing on sale. */
  cheapest_open: CheapestCategory | null;
  /** The entry price the refund worked example is rendered from: the org's own
   *  average paid entry, falling back to its cheapest open category. */
  example_entry_cents: number;
  /**
   * What the payment processor actually took out of one of this org's entries,
   * on average — the third term of `net_to_org = amount - platform_fee -
   * processor_fee_cents`, and therefore the term without which the refund worked
   * example cannot state what a cancelling runner gets back.
   *
   * `null` when nothing was observed, which the copy says out loud instead of
   * quoting a zero. See `processorBorneByOrg` below for how it is derived and
   * why a 'historical' row contributes nothing.
   */
  avg_processor_fee_cents: number | null;
};

export type EventCommissionRow = {
  event_id: string;
  event_name: string;
  org_id: string;
  org_name: string;
  paid_count: number;
  gross: number;
  commission: number;
  charged: string;
};

export type CommissionOverview = {
  orgs: OrgCommissionRow[];
  events: EventCommissionRow[];
  totals: {
    commission: number;
    /** Revenue RETAINED platform-wide. Kept because it is a real figure, but it
     *  is NOT what a GMV card or an effective rate means — see `charged_gross`. */
    gross: number;
    /** Platform GMV: what runners were charged, before refunds. The denominator
     *  of the effective rate. */
    charged_gross: number;
    net_to_org: number;
    paid_count: number;
    /** Returned to runners, from `payments.refunded_amount` on both refund kinds.
     *  NOT `amount`: a refund now returns `net_to_org` (20260811094000), so
     *  reading the charge over-stated every full refund by the commission plus
     *  the processor's fee. Not netted off `commission` — the aggregates already
     *  exclude fully refunded rows — but stated in the KPI caption so the figure
     *  is not silently smaller than an operator's own tally. */
    refunded_cents: number;
    refund_count: number;
    /** Net earnings on payments no statement has settled yet. */
    unpaid_out_cents: number;
  };
};

/** Money we actually hold. Mirrors the view filters in
 *  `20260811095500_money_aggregates_three_party.sql` — a `partially_refunded`
 *  row counts, but only for the part of its charge that was not returned; a
 *  fully `refunded` row kept its original amount/fee/net, so it must not count
 *  at all. (This used to cite 20260807090200 and its since-retired premise that
 *  the refund RPC rewrites `amount` down to the retention. It does not, and has
 *  not since 20260811094000 — `amount` must stay reconcilable against the
 *  provider's reported net_amount.) */
const EARNING_STATUSES = ["paid", "partially_refunded"];

const OPEN_EVENT_STATUSES = ["open", "almost_full"];

type PaymentSlice = {
  org_id: string;
  event_id: string | null;
  event_name: string | null;
  amount: number;
  platform_fee: number;
  net_to_org: number;
  status: string;
  refunded_amount: number;
};

/**
 * What the processor took OUT OF THE ORGANIZER on one payment, derived rather
 * than read.
 *
 * `admin_payments_v` carries no `processor_fee_cents` — but it does not need to,
 * because the figure that matters here is not the stored fee, it is the fee that
 * was actually DEDUCTED from what the organizer is owed, and that is recoverable
 * from the columns this page already fetches:
 *
 *   paid                 amount - platform_fee - net_to_org
 *   partially_refunded   amount - platform_fee - net_to_org - refunded_amount
 *
 * both of which are the same expression, since `refunded_amount` is 0 on a plain
 * paid row. On a partial refund it is exactly the four-way split
 * `refunded_amount + net_to_org + platform_fee + processor_fee_cents = amount`
 * that `refund_registration_tx` raises `refund_split_mismatch` to enforce
 * (20260811094000), so the term is trustworthy on both statuses.
 *
 * DERIVING IT IS WHAT MAKES THE 'historical' FILTER AUTOMATIC. On a
 * `processor_fee_source = 'historical'` row the platform absorbed a real fee and
 * `net_to_org` is `amount - platform_fee` with no processor deduction
 * (20260811090000's column comment), so this expression is 0 there — the same
 * answer the `('actual','predicted')` allowlist gives in `payout_open_statement`
 * and in `lib/settlement-math.ts`, reached without needing the source column at
 * all. A 'none' row is 0 for the ordinary reason: nothing was deducted.
 *
 * Non-positive results are DISCARDED rather than averaged in, which is the same
 * decision: a zero says "no processing was charged against this organizer on this
 * row", which is not an observation of what processing costs them, and a negative
 * can only come from a pre-2026-08-11 partial refund whose `amount` was rewritten
 * down (`raw.original_amount`; see 20260811092000's gate) — a row whose columns no
 * longer satisfy any identity worth reading.
 */
function processorBorneByOrg(p: PaymentSlice): number {
  return p.amount - p.platform_fee - p.net_to_org - p.refunded_amount;
}

/**
 * Everything the Commission page renders, in one pass.
 *
 * Super-admin only, and deliberately unscoped by org — the page's subject IS the
 * comparison between orgs. RLS enforces that independently: every table read
 * here is gated on `auth_can_admin_org`, which is true for all orgs only for a
 * super admin. The page's own `notFound()` guard is the UI half of the same
 * rule.
 */
export async function getCommissionOverview(): Promise<CommissionOverview> {
  const supabase = await createClient();

  const [orgsRes, totalsRes, eventsRes, paymentsRes, unpaidRes] = await Promise.all([
    supabase
      .from("organizations")
      // ONE string literal, not a concatenation. supabase-js parses the select
      // list at the type level, and `"a," + "b"` widens to `string`, which it
      // resolves to GenericStringError[] — a type error at the cast below rather
      // than anything wrong at runtime, but a confusing one to land on.
      .select("id,name,created_at,commission_type,commission_rate,commission_flat_cents,refund_policy,refund_fee_cents,fee_mode")
      .order("name"),
    supabase.from("admin_org_totals_v").select("org_id,paid_count,gross_revenue,charged_gross,platform_fee,net_to_org"),
    supabase.from("events").select("id,name,org_id,status"),
    // net_to_org rides along on a select this page already makes, rather than
    // arriving as a second read of `payments`: it is the only extra column the
    // refund worked example needs (see processorBorneByOrg), and a query of its
    // own would add a round trip and a second exposure to PostgREST's max_rows
    // for a figure this row set already contains.
    supabase
      .from("admin_payments_v")
      .select("org_id,event_id,event_name,amount,platform_fee,net_to_org,status,refunded_amount"),
    // Only the column that is summed. `payout_statement_id` is not on
    // admin_payments_v (it was added to `payments` by the payouts migration
    // after the view was last replaced), so this is its own narrow read rather
    // than a widened one above.
    supabase
      .from("payments")
      .select("net_to_org")
      .in("status", EARNING_STATUSES)
      .is("payout_statement_id", null),
  ]);

  for (const res of [orgsRes, totalsRes, eventsRes, paymentsRes, unpaidRes]) {
    if (res.error) throw res.error;
  }

  const orgRows = (orgsRes.data ?? []) as {
    id: string; name: string; created_at: string | null;
    commission_type: string; commission_rate: number | null; commission_flat_cents: number;
    refund_policy: string; refund_fee_cents: number; fee_mode: string;
  }[];
  const totals = (totalsRes.data ?? []) as {
    org_id: string; paid_count: number; gross_revenue: number; charged_gross: number;
    platform_fee: number; net_to_org: number;
  }[];
  const events = (eventsRes.data ?? []) as { id: string; name: string; org_id: string; status: string }[];
  const payments = (paymentsRes.data ?? []) as PaymentSlice[];

  const openEventIds = events.filter((e) => OPEN_EVENT_STATUSES.includes(e.status)).map((e) => e.id);

  // Only the open events' categories — a fee that exceeds a closed event's
  // cheapest entry can no longer be charged against it, so warning about it
  // would be noise the operator cannot act on.
  const cheapestByOrg = new Map<string, CheapestCategory>();
  if (openEventIds.length > 0) {
    const { data, error } = await supabase
      .from("categories")
      .select("org_id,label,base_price")
      .in("event_id", openEventIds)
      .order("base_price");
    if (error) throw error;
    for (const c of (data ?? []) as { org_id: string; label: string; base_price: number }[]) {
      // Ordered ascending, so the first row seen for an org is its cheapest.
      if (!cheapestByOrg.has(c.org_id)) cheapestByOrg.set(c.org_id, { label: c.label, base_price: c.base_price });
    }
  }

  // Averaged over the rows that ACTUALLY BORE a processing cost, not over every
  // paid entry. A mixed org — some entries settled under the old absorbed-fee
  // terms, some under the new ones — would otherwise have its example dragged
  // toward a fee nobody will be charged again, and an all-legacy org would read
  // as "the processor kept ₱0.00", which is a false statement dressed as a
  // figure. Averaging only over rows that were charged says what processing
  // costs on this org's entries, which is what the next refund will be struck
  // against; an org with no such row at all gets `null` and honest copy.
  const processorByOrg = new Map<string, { total: number; rows: number }>();
  for (const p of payments) {
    if (!EARNING_STATUSES.includes(p.status)) continue;
    const borne = processorBorneByOrg(p);
    if (borne <= 0) continue;
    const acc = processorByOrg.get(p.org_id);
    if (acc) {
      acc.total += borne;
      acc.rows += 1;
    } else {
      processorByOrg.set(p.org_id, { total: borne, rows: 1 });
    }
  }

  const totalsByOrg = new Map(totals.map((t) => [t.org_id, t]));
  const eventCountByOrg = new Map<string, number>();
  for (const e of events) eventCountByOrg.set(e.org_id, (eventCountByOrg.get(e.org_id) ?? 0) + 1);
  const orgNameById = new Map(orgRows.map((o) => [o.id, o.name]));

  const orgs: OrgCommissionRow[] = orgRows.map((o) => {
    const t = totalsByOrg.get(o.id);
    const paid_count = t?.paid_count ?? 0;
    const gross_revenue = t?.gross_revenue ?? 0;
    const charged_gross = t?.charged_gross ?? 0;
    // charged_gross, not gross_revenue. The label this feeds says "average entry"
    // and the worked example below says "A runner cancelling a ₱X entry" — both
    // are about the PRICE, and gross_revenue is now net of anything already
    // refunded, so dividing it would quote an entry fee nobody was ever charged.
    const avg = paid_count > 0 ? Math.round(charged_gross / paid_count) : 0;
    const cheapest = cheapestByOrg.get(o.id) ?? null;
    const proc = processorByOrg.get(o.id);
    return {
      id: o.id,
      name: o.name,
      since: o.created_at,
      commission_type: o.commission_type,
      commission_rate: o.commission_rate,
      commission_flat_cents: o.commission_flat_cents,
      refund_policy: o.refund_policy,
      refund_fee_cents: o.refund_fee_cents,
      // Narrowed rather than cast blind. The column is `text` with a check
      // constraint, so a value outside the pair is not reachable from the
      // database — but a row read before a future mode is added must not put an
      // unknown string into a <Select> that has no option for it and silently
      // render as blank.
      fee_mode: o.fee_mode === "pass_on" ? "pass_on" : "absorb",
      event_count: eventCountByOrg.get(o.id) ?? 0,
      paid_count,
      gross_revenue,
      charged_gross,
      platform_fee: t?.platform_fee ?? 0,
      net_to_org: t?.net_to_org ?? 0,
      avg_entry_cents: avg,
      cheapest_open: cheapest,
      // A worked example needs a real number to work on. The org's own average
      // entry is the most honest one; a brand-new org with no sales falls back
      // to what it is actually selling.
      example_entry_cents: avg > 0 ? avg : cheapest?.base_price ?? 0,
      // `null`, never 0. The worked example turns this into either a peso figure
      // or a sentence explaining that there is none, and those must not be the
      // same branch.
      avg_processor_fee_cents: proc ? Math.round(proc.total / proc.rows) : null,
    };
  });

  const earning = payments.filter((p) => EARNING_STATUSES.includes(p.status));
  const byEvent = new Map<string, PaymentSlice[]>();
  for (const p of earning) {
    if (!p.event_id) continue;
    const bucket = byEvent.get(p.event_id);
    if (bucket) bucket.push(p);
    else byEvent.set(p.event_id, [p]);
  }

  const eventRows: EventCommissionRow[] = [...byEvent.entries()].map(([event_id, rows]) => ({
    event_id,
    event_name: rows[0].event_name ?? "Untitled event",
    org_id: rows[0].org_id,
    org_name: orgNameById.get(rows[0].org_id) ?? "—",
    paid_count: rows.length,
    // CHARGED, matching the org table's GMV column above it and the "Fee charged"
    // badge beside it — this page speaks in what runners were charged throughout,
    // because that is what a commission rate is struck on. Netting the refund out
    // here would make `commission / gross` read as a rate nobody was charged, the
    // same falsehood as the effective-rate card.
    gross: rows.reduce((s, r) => s + r.amount, 0),
    commission: rows.reduce((s, r) => s + r.platform_fee, 0),
    charged: describeChargedFee(rows),
  }));
  eventRows.sort((a, b) => b.commission - a.commission);

  const refunds = payments.filter((p) => p.status === "refunded" || p.status === "partially_refunded");

  return {
    orgs,
    events: eventRows,
    totals: {
      commission: orgs.reduce((s, o) => s + o.platform_fee, 0),
      gross: orgs.reduce((s, o) => s + o.gross_revenue, 0),
      charged_gross: orgs.reduce((s, o) => s + o.charged_gross, 0),
      net_to_org: orgs.reduce((s, o) => s + o.net_to_org, 0),
      paid_count: orgs.reduce((s, o) => s + o.paid_count, 0),
      // One column for both refund kinds. The `refunded` arm used to read
      // `amount`, which was right only while a refund returned the whole charge —
      // it now returns net_to_org, so that over-stated every full refund by
      // platform_fee + processor_fee_cents.
      refunded_cents: refunds.reduce((s, r) => s + (r.refunded_amount ?? 0), 0),
      refund_count: refunds.length,
      unpaid_out_cents: ((unpaidRes.data ?? []) as { net_to_org: number }[]).reduce(
        (s, r) => s + (r.net_to_org ?? 0),
        0,
      ),
    },
  };
}

/**
 * Methods whose ACTUAL processing cost has diverged from the rate card.
 *
 * The ledger is unaffected — it records what was really charged — so this is
 * never a "the reports are wrong" alert. It means the pass-on surcharge is
 * under- or over-collecting, and the difference is absorbed by Race Pace rather
 * than passed to organizers.
 *
 * `.eq("drifting", true)` is pushed down to the view rather than filtered here:
 * the threshold (at least 80% of a sample of at least five, in one direction)
 * belongs to the detector, and restating it in TypeScript would give the console
 * a second, drifting definition of drift.
 *
 * The view is `security_invoker`, so a super admin's sample is platform-wide
 * while an org admin's would be computed from their own payments only. This page
 * is super-admin-gated, so in practice it is always the former.
 *
 * DEGRADES TO SILENCE, AND DOES NOT THROW. Unlike `getCommissionOverview`, whose
 * failure means the page has nothing to render, this one is ADVISORY: the reason
 * an operator opens /commission is the fee and refund tables, not the banner.
 * These two are awaited together in one `Promise.all`, so a `throw` here would
 * 500 the whole page and take the terms editors down with it — and the most
 * likely cause is `processor_rate_drift_v` not existing yet, which is precisely
 * the state of any environment that has not had `db push` run since
 * 20260811096000. A decorative banner must never be able to do that.
 *
 * Logged, never swallowed silently: an empty banner area and an empty log would
 * be indistinguishable from "no method is drifting", which is the reading that
 * suppresses the alarm.
 */
export async function getRateDrift(): Promise<RateDrift[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("processor_rate_drift_v")
    .select("method,scope,sample_size,disagreeing,median_implied_bps,card_bps,delta_cents,drifting")
    .eq("drifting", true);
  if (error) {
    console.error("[commission] rate drift unavailable — banner suppressed", {
      view: "processor_rate_drift_v",
      code: (error as { code?: string }).code,
      message: error.message,
      details: (error as { details?: string }).details,
      hint: (error as { hint?: string }).hint,
    });
    return [];
  }
  return ((data ?? []) as RateDrift[]).map((d) => ({
    ...d,
    // delta_cents is `bigint`, which PostgREST serialises as a JSON number here
    // but which arrives as a string from some drivers. Coerced once, at the
    // boundary, so the peso formatter downstream can never be handed "1234".
    delta_cents: Number(d.delta_cents),
  }));
}
