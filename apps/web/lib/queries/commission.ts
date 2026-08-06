import { createClient } from "@/lib/supabase/server";
import { describeChargedFee, type CheapestCategory, type FeeTerms, type RefundTerms } from "@/lib/commission-terms";

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
  since: string | null;
  event_count: number;
  paid_count: number;
  gross_revenue: number;
  platform_fee: number;
  net_to_org: number;
  /** Gross / paid entries. The denominator of every "≈" on the row. */
  avg_entry_cents: number;
  /** Cheapest `categories.base_price` across the org's OPEN events — what a
   *  flat fee is measured against. Null when the org has nothing on sale. */
  cheapest_open: CheapestCategory | null;
  /** The entry price the refund worked example is rendered from: the org's own
   *  average paid entry, falling back to its cheapest open category. */
  example_entry_cents: number;
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
    gross: number;
    net_to_org: number;
    paid_count: number;
    /** Returned to runners: the full amount on a `refunded` row, the returned
     *  part on a `partially_refunded` one. Not netted off `commission` — the
     *  aggregates already exclude refunded rows — but stated in the KPI caption
     *  so the figure is not silently smaller than an operator's own tally. */
    refunded_cents: number;
    refund_count: number;
    /** Net earnings on payments no statement has settled yet. */
    unpaid_out_cents: number;
  };
};

/** Money we actually hold. Mirrors the view filters in
 *  `20260807090200_widen_money_aggregates.sql` — a `partially_refunded` row's
 *  columns were rewritten to the RETAINED figures, so it counts; a fully
 *  `refunded` row kept its originals, so it must not. */
const EARNING_STATUSES = ["paid", "partially_refunded"];

const OPEN_EVENT_STATUSES = ["open", "almost_full"];

type PaymentSlice = {
  org_id: string;
  event_id: string | null;
  event_name: string | null;
  amount: number;
  platform_fee: number;
  status: string;
  refunded_amount: number;
};

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
      .select(
        "id,name,created_at,commission_type,commission_rate,commission_flat_cents,refund_policy,refund_fee_cents",
      )
      .order("name"),
    supabase.from("admin_org_totals_v").select("org_id,paid_count,gross_revenue,platform_fee,net_to_org"),
    supabase.from("events").select("id,name,org_id,status"),
    supabase
      .from("admin_payments_v")
      .select("org_id,event_id,event_name,amount,platform_fee,status,refunded_amount"),
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
    refund_policy: string; refund_fee_cents: number;
  }[];
  const totals = (totalsRes.data ?? []) as {
    org_id: string; paid_count: number; gross_revenue: number; platform_fee: number; net_to_org: number;
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

  const totalsByOrg = new Map(totals.map((t) => [t.org_id, t]));
  const eventCountByOrg = new Map<string, number>();
  for (const e of events) eventCountByOrg.set(e.org_id, (eventCountByOrg.get(e.org_id) ?? 0) + 1);
  const orgNameById = new Map(orgRows.map((o) => [o.id, o.name]));

  const orgs: OrgCommissionRow[] = orgRows.map((o) => {
    const t = totalsByOrg.get(o.id);
    const paid_count = t?.paid_count ?? 0;
    const gross_revenue = t?.gross_revenue ?? 0;
    const avg = paid_count > 0 ? Math.round(gross_revenue / paid_count) : 0;
    const cheapest = cheapestByOrg.get(o.id) ?? null;
    return {
      id: o.id,
      name: o.name,
      since: o.created_at,
      commission_type: o.commission_type,
      commission_rate: o.commission_rate,
      commission_flat_cents: o.commission_flat_cents,
      refund_policy: o.refund_policy,
      refund_fee_cents: o.refund_fee_cents,
      event_count: eventCountByOrg.get(o.id) ?? 0,
      paid_count,
      gross_revenue,
      platform_fee: t?.platform_fee ?? 0,
      net_to_org: t?.net_to_org ?? 0,
      avg_entry_cents: avg,
      cheapest_open: cheapest,
      // A worked example needs a real number to work on. The org's own average
      // entry is the most honest one; a brand-new org with no sales falls back
      // to what it is actually selling.
      example_entry_cents: avg > 0 ? avg : cheapest?.base_price ?? 0,
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
      net_to_org: orgs.reduce((s, o) => s + o.net_to_org, 0),
      paid_count: orgs.reduce((s, o) => s + o.paid_count, 0),
      refunded_cents: refunds.reduce(
        (s, r) => s + (r.status === "refunded" ? r.amount : r.refunded_amount ?? 0),
        0,
      ),
      refund_count: refunds.length,
      unpaid_out_cents: ((unpaidRes.data ?? []) as { net_to_org: number }[]).reduce(
        (s, r) => s + (r.net_to_org ?? 0),
        0,
      ),
    },
  };
}
