import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { TableParams } from "@/lib/table-params";
import { quotePostgrestValue, toIlikePattern } from "./events";

/** THE one place a raw `q` becomes a search pattern for this page — both
 *  `listEventRegistrations` (PostgREST `.or()`) and `getRegistrationAggregates`
 *  (RPC) call this, so a `*` (or any ILIKE metacharacter) in the search box
 *  can never desync the table from the KPI row above it. Returns `null` for
 *  a blank/whitespace-only term, the "no search filter" case both call sites
 *  already handle separately. See `toIlikePattern`'s doc comment for why
 *  this normalization has to happen before either transport, not in SQL. */
function searchPattern(q: string): string | null {
  const trimmed = q.trim();
  return trimmed ? toIlikePattern(trimmed) : null;
}

// Mirrors the Postgres `payment_status` enum (pending, paid, failed,
// refunded — see supabase/migrations/20260718182546_init_orgs_profiles.sql).
// `registration_status` is a DIFFERENT enum (pending, paid, refunded,
// cancelled) on a different column — this page filters on the
// `payment_status` column of `admin_registrations_v`, not that one.
export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export type RegistrationRow = {
  id: string;
  user_id: string;
  category_id: string;
  category_label: string | null;
  full_name: string | null;
  bib_name: string | null;
  /** From `admin_registration_emails` (see
   *  supabase/migrations/20260806200000_admin_registration_emails_rpc.sql),
   *  NOT `admin_registrations_v` — `auth.users.email` has no RLS policy
   *  granting `authenticated` direct read, so it can't be joined into a
   *  security_invoker view the way full_name/bib_name (both on `profiles`)
   *  are. Null if the emails RPC call failed (degrades gracefully, same
   *  posture as getRegistrationAggregates) or genuinely has no email. */
  email: string | null;
  total_amount: number;
  payment_status: PaymentStatus | null;
  payment_method: string | null;
  created_at: string;
  custom_data: Record<string, unknown>;
};

const SELECT =
  "id,user_id,category_id,category_label,full_name,bib_name,total_amount,payment_status,payment_method,custom_data,created_at";

export async function listEventRegistrations(
  eventId: string,
  params: TableParams,
): Promise<{ rows: RegistrationRow[]; total: number }> {
  const supabase = await createClient();
  const from = (params.page - 1) * params.per;

  let req = supabase
    .from("admin_registrations_v")
    .select(SELECT, { count: "exact" })
    .eq("event_id", eventId);

  const status = params.filters.status ?? "all";
  if (status !== "all") req = req.eq("payment_status", status);

  const category = params.filters.category ?? "all";
  if (category !== "all") req = req.eq("category_id", category);

  const pattern = searchPattern(params.q);
  if (pattern) {
    const term = quotePostgrestValue(pattern);
    req = req.or(`full_name.ilike.${term},bib_name.ilike.${term}`);
  }

  const s = params.sort[0] ?? { id: "created_at", desc: true };
  req = req.order(s.id, { ascending: !s.desc }).range(from, from + params.per - 1);

  const { data, error, count } = await req;
  if (error) throw error;
  const rows = (data ?? []) as Omit<RegistrationRow, "email">[];

  // Separate RPC, not a join — see RegistrationRow.email's doc comment for
  // why. Scoped to this event (not per-id) so it's one query regardless of
  // page size. Degrades to null emails on failure rather than failing the
  // whole page — the table's real content (names, amounts, status) must
  // still render even if this secondary lookup breaks.
  let emailById = new Map<string, string | null>();
  if (rows.length > 0) {
    const { data: emails, error: emailError } = await supabase.rpc("admin_registration_emails", {
      p_event_id: eventId,
    });
    if (emailError) {
      console.error("admin_registration_emails failed", emailError);
    } else {
      emailById = new Map(
        (emails ?? []).map((e: { registration_id: string; email: string | null }) => [e.registration_id, e.email]),
      );
    }
  }

  return {
    rows: rows.map((r) => ({ ...r, email: emailById.get(r.id) ?? null })),
    total: count ?? 0,
  };
}

/** Events for the picker, with their registration counts. */
export async function listOrgEventOptions(orgId: string): Promise<{ id: string; name: string; count: number }[]> {
  const supabase = await createClient();
  const [events, counts] = await Promise.all([
    supabase.from("events").select("id,name").eq("org_id", orgId).order("event_date", { ascending: false }),
    supabase.from("admin_event_reg_counts_v").select("event_id,reg_count").eq("org_id", orgId),
  ]);
  if (events.error) throw events.error;
  if (counts.error) throw counts.error;

  const byId = new Map((counts.data ?? []).map((c) => [c.event_id as string, c.reg_count as number]));
  return (events.data ?? []).map((e) => ({ id: e.id as string, name: e.name as string, count: byId.get(e.id as string) ?? 0 }));
}

/** Sidebar nav-count pill for Registrations — org-wide, not scoped to a
 *  single event (unlike listEventRegistrations). admin_registrations_v
 *  carries org_id directly (see supabase/migrations/20260804120000_admin_list_views.sql)
 *  so this is a single head:true count query, not a full list read. */
export const getOrgRegistrationCount = cache(async (orgId: string): Promise<number> => {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("admin_registrations_v")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);
  if (error) throw error;
  return count ?? 0;
});

export type RegistrationAggregates = {
  total: number;
  paid: number;
  grossCents: number;
  refundCount: number;
  refundedCents: number;
  newThisWeek: number;
};

const EMPTY_AGGREGATES: RegistrationAggregates = {
  total: 0,
  paid: 0,
  grossCents: 0,
  refundCount: 0,
  refundedCents: 0,
  newThisWeek: 0,
};

/** KPI-row aggregates for the Registrations page. Scoped to the SAME event and
 *  filters (status/category/q) as `listEventRegistrations` — computed by a
 *  Postgres RPC (see supabase/migrations/20260806190000_admin_kpi_aggregates.sql)
 *  over admin_registrations_v, the same view the table reads, so the cards can
 *  never disagree with the rows beneath them and never truncate at PostgREST's
 *  max-rows limit the way a client-side sum over `.select()` rows would.
 *
 *  Degrades to zeroes on failure rather than taking the page down — the table
 *  is the primary content, the KPI row is decoration on top of it. */
export async function getRegistrationAggregates(
  eventId: string,
  params: TableParams,
): Promise<RegistrationAggregates> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_registration_aggregates", {
    p_event_id: eventId,
    p_status: params.filters.status ?? "all",
    p_category_id: params.filters.category ?? "all",
    // Already a full `%...%` ILIKE pattern (or '' for "no filter") — see
    // searchPattern's doc comment. The RPC consumes this as-is.
    p_q: searchPattern(params.q) ?? "",
  });
  if (error) {
    console.error("getRegistrationAggregates failed", error);
    return EMPTY_AGGREGATES;
  }
  const row = data?.[0];
  if (!row) return EMPTY_AGGREGATES;
  return {
    total: row.total ?? 0,
    paid: row.paid ?? 0,
    grossCents: Number(row.gross_cents ?? 0),
    refundCount: row.refund_count ?? 0,
    refundedCents: Number(row.refunded_cents ?? 0),
    newThisWeek: row.new_this_week ?? 0,
  };
}

export async function listEventCategories(eventId: string): Promise<{ id: string; label: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories").select("id,label").eq("event_id", eventId).order("base_price", { ascending: false });
  if (error) throw error;
  return (data ?? []) as { id: string; label: string }[];
}
