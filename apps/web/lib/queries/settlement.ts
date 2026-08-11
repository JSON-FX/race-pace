import { createClient } from "@/lib/supabase/server";
import type { SettlementRow } from "@/lib/settlement-csv";
import {
  settlementTotals, projectedRange, unreconciledCount, forecastRates,
  remainingCapacity, soldAverages, toSettlementRows,
  type ProcessorRateCandidate, type RunnerName, type SettlementPayment,
  type SettlementTotals,
} from "@/lib/settlement-math";

// Re-exported so the page has one import for the whole read model, while the
// pure half stays importable without pulling in next/headers. Same pattern as
// lib/queries/commission.ts.
export * from "@/lib/settlement-math";

export type EventSettlement = {
  event_name: string;
  /** The owning org's id, so the page can 404 an event that is not the
   *  caller's. NOT a substitute for RLS on `payments` — see getEventSettlement's
   *  header for why the two guards are about different tables. */
  org_id: string;
  org_name: string;
  rows: SettlementRow[];
  totals: SettlementTotals;
  feeMode: "absorb" | "pass_on";
  /** The forecast over entries NOT YET SOLD, with the exact banked net already
   *  added in — null whenever there is nothing left to forecast. Only ever set
   *  in absorb mode, where the organizer's net moves with the payment mix. */
  projected: { low: number; high: number; remaining: number } | null;
  /** How many payments still carry an ESTIMATED processing fee, or `null` when
   *  the check itself failed. Null is NOT zero: see `unreconciledCount`. */
  unreconciled: number | null;
};

const SELECT =
  "registration_id,amount,platform_fee,processor_fee_cents,processor_fee_source," +
  "net_to_org,status,refunded_amount,method,created_at," +
  // `registrations` embeds `categories` through registrations.category_id, but
  // there is NO foreign key from registrations to profiles — user_id points at
  // auth.users, and profiles.id points at auth.users separately. PostgREST
  // resolves embeds from foreign keys BETWEEN the two tables, so nesting
  // profiles here answers PGRST200 ("Could not find a relationship between
  // 'registrations' and 'profiles'") rather than returning names. Hence the
  // user_id below and the separate profiles read in getEventSettlement.
  "registrations!inner(event_id,user_id,categories(label))";

/**
 * The payment statuses that are settlement, in the sense the organizer means.
 *
 * `registrations-checkout` upserts a payments row at FULL sticker price with
 * status 'pending' the moment a runner OPENS checkout, and
 * `expire_stale_registrations` later flips abandoned ones to 'failed' with
 * `amount` left intact. Filtering on event alone therefore counted every
 * abandoned cart as revenue: it landed in Gross collected at full price while
 * contributing nothing to commission, processing or net — breaking this page's
 * own waterfall by exactly that sum, and disagreeing with `payout_open_statement`,
 * `admin_payment_aggregates` and the Payments KPIs, all of which filter status.
 *
 * 'refunded' is deliberately IN. It is the clawback row: the money was really
 * collected, really given back, and the organizer's statement will really be
 * reduced by it, so hiding it would make the refund column silently zero on the
 * page that exists to explain deductions. `settlementTotals` is what stops it
 * being counted as money still owed.
 *
 * 'pending' and 'failed' are deliberately OUT. Neither is money: one is a
 * checkout somebody opened, the other is one they abandoned.
 */
const COUNTED_STATUSES = ["paid", "partially_refunded", "refunded"] as const;

// Matches PGRST_DB_MAX_ROWS on this instance — see the identical constant and
// its measured provenance in app/(admin)/payments/export/route.ts. PostgREST
// silently caps a single request at this many rows: past 1,000 it returns 200
// with 1,000 rows and supabase-js does NOT error, so a summary summed from one
// unbatched read would print an authoritative wrong number.
const BATCH = 1000;

// A settlement that needed more than this many round trips is not a settlement,
// it is a bug. THROWING is the point: every alternative — stopping early,
// capping — is the truncation this batching exists to prevent, dressed up.
const MAX_BATCHES = 100;

// `.in()` becomes a query string, and a long one meets Kong's header buffer
// before it meets PostgREST. 100 uuids is ~4KB of URL, comfortably inside it;
// events big enough to need several chunks fetch them in parallel below.
const PROFILE_CHUNK = 100;

/** The server client, exactly as `createClient()` hands it back — no generated
 *  Database generic exists in this app, so naming the type any other way would
 *  invent one. */
type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * EVERY counted payment for the event, in a deterministic order.
 *
 * The order is not cosmetic. Two `.range()` calls have no guaranteed relative
 * order without an ORDER BY, so rows can repeat on one page and vanish from the
 * next — a batch seam that silently double-counts money. `created_at` is not
 * unique (a batch, or two webhooks in the same millisecond), so
 * `registration_id` — which `payments` holds a UNIQUE constraint on — breaks
 * the tie into a total order.
 */
async function fetchAllPayments(
  supabase: Db, eventId: string,
): Promise<SettlementPayment[]> {
  const all: SettlementPayment[] = [];
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const from = batch * BATCH;
    const { data, error } = await supabase
      .from("payments")
      .select(SELECT)
      .eq("registrations.event_id", eventId)
      .in("status", [...COUNTED_STATUSES])
      .order("created_at", { ascending: true })
      .order("registration_id", { ascending: true })
      .range(from, from + BATCH - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as SettlementPayment[];
    all.push(...page);
    // A short page is the end of the set. A full one may or may not be, so it
    // always costs one more request to find out — the alternative is trusting a
    // count, which is a second query that can disagree with the first.
    if (page.length < BATCH) return all;
  }
  throw new Error(
    `getEventSettlement: event ${eventId} has more than ${MAX_BATCHES * BATCH} payments; ` +
    "refusing to render a settlement summed from a truncated set.",
  );
}

