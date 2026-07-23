import { serviceClient } from "./supabase.ts";
import { mintTicketToken } from "./ticket.ts";

export type ConfirmResult =
  | { ok: true; registration_id: string; already?: boolean }
  | { ok: false; error: string; status: number };

/** Mark a registration paid, mint its signed ticket, and increment the slot — in one
 *  atomic RPC. Idempotent: a second call on an already-paid registration is a no-op. */
export async function confirmPayment(
  registrationId: string,
  method: string,
  raw: unknown = {},
): Promise<ConfirmResult> {
  const db = serviceClient();
  const { data: reg } = await db
    .from("registrations")
    .select("id,event_id,total_amount,status,organizations(commission_rate)")
    .eq("id", registrationId)
    .single();
  if (!reg) return { ok: false, error: "not_found", status: 404 };
  if (reg.status === "paid") return { ok: true, registration_id: reg.id, already: true };
  if (reg.status !== "pending") return { ok: true, registration_id: reg.id, already: true }; // refunded/cancelled: no-op (replay-safe)

  const rate = (reg.organizations as { commission_rate: number } | null)?.commission_rate ?? 0.10;
  const fee = Math.round(reg.total_amount * rate);
  const net = reg.total_amount - fee;

  const secret = Deno.env.get("TICKET_SIGNING_SECRET") ?? "dev-secret";
  const token = await mintTicketToken(
    { rid: reg.id, eid: reg.event_id, iat: Math.floor(Date.now() / 1000) },
    secret,
  );

  const { data: result, error } = await db.rpc("confirm_payment_tx", {
    p_registration_id: reg.id,
    p_method: method,
    p_fee: fee,
    p_net: net,
    p_token: token,
    p_raw: (raw ?? {}) as Record<string, unknown>,
  });
  if (error) {
    console.error("[confirm] confirm_payment_tx failed", { registrationId: reg.id, error });
    return { ok: false, error: "confirm_write_failed", status: 500 };
  }
  return { ok: true, registration_id: reg.id, already: result === "already" || result === "not_pending" };
}
