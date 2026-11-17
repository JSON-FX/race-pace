import { createClient } from "@/lib/supabase/server";
import { PAY_LATER_PAGE_SIZE, type PayLaterEvent, type PayLaterGrant, type PayLaterPage } from "@/lib/pay-later";

export async function getPayLaterEvents(orgId: string): Promise<PayLaterEvent[]> {
  const db = await createClient();
  const { data, error } = await db.from("events").select("id,name,event_date,status")
    .eq("org_id", orgId).order("event_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getPayLaterGrants(eventId: string, page = 0, grantId?: string): Promise<PayLaterPage> {
  const db = await createClient();
  const { data, error } = await db.rpc("pay_later_list_grants", {
    p_event_id: eventId, p_limit: PAY_LATER_PAGE_SIZE, p_offset: page * PAY_LATER_PAGE_SIZE,
    ...(grantId ? { p_grant_id: grantId } : {}),
  });
  if (error) throw error;
  const rows = (data ?? []) as PayLaterGrant[];
  return { rows, total: Number(rows[0]?.total_count ?? 0) };
}
