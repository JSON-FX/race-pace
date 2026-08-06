import { createClient } from "@/lib/supabase/server";
import type { TableParams } from "@/lib/table-params";
import { quotePostgrestValue } from "./events";

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

  if (params.q.trim()) {
    const term = quotePostgrestValue(`%${params.q.trim()}%`);
    req = req.or(`full_name.ilike.${term},bib_name.ilike.${term}`);
  }

  const s = params.sort[0] ?? { id: "created_at", desc: true };
  req = req.order(s.id, { ascending: !s.desc }).range(from, from + params.per - 1);

  const { data, error, count } = await req;
  if (error) throw error;
  return { rows: (data ?? []) as RegistrationRow[], total: count ?? 0 };
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

export async function listEventCategories(eventId: string): Promise<{ id: string; label: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories").select("id,label").eq("event_id", eventId).order("base_price", { ascending: false });
  if (error) throw error;
  return (data ?? []) as { id: string; label: string }[];
}
