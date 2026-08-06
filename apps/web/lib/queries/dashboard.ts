import { createClient } from "@/lib/supabase/server";

export type SignupPoint = { d: string; n: number };
export type FillRow = { eventId: string; name: string; taken: number; total: number };
export type DashboardData = {
  regCount: number; grossRevenue: number; netToOrg: number; platformFee: number; pendingCount: number;
  signups: SignupPoint[]; fill: FillRow[];
};

/** One row of the "Upcoming events" table. `regCount`/`grossRevenue` come from
 *  `admin_event_totals_v` rather than being counted here, so the figures match
 *  the ones the Registrations and Payments pages show for the same event —
 *  including the partially-refunded handling baked into that view. */
export type UpcomingEventRow = {
  id: string; name: string; eventDate: string | null; status: string;
  regCount: number; grossRevenue: number;
};

/**
 * SVG geometry for the sign-ups sparkline.
 *
 * Hand-rolled rather than pulling in a chart library: one series, no zoom, no
 * legend. Recharts is ~90 KB for this.
 *
 * A flat series is the case worth naming — max === min would divide by zero, so
 * it renders on a mid-height line instead of collapsing to the baseline (which
 * would read as "no sign-ups" rather than "a steady rate").
 */
export function buildSparkPath(points: SignupPoint[], w: number, h: number): { line: string; area: string } {
  if (points.length === 0) return { line: "", area: "" };
  const max = Math.max(...points.map((p) => p.n));
  const min = Math.min(...points.map((p) => p.n));
  const span = max - min;
  const x = (i: number) => (points.length === 1 ? 0 : (i / (points.length - 1)) * w);
  const y = (n: number) => (span === 0 ? h / 2 : h - ((n - min) / span) * h);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(p.n)}`).join(" ");
  return { line, area: `${line} V${h} H0 Z` };
}

export async function getOrgDashboard(orgId: string): Promise<DashboardData> {
  const supabase = await createClient();

  const [totals, signups, cats] = await Promise.all([
    supabase.from("admin_org_totals_v")
      // platform_fee is selected rather than derived as gross - net. The
      // `platform_fee + net_to_org == amount` invariant makes those equal
      // today, but the "after ₱X commission" caption is about the fee itself,
      // so it should read the column that means that.
      .select("reg_count,paid_count,pending_count,gross_revenue,net_to_org,platform_fee")
      .eq("org_id", orgId).maybeSingle(),
    supabase.rpc("admin_org_signups_daily", { p_org_id: orgId, p_days: 30 }),
    supabase.from("categories")
      .select("event_id,slots_total,slots_taken,events!inner(id,name,status)")
      .eq("org_id", orgId),
  ]);

  // Capacity lives on categories, not events — an event's fill rate is the sum
  // across its categories. Events with no slots_total are omitted rather than
  // shown at 0%, which would read as "nobody signed up" for an uncapped race.
  const byEvent = new Map<string, FillRow>();
  for (const c of (cats.data ?? []) as unknown as
    { event_id: string; slots_total: number | null; slots_taken: number | null;
      events: { id: string; name: string; status: string } }[]) {
    if (!c.slots_total) continue;
    const row = byEvent.get(c.event_id) ?? { eventId: c.event_id, name: c.events.name, taken: 0, total: 0 };
    row.taken += c.slots_taken ?? 0;
    row.total += c.slots_total;
    byEvent.set(c.event_id, row);
  }

  return {
    regCount: totals.data?.reg_count ?? 0,
    grossRevenue: Number(totals.data?.gross_revenue ?? 0),
    netToOrg: Number(totals.data?.net_to_org ?? 0),
    platformFee: Number(totals.data?.platform_fee ?? 0),
    pendingCount: totals.data?.pending_count ?? 0,
    signups: (signups.data ?? []) as SignupPoint[],
    fill: [...byEvent.values()].sort((a, b) => b.taken / b.total - a.taken / a.total).slice(0, 5),
  };
}

/** Local calendar date as `YYYY-MM-DD`. Deliberately not
 *  `toISOString().slice(0, 10)` — that is UTC, so for a Manila admin (UTC+8)
 *  every evening would report yesterday's date and an event starting today
 *  would drop out of the "next 60 days" window eight hours early. */
function localDay(offsetDays = 0): string {
  const t = new Date();
  t.setDate(t.getDate() + offsetDays);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/**
 * The "Upcoming events" table, plus the org's total event count.
 *
 * The count is what tells a brand-new org apart from a quiet one: with no
 * events at all the page owes the reader a "create your first event" prompt,
 * not four zeros and three empty cards, and `upcoming.length === 0` cannot
 * distinguish the two (an org whose whole season already ran also has none).
 */
export async function getOrgUpcomingEvents(
  orgId: string,
): Promise<{ eventCount: number; upcoming: UpcomingEventRow[] }> {
  const supabase = await createClient();

  const [all, window, totals] = await Promise.all([
    supabase.from("events").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase.from("events")
      .select("id,name,event_date,status")
      .eq("org_id", orgId)
      // Cancelled races are still "upcoming" by date but are not something the
      // organizer is preparing for, so they do not belong in this table.
      .neq("status", "cancelled")
      .gte("event_date", localDay())
      .lte("event_date", localDay(60))
      .order("event_date", { ascending: true })
      .limit(5),
    supabase.from("admin_event_totals_v").select("event_id,reg_count,gross_revenue").eq("org_id", orgId),
  ]);

  const byEvent = new Map<string, { reg_count: number; gross_revenue: number }>(
    (totals.data ?? []).map((t) => [t.event_id as string, t as { reg_count: number; gross_revenue: number }]),
  );

  return {
    eventCount: all.count ?? 0,
    upcoming: (window.data ?? []).map((e) => ({
      id: e.id as string,
      name: e.name as string,
      eventDate: (e.event_date as string | null) ?? null,
      status: e.status as string,
      // An event with no registrations has no row in admin_event_totals_v at
      // all (it groups over `registrations`), so a missing entry means zero.
      regCount: byEvent.get(e.id as string)?.reg_count ?? 0,
      grossRevenue: Number(byEvent.get(e.id as string)?.gross_revenue ?? 0),
    })),
  };
}
