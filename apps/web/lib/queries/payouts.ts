import { createClient } from "@/lib/supabase/server";

/**
 * Payouts read model. Design 2026-08-06 §8, §9.1.
 *
 * Race Pace is the merchant of record: every payment lands in the platform's
 * account and the organizer is settled afterwards, PER EVENT. The settlement
 * unit is a `payout_statements` row, so this module's table rows ARE statements
 * — not events. That is deliberate and it is what makes the page honest:
 *
 *   - an event with no statement has not been cut yet, so there is nothing to
 *     pay and nothing to display a figure for;
 *   - a statement's amounts were frozen atomically by `payout_open_statement`
 *     against the payment rows that were unstamped at that instant.
 *
 * Recomputing those figures here from `payments` would be a second, later read
 * that could disagree with what the RPC actually committed — and disagreeing
 * with the ledger is the one thing a payout screen must never do. So nothing in
 * this module sums money; it reads the amounts the RPC already decided.
 */

export type PayoutStatementStatus = "open" | "paid";

/** The four states a payout row can be in. See `payoutRowState`. */
export type PayoutState = "ready" | "held" | "paid" | "owed_back";

export type PayoutStatementRow = {
  id: string;
  event_id: string;
  org_id: string;
  event_name: string;
  org_name: string;
  event_date: string | null;
  end_date: string | null;
  event_status: string | null;
  gross_cents: number;
  commission_cents: number;
  refunds_cents: number;
  net_owed_cents: number;
  status: PayoutStatementStatus;
  reference: string | null;
  note: string | null;
  opened_at: string;
  paid_at: string | null;
  /** Derived, not stored — see `isEventFinished`. */
  event_finished: boolean;
};

/**
 * An event is finished when its last day has passed, or when someone marked it
 * `completed` outright.
 *
 * `end_date` wins over `event_date` when present: a three-day stage race whose
 * `event_date` is day one is emphatically not finished on day two, and paying
 * it out then is paying it out early.
 *
 * Compared as ISO `YYYY-MM-DD` strings rather than as `Date` objects on
 * purpose. `event_date`/`end_date` are Postgres `date` columns — calendar days
 * with no time and no zone. `new Date("2026-09-07")` parses as UTC midnight,
 * so west of Greenwich it compares as "yesterday" and an event that is still
 * running reads as finished for several hours a day. Lexicographic comparison
 * of zero-padded ISO dates is ordinal comparison of calendar days, which is
 * exactly the question being asked.
 *
 * Strictly `<`: an event is not finished on its own last day, it is finished
 * once that day is over.
 */
export function isEventFinished(
  event: { event_date: string | null; end_date: string | null; event_status?: string | null },
  now: Date = new Date(),
): boolean {
  if (event.event_status === "completed") return true;
  const lastDay = event.end_date ?? event.event_date;
  if (!lastDay) return false;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return lastDay.slice(0, 10) < today;
}

/**
 * The one place a payout row's presentation is decided.
 *
 * Order matters, and each step is load-bearing:
 *
 * 1. `paid` first. A settled statement is history. Its sign is irrelevant —
 *    a negative statement that has already been recovered must read "paid",
 *    not re-offer a recovery that already happened.
 * 2. `owed_back` before `held`. A negative balance means clawbacks exceeded
 *    new earnings: the ORGANIZER owes Race Pace. Nothing is being transferred
 *    out, so "the event is still running" is not a reason to hold it — the
 *    held/ready distinction only governs money flowing outward. This row must
 *    NEVER render as a payout of minus money: a negative figure sitting under
 *    a "Mark paid" button is precisely how someone sends the money the wrong
 *    direction.
 * 3. `held` before `ready`. An event still taking registrations has a growing
 *    net figure, so paying it now means paying again later. Held rows are
 *    greyed WITH the reason rather than hidden, so "where's my money for
 *    Dumalinao?" is answerable straight off the screen.
 */
export function payoutRowState(row: {
  status: string;
  net_owed_cents: number;
  event_finished: boolean;
}): PayoutState {
  if (row.status === "paid") return "paid";
  if (row.net_owed_cents < 0) return "owed_back";
  if (!row.event_finished) return "held";
  return "ready";
}

const STATEMENT_SELECT =
  "id,event_id,org_id,gross_cents,commission_cents,refunds_cents,net_owed_cents," +
  "status,reference,note,opened_at,paid_at," +
  "events(name,event_date,end_date,status),organizations(name)";

type StatementJoinRow = {
  id: string;
  event_id: string;
  org_id: string;
  gross_cents: number;
  commission_cents: number;
  refunds_cents: number;
  net_owed_cents: number;
  status: PayoutStatementStatus;
  reference: string | null;
  note: string | null;
  opened_at: string;
  paid_at: string | null;
  events: { name: string; event_date: string | null; end_date: string | null; status: string | null } | null;
  organizations: { name: string } | null;
};

/**
 * Every payout statement, newest first, platform-wide.
 *
 * No org filter and no `requireOrgId`: payouts is a super-admin page about the
 * platform's obligations across ALL organizations, which is why it carries the
 * platform scope band instead of the org-scoped chrome. Row-level security on
 * `payout_statements` is `auth_is_super_admin()`, so a non-super-admin gets
 * zero rows here even if they reach the query — the page's `notFound()` guard
 * is the second lock, not the only one.
 */
