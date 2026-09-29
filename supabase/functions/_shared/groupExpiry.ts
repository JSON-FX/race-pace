import { serviceClient } from "./supabase.ts";
import { pmExpireCheckoutSession, pmGetCheckoutSession } from "./paymongo.ts";
import { verifyGroupPayment } from "./groupPaymentService.ts";

export async function reconcileExpiredGroup(orderId: string): Promise<string> {
  const db = serviceClient();
  const { data: order, error } = await db.from("booking_orders").select("id,status,expires_at").eq("id", orderId).single();
  if (error || !order) throw new Error("order_read_failed");
  if (order.status !== "pending") return order.status;
  if (!order.expires_at || Date.parse(order.expires_at) > Date.now()) return "not_due";
  const attempts = await db.from("booking_payment_attempts").select("id,status,booking_payment_dispatches(session_id)").eq("booking_order_id", orderId);
  if (attempts.error) throw new Error("attempt_read_failed");
  for (const attempt of attempts.data ?? []) {
    if (["prepared", "failed", "expired"].includes(attempt.status)) continue;
    if (attempt.status === "paid" || attempt.status === "reconciliation_required") return "capture_unresolved";
    const dispatch = attempt.booking_payment_dispatches as unknown as { session_id: string | null } | null;
    if (!dispatch?.session_id) return "unbound_provider_session";
    await pmExpireCheckoutSession(dispatch.session_id);
    const session = await pmGetCheckoutSession(dispatch.session_id);
    if (session.id !== dispatch.session_id) return "session_mismatch";
    if (session.paid) return (await verifyGroupPayment(attempt.id)).status;
    if (session.status !== "expired") return "provider_session_active";
    const finished = await db.rpc("prescreening_expire_group_attempt", { p_attempt: attempt.id, p_session: session.id,
      p_evidence: { source: "paymongo_get", status: "expired" } });
    if (finished.error) throw new Error("local_expiry_failed");
    if (finished.data !== "expired") return finished.data;
  }
  const finished = await db.rpc("finish_group_checkout_expiry", { p_order: orderId });
  if (finished.error) throw new Error("local_expiry_failed");
  return finished.data;
}
