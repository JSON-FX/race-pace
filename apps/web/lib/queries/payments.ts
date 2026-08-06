import { createClient } from "@/lib/supabase/server";
import type { TableParams } from "@/lib/table-params";
import { quotePostgrestValue } from "./events";
import type { PaymentStatus } from "./registrations";

export type PaymentRow = {
  registration_id: string;
  event_id: string | null;
  event_name: string | null;
  user_id: string | null;
  full_name: string | null;
  amount: number;
  platform_fee: number;
  net_to_org: number;
  method: string | null;
  status: PaymentStatus;
  created_at: string;
};

const SELECT =
  "registration_id,event_id,event_name,user_id,full_name,amount,platform_fee,net_to_org,method,status,created_at";

export async function listOrgPayments(
  orgId: string,
  params: TableParams,
): Promise<{ rows: PaymentRow[]; total: number }> {
  const supabase = await createClient();
  const from = (params.page - 1) * params.per;

  let req = supabase.from("admin_payments_v").select(SELECT, { count: "exact" }).eq("org_id", orgId);

  const status = params.filters.status ?? "all";
  if (status !== "all") req = req.eq("status", status);

  const method = params.filters.method ?? "all";
  if (method !== "all") req = req.eq("method", method);

  if (params.q.trim()) {
    const term = quotePostgrestValue(`%${params.q.trim()}%`);
    req = req.or(`full_name.ilike.${term},event_name.ilike.${term}`);
  }

  const s = params.sort[0] ?? { id: "created_at", desc: true };
  req = req.order(s.id, { ascending: !s.desc }).range(from, from + params.per - 1);

  const { data, error, count } = await req;
  if (error) throw error;
  return { rows: (data ?? []) as PaymentRow[], total: count ?? 0 };
}
