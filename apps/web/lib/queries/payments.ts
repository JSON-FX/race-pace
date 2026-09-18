import { createClient } from "@/lib/supabase/server";
import type { TableParams } from "@/lib/table-params";
import { quotePostgrestValue, toIlikePattern } from "./events";
import type { PaymentStatus } from "./registrations";

/** THE one place a raw `q` becomes a search pattern for this page — both
 *  `listOrgPayments` (PostgREST `.or()`) and `getPaymentAggregates` (RPC)
 *  call this, so a `*` (or any ILIKE metacharacter) in the search box can
 *  never desync the table from the KPI row above it. Returns `null` for a
 *  blank/whitespace-only term. See `toIlikePattern`'s doc comment (lib/
 *  queries/events.ts) for why this has to happen before either transport. */
function searchPattern(q: string): string | null {
  const trimmed = q.trim();
  return trimmed ? toIlikePattern(trimmed) : null;
}

export type PaymentRow = {
  registration_id: string | null;
  payment_id: string;
  booking_order_id: string | null;
  participant_count: number;
  event_id: string | null;
  event_name: string | null;
  user_id: string | null;
  full_name: string | null;
  /** Runner's profile photo; framing rides on the URL fragment. */
  avatar_url: string | null;
  amount: number;
  platform_fee: number;
  refunded_amount: number;
  processor_fee_cents: number | null;
  processor_fee_source: string;
  paid_at: string | null;
  net_to_org: number | null;
  method: string | null;
  status: PaymentStatus;
  created_at: string;
};

const SELECT =
  "payment_id,booking_order_id,participant_count,registration_id,event_id,event_name,user_id,full_name,avatar_url,amount,platform_fee,refunded_amount,processor_fee_cents,processor_fee_source,paid_at,net_to_org,method,status,created_at";

export async function listOrgPayments(
  orgId: string,
  params: TableParams,
  opts: {
    db?: Awaited<ReturnType<typeof createClient>>;
    /** Default true. See the identical option on `listEventRegistrations`
     *  (@/lib/queries/registrations) — the export route sets this false for
     *  every batch after the first, since `count: "exact"` re-runs a real
     *  `count(*)` server-side and the total doesn't change between batches
     *  of the SAME request. */
    includeCount?: boolean;
  } = {},
): Promise<{ rows: PaymentRow[]; total: number }> {
  const { includeCount = true } = opts;
  const supabase = opts.db ?? await createClient();
  const from = (params.page - 1) * params.per;

  let req = supabase
    .from("admin_payments_v")
    .select(SELECT, includeCount ? { count: "exact" } : undefined)
    .eq("org_id", orgId);

  const status = params.filters.status ?? "all";
  if (status !== "all") req = req.eq("status", status);

  const method = params.filters.method ?? "all";
  if (method !== "all") req = req.eq("method", method);

  // Kept byte-for-byte in step with admin_payment_aggregates' p_event_id (see
  // 20260807100000_payment_aggregates_by_event.sql). If these two ever diverge,
  // the KPI cards silently describe a different set of rows than the table
  // beneath them — the exact failure those RPCs exist to prevent.
  const event = params.filters.event ?? "all";
  if (event !== "all") req = req.eq("event_id", event);

  const pattern = searchPattern(params.q);
  if (pattern) {
    const term = quotePostgrestValue(pattern);
    req = req.or(`full_name.ilike.${term},event_name.ilike.${term}`);
  }

  const s = params.sort[0] ?? { id: "created_at", desc: true };
  // Secondary `.order("payment_id")` tiebreaker — same reasoning as
  // `listEventRegistrations`'s `.order("id")`: rows sharing the primary sort
  // value have no guaranteed order across two separate `.range()` calls
  // otherwise, which the export route's batch seam would actually expose.
  req = req
    .order(s.id, { ascending: !s.desc })
    .order("payment_id", { ascending: true })
    .range(from, from + params.per - 1);

  const { data, error, count } = await req;
  if (error) throw error;
  return { rows: (data ?? []) as PaymentRow[], total: count ?? 0 };
}

