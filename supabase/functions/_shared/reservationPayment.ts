import { serviceClient } from "./supabase.ts";
import { reportedPaidCaptures } from "./confirm.ts";
import { pmGetCheckoutSession, pmMethodFromSession } from "./paymongo.ts";

export type ReservationPaymentResult =
  | { status: "paid" | "pending" | "review_required" }
  | { status: "error"; error: string };

/** Both the signed webhook and the authenticated return path use provider GET. */
export async function verifyReservationPayment(reservationId: string): Promise<ReservationPaymentResult> {
  const db = serviceClient();
  const { data: payment, error } = await db.from("reservation_payments")
    .select("id,status,provider_ref,reservation_id")
    .eq("reservation_id", reservationId).maybeSingle();
  if (error || !payment) return { status: "error", error: "payment_not_found" };
  if (payment.status === "review_required") return { status: "review_required" };
  if (!payment.provider_ref?.startsWith("cs_")) {
    return payment.status === "paid" ? { status: "paid" } : { status: "pending" };
  }
  let session;
  try { session = await pmGetCheckoutSession(payment.provider_ref); }
  catch {
    // Provider retention can end after a confirmed capture. The local paid
    // ledger remains authoritative; a pending row must be retried later.
    return payment.status === "paid" ? { status: "paid" } : { status: "error", error: "provider_unavailable" };
  }
  if (session.id !== payment.provider_ref) return { status: "error", error: "session_mismatch" };
  if (!session.paid) return payment.status === "paid" ? { status: "paid" } : { status: "pending" };
  const captures = reportedPaidCaptures(session.raw);
  if (!captures.length) return payment.status === "paid" ? { status: "paid" } : { status: "pending" };
  const expectedLive = (Deno.env.get("PAYMONGO_SECRET_KEY") ?? "").startsWith("sk_live_");
  let reviewed = captures.length !== 1;
  for (const capture of captures) {
    if (!capture.id || !/^pay_[A-Za-z0-9_-]+$/.test(capture.id)) {
      return { status: "error", error: "invalid_capture_id" };
    }
    const valid = !reviewed && capture.currency === "PHP" && capture.livemode === expectedLive;
    const settled = await db.rpc("confirm_reservation_payment", {
      p_reservation_id: reservationId,
      p_provider_ref: payment.provider_ref,
      p_provider_payment_id: capture.id,
      p_amount_cents: valid ? capture.amount : -1,
      p_processor_fee_cents: capture.fee,
      p_provider_net_cents: capture.netAmount,
      p_method: pmMethodFromSession(session),
      p_raw: session.raw,
    });
    if (settled.error) return { status: "error", error: "capture_write_failed" };
    if (settled.data === "review_required") reviewed = true;
    else if (settled.data !== "paid" && settled.data !== "already_paid") {
      return { status: "error", error: "capture_state_unknown" };
    }
  }
  return { status: reviewed ? "review_required" : "paid" };
}
