import { serviceClient } from "./supabase.ts";
import { buildGroupSessionRequest, createGroupSession, retrieveGroupSession, extractGroupCaptures } from "./groupPaymongo.ts";
import { mintTicketToken } from "./ticket.ts";

function credentials() {
  const secret = Deno.env.get("PAYMONGO_SECRET_KEY") ?? "";
  if (!/^sk_(test|live)_/.test(secret)) throw new Error("payment_provider_not_configured");
  return { secret, livemode: secret.startsWith("sk_live_") };
}
export async function startGroupPayment(actor: string, attemptId: string) {
  const db = serviceClient(), { secret, livemode } = credentials();
  const attempt = await db.from("booking_payment_attempts").select("*").eq("id", attemptId).eq("booked_by_user_id", actor).single();
  if (attempt.error || !attempt.data) throw new Error("attempt_not_found");
  const a = attempt.data;
  const saved = await db.from("booking_payment_dispatches").select("request_body").eq("attempt_id", attemptId).maybeSingle();
  if (saved.error) throw new Error("payment_unavailable");
  const base = Deno.env.get("GROUP_PAYMENT_RETURN_URL");
  if (!base && !saved.data) throw new Error("payment_return_not_configured");
  const returnUrl = new URL(base ?? "https://unused.invalid");
  returnUrl.searchParams.set("order_id", a.booking_order_id);
  const body = saved.data?.request_body ?? buildGroupSessionRequest({ attemptId: a.id, orderId: a.booking_order_id, method: a.method,
    baseCents: a.base_cents, platformFeeCents: a.platform_fee_cents, processorSurchargeCents: a.processor_surcharge_cents,
    grossCents: a.gross_cents, feeMode: a.terms_snapshot.fee_mode,
    providerManagedFee: a.terms_snapshot.provider_managed_fee === true,
    returnUrl: returnUrl.toString() });
  const claim = await db.rpc("booking_payment_claim_dispatch", { p_actor: actor, p_attempt: attemptId, p_request: body, p_livemode: livemode });
  if (claim.error) throw new Error(claim.error.message);
  if (claim.data.action !== "dispatch") return claim.data;
  try {
    const session = await createGroupSession(body, a.id, secret);
    const bound = await db.rpc("booking_payment_bind_session", { p_attempt: attemptId, p_session: session.sessionId, p_url: session.checkoutUrl });
    if (bound.error) throw new Error("session_write_failed");
    return { action: "ready", checkout_url: session.checkoutUrl };
  } catch {
    // Even a lost DB response can follow successful provider creation. Never
    // reopen this attempt or return an unpersisted URL after an uncertain call.
    await db.rpc("booking_payment_dispatch_unknown", { p_attempt: attemptId });
    throw new Error("payment_creation_unknown");
  }
}

/** Called only after booker authorization or verified webhook signature. */
export async function verifyGroupPayment(attemptId: string) {
  const db = serviceClient(), { secret, livemode } = credentials();
  const dispatch = await db.from("booking_payment_dispatches").select("session_id,livemode").eq("attempt_id", attemptId).single();
  if (dispatch.error || !dispatch.data?.session_id) throw new Error("session_not_ready");
  if (dispatch.data.livemode !== livemode) throw new Error("payment_environment_mismatch");
  const signingSecret = Deno.env.get("TICKET_SIGNING_SECRET");
  if (!signingSecret) throw new Error("ticket_signing_not_configured");
  const attempt = await db.from("booking_payment_attempts").select("booking_order_id").eq("id", attemptId).single();
  if (attempt.error) throw new Error("attempt_not_found");
  const order = await db.from("booking_orders").select("event_id").eq("id", attempt.data.booking_order_id).single();
  const lines = await db.from("booking_payment_quote_lines").select("registration_id").eq("attempt_id", attemptId);
  if (order.error || lines.error || !lines.data?.length) throw new Error("order_entries_changed");
  const raw = await retrieveGroupSession(dispatch.data.session_id, secret);
  const captures = extractGroupCaptures(raw);
  if (!captures.length) return { status: "pending" };
  const tokens: Record<string, string> = {};
  for (const line of lines.data) tokens[line.registration_id] = await mintTicketToken({ rid: line.registration_id, eid: order.data.event_id, iat: Math.floor(Date.now() / 1000) }, signingSecret);
  const states: string[] = [];
  for (const capture of captures) {
    const result = await db.rpc("booking_payment_confirm", { p_attempt: attemptId, p_capture: capture, p_tokens: tokens });
    if (result.error) throw new Error("payment_confirmation_unavailable");
    states.push(result.data);
  }
  return { status: states.includes("reconciliation_required") ? "reconciliation_required" : "paid" };
}
