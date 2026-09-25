import { serviceClient } from "../_shared/supabase.ts";
import { allowedOrigins, isOriginAllowed, preflight, corsHeaders } from "../_shared/cors.ts";
import {
  isDefinitiveCheckoutRejection, paymongoConfigured, pmActivePaymentMethods,
  pmCreateCheckoutSession, PayMongoCheckoutError,
} from "../_shared/paymongo.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METHODS = new Set(["gcash", "paymaya", "card", "qrph"]);

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const cors = corsHeaders(req.headers.get("Origin"));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", ...cors },
  });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!jwt) return json({ error: "unauthorized" }, 401);
  const raw = await req.json().catch(() => ({}));
  if (!UUID.test(raw?.event_id ?? "") || !UUID.test(raw?.idempotency_key ?? "") || !METHODS.has(raw?.method)) {
    return json({ error: "invalid_input" }, 400);
  }
  const passportIds = raw?.passport_ids;
  if (!Array.isArray(passportIds) || passportIds.length < 1 || passportIds.length > 10 ||
      !passportIds.every((id: unknown) => typeof id === "string" && UUID.test(id)) ||
      new Set(passportIds).size !== passportIds.length) {
    return json({ error: "invalid_passports" }, 400);
  }
  let callback: URL;
  try {
    callback = new URL(raw.return_url);
  } catch { return json({ error: "invalid_return_url" }, 400); }
  if (!isOriginAllowed(callback.origin, allowedOrigins()) || callback.pathname !== "/reservations/callback" ||
      callback.search || callback.hash) return json({ error: "invalid_return_url" }, 400);
  if (!paymongoConfigured()) return json({ error: "payment_provider_unavailable" }, 503);

  const db = serviceClient();
  const { data: auth, error: authError } = await db.auth.getUser(jwt);
  const user = auth.user;
  if (authError || !user?.email || !user.email_confirmed_at || user.is_anonymous) {
    return json({ error: "verified_account_required" }, 401);
  }
  let methods: string[];
  try { methods = await pmActivePaymentMethods(); }
  catch { return json({ error: "payment_methods_unavailable" }, 503); }
  if (!methods.includes(raw.method)) return json({ error: "payment_method_unavailable" }, 409);
  const created = await db.rpc("reserve_event_passports", {
    p_event_id: raw.event_id, p_user_id: user.id,
    p_idempotency_key: raw.idempotency_key, p_provider: "paymongo", p_passport_ids: passportIds,
  });
  if (created.error) {
    if (created.error.message.includes("event_capacity_exhausted")) return json({ error: "event_capacity_exhausted" }, 409);
    if (created.error.message.includes("reservations_not_open")) return json({ error: "reservations_not_open" }, 409);
    if (created.error.message.includes("participant_already_reserved")) return json({ error: "participant_already_reserved" }, 409);
    if (created.error.message.includes("participant_not_accessible")) return json({ error: "participant_not_accessible" }, 403);
    if (created.error.message.includes("invalid_passports")) return json({ error: "invalid_passports" }, 400);
    if (created.error.message.includes("idempotency_conflict")) return json({ error: "idempotency_conflict" }, 409);
    if (created.error.code === "23505") {
      const active = await db.from("event_reservations").select("id,status")
        .eq("event_id", raw.event_id).eq("user_id", user.id)
        .in("status", ["pending", "paid", "review_required"]).maybeSingle();
      if (active.data) return json({ error: "reservation_exists", reservation_id: active.data.id, status: active.data.status }, 409);
    }
    console.error("[reservation-checkout] hold failed", { eventId: raw.event_id, code: created.error.code });
    return json({ error: "reservation_unavailable" }, 503);
  }
  const reservationId = created.data as string;
  const [reservationRead, paymentRead, profileRead] = await Promise.all([
    db.from("event_reservations").select("id,status,event_id,quantity,reservation_fee_cents,platform_fee_cents,checkout_expires_at,events(name,status)").eq("id", reservationId).single(),
    db.from("reservation_payments").select("id,status,provider_ref,checkout_url,checkout_request").eq("reservation_id", reservationId).single(),
    db.from("profiles").select("full_name,bib_name").eq("id", user.id).maybeSingle(),
  ]);
  const reservation = reservationRead.data;
  const payment = paymentRead.data;
  if (!reservation || !payment) return json({ error: "reservation_unavailable", reservation_id: reservationId }, 503);
  if (reservation.status === "paid") return json({ status: "paid", reservation_id: reservationId });
  if (reservation.status !== "pending" || payment.status !== "pending") {
    return json({ error: "reservation_not_payable", reservation_id: reservationId }, 409);
  }
  if (payment.provider_ref && payment.checkout_url) {
    return json({ reservation_id: reservationId, checkout_url: payment.checkout_url });
  }
  if (payment.checkout_request) {
    return json({ error: "checkout_reconciliation_required", reservation_id: reservationId }, 503);
  }
  if (Date.parse(reservation.checkout_expires_at) <= Date.now()) {
    return json({ error: "checkout_expired", reservation_id: reservationId }, 409);
  }
  const eventName = (reservation.events as unknown as { name?: string } | null)?.name ?? "Coming soon event";
  const lineItems = [{ name: `${eventName} reservation`, amount: reservation.reservation_fee_cents, currency: "PHP", quantity: reservation.quantity }];
  if (reservation.platform_fee_cents > 0) lineItems.push({ name: "Platform Fees", amount: reservation.platform_fee_cents, currency: "PHP", quantity: reservation.quantity });
  callback.searchParams.set("reservation_id", reservationId);
  const request = {
    lineItems, paymentMethodTypes: [raw.method], description: `${eventName} early reservation`,
    successUrl: new URL(callback.toString()), cancelUrl: new URL(callback.toString()),
    metadata: { reservation_id: reservationId },
    billing: { name: profileRead.data?.full_name ?? profileRead.data?.bib_name ?? undefined, email: user.email },
    passOnFees: true, idempotencyKey: `reservation:${reservationId}`,
  };
  request.successUrl.searchParams.set("status", "paid");
  request.cancelUrl.searchParams.set("status", "cancel");
  const frozen = await db.from("reservation_payments")
    .update({ checkout_request: {
      ...request, successUrl: request.successUrl.toString(), cancelUrl: request.cancelUrl.toString(),
    } })
    .eq("id", payment.id).eq("status", "pending").is("checkout_request", null).is("provider_ref", null)
    .select("id");
  if (frozen.error || !frozen.data?.length) {
    return json({ error: "checkout_reconciliation_required", reservation_id: reservationId }, 503);
  }
  let session;
  try {
    session = await pmCreateCheckoutSession({
      ...request, successUrl: request.successUrl.toString(), cancelUrl: request.cancelUrl.toString(),
    });
  } catch (error) {
    const providerError = error instanceof PayMongoCheckoutError ? error : null;
    console.error("[reservation-checkout] provider create failed", {
      reservationId, code: providerError?.code ?? "unknown", outcome: providerError?.outcome ?? "uncertain",
    });
    if (isDefinitiveCheckoutRejection(error)) {
      const released = await db.rpc("release_rejected_reservation_checkout", { p_reservation_id: reservationId });
      if (released.error || released.data !== true) {
        return json({ error: "checkout_reconciliation_required", reservation_id: reservationId }, 503);
      }
      return json({ error: "checkout_rejected", reservation_id: reservationId }, 503);
    }
    return json({ error: "checkout_reconciliation_required", reservation_id: reservationId }, 503);
  }
  if (!session.id?.startsWith("cs_") || !session.checkoutUrl?.startsWith("https://checkout.paymongo.com/")) {
    return json({ error: "checkout_reconciliation_required", reservation_id: reservationId }, 503);
  }
  const bound = await db.from("reservation_payments")
    .update({ provider_ref: session.id, checkout_url: session.checkoutUrl })
    .eq("id", payment.id).eq("status", "pending").is("provider_ref", null).select("id");
  if (bound.error || !bound.data?.length) {
    return json({ error: "checkout_reconciliation_required", reservation_id: reservationId }, 503);
  }
  return json({ reservation_id: reservationId, checkout_url: session.checkoutUrl });
});
