"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles } from "@/lib/queries/roles";
import { getPayLaterGrants } from "@/lib/queries/pay-later";
import { validPayLaterDay, type PayLaterGrant, type PayLaterPage, type PayLaterRunner } from "@/lib/pay-later";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const id = z.string().uuid();
const grantInput = z.object({ eventId: id, runnerId: id, dueDate: z.string().refine(validPayLaterDay) });
const queryInput = z.object({ eventId: id, query: z.string().trim().min(2).max(200) });
const pageInput = z.object({ eventId: id, page: z.number().int().min(0).max(100000) });

async function eventAccess(eventId: string) {
  const roles = await getMyRoles();
  if (!roles?.isOrgAdmin || !roles.orgId) return null;
  const db = await createClient();
  const { data, error } = await db.from("events").select("id").eq("id", eventId).eq("org_id", roles.orgId).maybeSingle();
  if (error) throw error;
  return data ? db : null;
}

export async function searchPayLaterRunnersAction(input: { eventId: string; query: string }): Promise<Result<PayLaterRunner[]>> {
  const parsed = queryInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter at least two characters or a full account email." };
  try {
    const db = await eventAccess(parsed.data.eventId);
    if (!db) return { ok: false, error: "You do not have permission to manage Pay Later for this event." };
    const { data, error } = await db.rpc("pay_later_search_runners", { p_event_id: parsed.data.eventId, p_query: parsed.data.query });
    if (error) throw error;
    return { ok: true, data: data ?? [] };
  } catch (error) {
    console.error("[pay-later] runner lookup failed", error);
    return { ok: false, error: "Runner accounts could not be loaded. Try again." };
  }
}

export async function grantPayLaterAction(input: { eventId: string; runnerId: string; dueDate: string }): Promise<Result<PayLaterGrant>> {
  const parsed = grantInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Select a runner and a valid payment due date." };
  try {
    const db = await eventAccess(parsed.data.eventId);
    if (!db) return { ok: false, error: "You do not have permission to manage Pay Later for this event." };
    const { data, error } = await db.rpc("pay_later_grant", {
      p_event_id: parsed.data.eventId, p_user_id: parsed.data.runnerId, p_due_date: parsed.data.dueDate,
    });
    if (error) {
      console.error("[pay-later] grant rejected", error);
      return { ok: false, error: error.code === "22023" && error.message === "runner_not_found" ? "This runner account is no longer available. Search again."
        : error.code === "22023" ? "Choose a future payment date before event day. Refresh if the event has changed."
        : error.code === "23505" ? "This runner already has a registration for this event. Open Registrations to view it."
        : error.code === "23514" ? "This event is no longer available for new Pay Later grants."
        : error.code === "42501" ? "You do not have permission to grant Pay Later for this event."
        : "The grant could not be confirmed. Refresh the roster to check before retrying." };
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.id) return { ok: false, error: "The grant could not be confirmed. Refresh the roster before retrying." };
    revalidatePath("/registrations/pay-later");
    const record = await getPayLaterGrants(parsed.data.eventId, 0, row.id);
    if (!record.rows[0]) return { ok: false, error: "The grant was saved but its record could not be loaded. Refresh the roster." };
    return { ok: true, data: record.rows[0] };
  } catch (error) {
    console.error("[pay-later] grant failed", error);
    return { ok: false, error: "The grant could not be confirmed. Refresh the roster to check before retrying." };
  }
}

export async function listPayLaterGrantsAction(input: { eventId: string; page: number }): Promise<Result<PayLaterPage>> {
  const parsed = pageInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid event and page." };
  try {
    if (!await eventAccess(parsed.data.eventId)) return { ok: false, error: "You do not have permission to view these approvals." };
    return { ok: true, data: await getPayLaterGrants(parsed.data.eventId, parsed.data.page) };
  } catch (error) {
    console.error("[pay-later] roster failed", error);
    return { ok: false, error: "Pay Later approvals could not be loaded. Try again." };
  }
}
