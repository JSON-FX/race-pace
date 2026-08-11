import { serviceClient } from "./supabase.ts";
import { mintTicketToken } from "./ticket.ts";
import { computeFee, type FeeTerms } from "./fee.ts";

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
    // All three commission columns, not just the rate. Fetching only
    // commission_rate would make a 'fixed' org fall through to the percent
    // branch's `?? 0.10` default and be charged 10% instead of its flat fee —
    // silently, and only visible as wrong money weeks later.
    .select(
      "id,event_id,total_amount,status," +
      "organizations(commission_type,commission_rate,commission_flat_cents)",
    )
    .eq("id", registrationId)
    .single();
  if (!reg) return { ok: false, error: "not_found", status: 404 };
  if (reg.status === "paid") return { ok: true, registration_id: reg.id, already: true };
  // refunded/cancelled: no-op (replay-safe), never re-confirm. 'expired' is
  // deliberately NOT short-circuited here — it must reach confirm_payment_tx
  // so the resurrect/conflict logic below actually runs. Returning early for
  // 'expired' (as this used to) would silently swallow a late capture instead
  // of resurrecting the registration or flagging a conflict.
  if (reg.status === "refunded" || reg.status === "cancelled") {
    return { ok: true, registration_id: reg.id, already: true };
  }

  // The org's terms are read ONCE here and frozen onto the payment row below, so
  // a later rate change is never retroactive.
  const terms = (reg.organizations as FeeTerms | null) ?? {
    commission_type: "percent", commission_rate: 0.10, commission_flat_cents: 0,
  };
  const fee = computeFee(reg.total_amount, terms);
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
  if (result === "conflict") {
    // Money captured against a registration that expired, and the runner has
    // since taken a live entry for the same event. Confirming would hand them
    // two slots; doing nothing silently keeps their money. Neither is
    // acceptable, so make it findable and refund by hand.
    console.error(
      `[webhook] CAPTURE CONFLICT registration=${reg.id} — payment captured on an expired registration ` +
        `while a live entry exists for the same runner+event. MANUAL REFUND REQUIRED.`,
    );
    // No registration/payment/ticket state changed, so this is not a genuine
    // confirmation and must not fall through to the ticket-email step below.
    return { ok: true, registration_id: reg.id, already: true };
  }
  const already = result === "already" || result === "not_pending";

  // DELIBERATELY no event-status check here, unlike registrations-checkout and
  // payment-session. By the time this runs PayMongo has already captured the
  // money. Rejecting a cancelled event's payment at this point would leave a
  // runner charged with no registration row — and the refund flow needs a row
  // to find. The doors that matter close BEFORE money moves; this last step
  // stays permissive so anything that slips through is still refundable.

  // Fire the ticket email only on a genuine first confirmation, and only as
  // best-effort — a mail failure must never fail a captured payment. This is
  // the single choke point both payment-verify and payments-webhook reach, so
  // exactly one email is sent no matter which path confirms.
  if (!already) {
    try {
      // send-ticket-email now gates on TICKET_EMAIL_SECRET in the
      // Authorization header instead of trusting any caller (the
      // registration id leaks into the shared /ticket/<rid> URL, so it can't
      // be the only credential). A missing secret here just means the mail
      // gets rejected — caught below, same as any other send failure.
      const ticketEmailSecret = Deno.env.get("TICKET_EMAIL_SECRET") ?? "";
      await db.functions.invoke("send-ticket-email", {
        body: { registration_id: reg.id },
        headers: { Authorization: `Bearer ${ticketEmailSecret}` },
      });
    } catch (e) {
      console.error("[confirm] ticket email failed", { registrationId: reg.id, error: String(e) });
    }
  }

  return { ok: true, registration_id: reg.id, already };
}
