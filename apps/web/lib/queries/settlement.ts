import { createClient } from "@/lib/supabase/server";
import type { SettlementRow } from "@/lib/settlement-csv";
import {
  settlementTotals, projectedRange, unreconciledCount,
  type ProcessorRateLite, type SettlementTotals,
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
  /** Only meaningful in absorb mode, where the organizer's net depends on how
   *  runners happen to pay. Null in pass-on mode, where it is a fixed figure. */
  projected: { low: number; high: number } | null;
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

type Join = {
  registration_id: string; amount: number; platform_fee: number;
  processor_fee_cents: number; processor_fee_source: string; net_to_org: number;
  status: string; refunded_amount: number; method: string | null; created_at: string;
  registrations: {
    user_id: string | null;
    categories: { label: string } | null;
  } | null;
};

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
 */
export async function getEventSettlement(eventId: string): Promise<EventSettlement | null> {
  const supabase = await createClient();

  const { data: ev, error: evErr } = await supabase
    .from("events")
    .select("name,org_id,organizations(name,fee_mode,commission_type,commission_rate,commission_flat_cents)")
    .eq("id", eventId)
    .maybeSingle();
  if (evErr) throw evErr;
  if (!ev) return null;

  const [paysRes, ratesRes, unrecRes] = await Promise.all([
    supabase.from("payments").select(SELECT).eq("registrations.event_id", eventId),
    supabase.from("processor_rates")
      .select("method,scope,percent_bps,fixed_cents")
      .eq("provider", "paymongo").is("effective_to", null),
    supabase.rpc("payout_unreconciled_count", { p_event_id: eventId }),
  ]);
  // The money itself must never be guessed at. A failed payments read throws
  // rather than rendering an empty, authoritative-looking ₱0 settlement.
  if (paysRes.error) throw paysRes.error;

  const pays = (paysRes.data ?? []) as unknown as Join[];

  // Runner names, keyed on user_id, because the embed above cannot reach them.
  // `profiles_read_org_admin` (20260722100000) scopes this to profiles of people
  // who registered in an org the caller administers — the same boundary the
  // payments read just cleared — so no second authorization rule is introduced.
  const userIds = [...new Set(pays.map((p) => p.registrations?.user_id).filter((id): id is string => !!id))];
  const nameById = new Map<string, { full_name: string | null; bib_name: string | null }>();
  if (userIds.length > 0) {
    const { data: profiles, error: profErr } = await supabase
      .from("profiles").select("id,full_name,bib_name").in("id", userIds);
    // Not fatal: a missing name degrades one cell to "Unknown runner", whereas
    // throwing would hide every correct figure on the page behind a 500.
    if (profErr) console.error("getEventSettlement profiles read failed", profErr);
    for (const p of (profiles ?? []) as { id: string; full_name: string | null; bib_name: string | null }[]) {
      nameById.set(p.id, { full_name: p.full_name, bib_name: p.bib_name });
    }
  }

  const rows: SettlementRow[] = pays.map((p) => {
    const who = p.registrations?.user_id ? nameById.get(p.registrations.user_id) : undefined;
    return {
      registration_id: p.registration_id,
      runner_name: who?.full_name ?? who?.bib_name ?? "Unknown runner",
      category: p.registrations?.categories?.label ?? "—",
      paid_at: p.created_at,
      method: p.method,
      gross_paid: p.amount,
      rp_commission: p.platform_fee,
      // A 'historical' fee was absorbed by the platform, not deducted from the
      // organizer. Reporting it in their column would show them a cost they never
      // paid — see the ledger-invariant note on payments.processor_fee_source,
      // and the identical filter in payout_open_statement (20260811095000).
      processing_fee: p.processor_fee_source === "historical" ? 0 : p.processor_fee_cents,
      net_to_org: p.net_to_org,
      status: p.status,
      refunded_amount: p.refunded_amount,
      // `payments` has no refunded_at column — the refund RPCs stamp it into
      // `raw` (20260807090400). Left null rather than dug out of jsonb, which is
      // what the CSV's own column already expects.
      refunded_at: null,
    };
  });

  const org = ev.organizations as unknown as {
    name: string; fee_mode: "absorb" | "pass_on";
    commission_type: string; commission_rate: number | null; commission_flat_cents: number;
  };
  const totals = settlementTotals(rows);

  let projected: { low: number; high: number } | null = null;
  if (org.fee_mode === "absorb" && rows.length > 0) {
    // A failed rate read costs the page its projection banner, nothing else —
    // the banner is a forecast, not a ledger figure. Logged so it is not silent.
    if (ratesRes.error) console.error("getEventSettlement processor_rates read failed", ratesRes.error);
    const local = (ratesRes.data ?? []).filter((r) => r.scope === "local") as ProcessorRateLite[];
    if (local.length > 0) {
      const cost = (r: ProcessorRateLite) => r.percent_bps * 100 + r.fixed_cents;
      const cheap = local.reduce((a, b) => (cost(a) <= cost(b) ? a : b));
      const dear = local.reduce((a, b) => (cost(a) >= cost(b) ? a : b));
      const paid = rows.filter((r) => r.status !== "refunded");
      const avg = paid.length
        ? Math.round(paid.reduce((s, r) => s + r.gross_paid, 0) / paid.length) : 0;
      const comm = paid.length
        ? Math.round(paid.reduce((s, r) => s + r.rp_commission, 0) / paid.length) : 0;
      projected = projectedRange(paid.length, avg, comm, { cheap, dear });
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