/** Every distinct `method` this org's payments actually carry, for the Method
 *  filter's option list.
 *
 *  Deliberately NOT a hardcoded list. `payments.method` stores PayMongo's own
 *  `source.type` verbatim (supabase/functions/_shared/paymongo.ts:106) — an
 *  external vocabulary this repo does not control — so a fixed list would both
 *  offer instruments no runner has ever used and silently hide any instrument
 *  PayMongo adds.
 *
 *  Scoped to the org and NOTHING else: it must ignore the current status/method/q
 *  filters, or selecting GCash would collapse the list to GCash alone and leave
 *  no way back to the other methods.
 *
 *  There is no `distinct` in PostgREST and this task adds no migration, so the
 *  dedupe happens here over a single narrow text column. `limit(BATCH)` matches
 *  the instance's measured PGRST_DB_MAX_ROWS (see the payments export route),
 *  which caps the response either way; ordering newest-first means a
 *  just-launched PayMongo instrument is the first thing in the window rather
 *  than the last. For an org past that many payments the list is therefore
 *  "methods seen in the most recent 1000 payments" — an instrument used only on
 *  older rows would drop out of the filter, which is worth a real `distinct` in
 *  the view when one of these orgs exists.
 *
 *  Degrades to an empty list on failure rather than taking the page down; the
 *  table itself is unaffected. */
export async function listOrgPaymentMethods(orgId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("admin_payments_v")
    .select("method")
    .eq("org_id", orgId)
    .not("method", "is", null)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) {
    console.error("listOrgPaymentMethods failed", error);
    return [];
  }
  return (data ?? []).map((r) => (r as { method: string | null }).method).filter((m): m is string => !!m);
}

export type PaymentAggregates = {
  grossCents: number;
  feeCents: number;
  netCents: number | null;
  refundedCents: number;
};

const EMPTY_AGGREGATES: PaymentAggregates = { grossCents: 0, feeCents: 0, netCents: 0, refundedCents: 0 };

/** KPI-row aggregates for the Payments page. Scoped to the SAME org and filters
 *  (status/method/q) as `listOrgPayments` — computed by a Postgres RPC (see
 *  supabase/migrations/20260806190000_admin_kpi_aggregates.sql) over
 *  admin_payments_v, the same view the table reads. The gross RPC figure is
 *  captured amount less completed refunds on active payments. Fee/net are summed
 *  from that view's platform_fee/net_to_org columns —
 *  net is NEVER recomputed as amount - fee client-side, so the card can never
 *  disagree with the ledger.
 *
 *  Paid and partially refunded captures contribute current proceeds. Group
 *  captures occur once regardless of participant count. A null aggregate net
 *  means at least one included capture still needs actual-fee reconciliation;
 *  it must not become an apparent zero or a partial subtotal.
 *
 *  Degrades to zeroes on failure rather than taking the page down. */
export async function getPaymentAggregates(orgId: string, params: TableParams): Promise<PaymentAggregates> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_payment_aggregates", {
    p_org_id: orgId,
    p_status: params.filters.status ?? "all",
    p_method: params.filters.method ?? "all",
    p_event_id: params.filters.event ?? "all",
    // Already a full `%...%` ILIKE pattern (or '' for "no filter") — see
    // searchPattern's doc comment. The RPC consumes this as-is.
    p_q: searchPattern(params.q) ?? "",
  });
  if (error) {
    console.error("getPaymentAggregates failed", error);
    return EMPTY_AGGREGATES;
  }
  const row = data?.[0];
  if (!row) return EMPTY_AGGREGATES;
  return {
    grossCents: Number(row.gross_cents ?? 0),
    feeCents: Number(row.fee_cents ?? 0),
    netCents: row.net_cents == null ? null : Number(row.net_cents),
    refundedCents: Number(row.refunded_cents ?? 0),
  };
}