/** Runner names by user_id, chunked so a large event does not overrun the URL. */
async function fetchRunnerNames(
  supabase: Db, userIds: string[],
): Promise<Map<string, RunnerName>> {
  const byId = new Map<string, RunnerName>();
  const chunks: string[][] = [];
  for (let i = 0; i < userIds.length; i += PROFILE_CHUNK) {
    chunks.push(userIds.slice(i, i + PROFILE_CHUNK));
  }
  await Promise.all(chunks.map(async (ids) => {
    const { data, error } = await supabase
      .from("profiles").select("id,full_name,bib_name").in("id", ids);
    // Not fatal: a missing name degrades one cell to "Unknown runner", whereas
    // throwing would hide every correct figure on the page behind a 500.
    if (error) { console.error("getEventSettlement profiles read failed", error); return; }
    for (const p of (data ?? []) as { id: string; full_name: string | null; bib_name: string | null }[]) {
      byId.set(p.id, { full_name: p.full_name, bib_name: p.bib_name });
    }
  }));
  return byId;
}

/**
 * One event's settlement, org-scoped.
 *
 * No explicit org filter on `payments`: `payments_read_org_admin` already scopes
 * SELECT to the caller's own organizations (and to everything for a super
 * admin), and already does it with `(select auth.uid())` + a sargable
 * `org_id in (…)`. Adding a second filter here would duplicate a rule that RLS
 * enforces, and duplicated authorization rules drift apart.
 *
 * The `org_id` returned alongside is a DIFFERENT rule, not a copy of that one.
 * `events` carries `events_read_published` (`using (status <> 'draft')`), so any
 * authenticated caller can read any non-draft event's name — which is fine for a
 * public race listing and wrong for a page headed "Settlement · <race>". Without
 * the page's own org check, an editor of org A pasting org B's event id gets B's
 * race name over an all-zero summary: no money leaks (RLS saw to that), but the
 * page silently reports "₱0 net" for an event that is not theirs. Same guard,
 * same reason, as app/(admin)/events/[id]/edit/page.tsx.
 *
 * Everything below fetches; every figure is decided in `lib/settlement-math.ts`,
 * where a test can reach it. This module cannot be unit-tested at all — the
 * Supabase server client imports next/headers — so the split is what makes the
 * arithmetic testable rather than merely reviewed.
 */
export async function getEventSettlement(eventId: string): Promise<EventSettlement | null> {
  const supabase = await createClient();

  const { data: ev, error: evErr } = await supabase
    .from("events")
    .select("name,org_id,organizations(name,fee_mode)")
    .eq("id", eventId)
    .maybeSingle();
  if (evErr) throw evErr;
  if (!ev) return null;

  const [pays, ratesRes, unrecRes, catsRes] = await Promise.all([
    // The money itself must never be guessed at: a failed — or truncated —
    // payments read throws rather than rendering an authoritative-looking
    // settlement that is missing rows.
    fetchAllPayments(supabase, eventId),
    supabase.from("processor_rates")
      .select("method,scope,percent_bps,fixed_cents,offered,note")
      .eq("provider", "paymongo").is("effective_to", null),
    supabase.rpc("payout_unreconciled_count", { p_event_id: eventId }),
    supabase.from("categories").select("slots_total,slots_taken").eq("event_id", eventId),
  ]);

  const userIds = [...new Set(
    pays.map((p) => p.registrations?.user_id).filter((id): id is string => !!id),
  )];
  // `profiles_read_org_admin` (20260722100000) scopes this to profiles of people
  // who registered in an org the caller administers — the same boundary the
  // payments read just cleared — so no second authorization rule is introduced.
  const names = await fetchRunnerNames(supabase, userIds);

  const rows = toSettlementRows(pays, names);
  const totals = settlementTotals(rows);

  const org = ev.organizations as unknown as { name: string; fee_mode: "absorb" | "pass_on" };

  let projected: EventSettlement["projected"] = null;
  if (org.fee_mode === "absorb") {
    // A failed read costs the page its projection banner and nothing else — a
    // forecast is not a ledger figure. Logged so neither failure is silent.
    if (ratesRes.error) console.error("getEventSettlement processor_rates read failed", ratesRes.error);
    if (catsRes.error) console.error("getEventSettlement categories read failed", catsRes.error);

    const { avgEntry: avg, avgCommission: comm } = soldAverages(rows);
    const remaining = remainingCapacity(
      (catsRes.data ?? []) as { slots_total: number; slots_taken: number }[],
    );
    const rates = forecastRates((ratesRes.data ?? []) as ProcessorRateCandidate[], avg);

    if (remaining !== null && rates) {
      // totals.net is the EXACT money already banked; only the unsold entries
      // are forecast. Null back means there is nothing left to forecast, and the
      // page then shows no band at all rather than one around a known figure.
      const range = projectedRange(totals.net, remaining, avg, comm, rates);
      if (range) projected = { ...range, remaining };
    }
  }

  return {
    event_name: ev.name as string,
    org_id: ev.org_id as string,
    org_name: org.name,
    rows, totals,
    feeMode: org.fee_mode,
    projected,
    // NOT `(unrec as number) ?? 0`. See unreconciledCount: a refusal or a
    // dropped call must reach the page as "unknown", which it renders as its own
    // banner, rather than as a zero that renders as nothing at all.
    unreconciled: unreconciledCount(unrecRes),
  };
}