export async function listPayoutStatements(): Promise<PayoutStatementRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payout_statements")
    .select(STATEMENT_SELECT)
    .order("opened_at", { ascending: false });
  if (error) throw error;

  const now = new Date();
  return ((data ?? []) as unknown as StatementJoinRow[]).map((r) => ({
    id: r.id,
    event_id: r.event_id,
    org_id: r.org_id,
    event_name: r.events?.name ?? "Unknown event",
    org_name: r.organizations?.name ?? "Unknown organization",
    event_date: r.events?.event_date ?? null,
    end_date: r.events?.end_date ?? null,
    event_status: r.events?.status ?? null,
    gross_cents: r.gross_cents,
    commission_cents: r.commission_cents,
    refunds_cents: r.refunds_cents,
    net_owed_cents: r.net_owed_cents,
    status: r.status,
    reference: r.reference,
    note: r.note,
    opened_at: r.opened_at,
    paid_at: r.paid_at,
    event_finished: isEventFinished(
      { event_date: r.events?.event_date ?? null, end_date: r.events?.end_date ?? null, event_status: r.events?.status ?? null },
      now,
    ),
  }));
}

export type OpenableEvent = {
  id: string;
  name: string;
  org_name: string;
  event_date: string | null;
  end_date: string | null;
  event_finished: boolean;
};

/**
 * Events the super admin may cut a NEW statement for — that is, every event
 * without a currently-open one.
 *
 * The exclusion mirrors the `payout_statements_one_open_per_event` partial
 * unique index, so the picker cannot offer a choice the database will reject.
 * PAID statements deliberately do not exclude an event: that is what lets a
 * later top-up statement collect money that arrived after an earlier
 * settlement, which is the whole reason opening is safe at any time.
 *
 * Unfinished events are included, not filtered out — opening early is allowed
 * (§8) and the UI confirms first rather than forbidding it.
 */
export async function listOpenableEvents(limit = 200): Promise<OpenableEvent[]> {
  const supabase = await createClient();

  const [{ data: openRows, error: openErr }, { data: eventRows, error: eventErr }] = await Promise.all([
    supabase.from("payout_statements").select("event_id").eq("status", "open"),
    supabase
      .from("events")
      .select("id,name,event_date,end_date,status,organizations(name)")
      .order("event_date", { ascending: false, nullsFirst: false })
      .limit(limit),
  ]);
  if (openErr) throw openErr;
  if (eventErr) throw eventErr;

  const taken = new Set((openRows ?? []).map((r) => (r as { event_id: string }).event_id));
  const now = new Date();

  type EventJoinRow = {
    id: string;
    name: string;
    event_date: string | null;
    end_date: string | null;
    status: string | null;
    organizations: { name: string } | null;
  };

  return ((eventRows ?? []) as unknown as EventJoinRow[])
    .filter((e) => !taken.has(e.id))
    .map((e) => ({
      id: e.id,
      name: e.name,
      org_name: e.organizations?.name ?? "Unknown organization",
      event_date: e.event_date,
      end_date: e.end_date,
      event_finished: isEventFinished(
        { event_date: e.event_date, end_date: e.end_date, event_status: e.status },
        now,
      ),
    }));
}

export type PayoutKpis = {
  readyCount: number;
  /** Net owed across READY rows only — what could be transferred right now. */
  totalOwedCents: number;
  heldCount: number;
  heldCents: number;
  paidThisMonthCount: number;
  paidThisMonthCents: number;
  owedBackCount: number;
  /** Positive magnitude of what organizers owe back, for display as "₱X owed back". */
  owedBackCents: number;
};

/**
 * KPI row above the table, derived from the SAME rows the table renders so the
 * two can never disagree — the failure mode `20260806190000_admin_kpi_
 * aggregates.sql` was written to prevent, avoided here by construction rather
 * than by keeping two queries in sync.
 *
 * "Total owed" counts READY rows only. Held money is genuinely owed eventually
 * but is not payable yet and its figure is still growing, so folding it into
 * one headline number would invite paying it. It gets its own tile.
 */
export function payoutKpis(rows: PayoutStatementRow[], now: Date = new Date()): PayoutKpis {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const k: PayoutKpis = {
    readyCount: 0, totalOwedCents: 0,
    heldCount: 0, heldCents: 0,
    paidThisMonthCount: 0, paidThisMonthCents: 0,
    owedBackCount: 0, owedBackCents: 0,
  };
  for (const r of rows) {
    switch (payoutRowState(r)) {
      case "ready":
        k.readyCount += 1;
        k.totalOwedCents += r.net_owed_cents;
        break;
      case "held":
        k.heldCount += 1;
        k.heldCents += r.net_owed_cents;
        break;
      case "owed_back":
        k.owedBackCount += 1;
        k.owedBackCents += -r.net_owed_cents;
        break;
      case "paid":
        if (r.paid_at && r.paid_at.slice(0, 7) === month) {
          k.paidThisMonthCount += 1;
          k.paidThisMonthCents += r.net_owed_cents;
        }
        break;
    }
  }
  return k;
}
