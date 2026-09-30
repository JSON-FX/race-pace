import { serviceClient } from "./supabase.ts";
import { mintTicketToken, requireTicketSigningSecret } from "./ticket.ts";
import { getPaymentProviderByName, type CheckoutInput } from "./payments.ts";
import { isDefinitiveCheckoutRejection } from "./paymongo.ts";

/** Free settlements use the same signed tickets, with no fabricated capture. */
export async function confirmFreeCheckout(
  actor: string,
  target: { registrationId?: string; orderId?: string },
) {
  const db = serviceClient();
  const secret = requireTicketSigningSecret(
    Deno.env.get("TICKET_SIGNING_SECRET"),
  );
  let query = db
    .from("registrations")
    .select("id,event_id")
    .eq("booked_by_user_id", actor);
  query = target.orderId
    ? query.eq("booking_order_id", target.orderId)
    : query.eq("id", target.registrationId!);
  const rows = await query;
  if (rows.error || !rows.data?.length)
    throw new Error("registration_not_found");
  const tokens: Record<string, string> = {};
  for (const r of rows.data)
    tokens[r.id] = await mintTicketToken(
      { rid: r.id, eid: r.event_id, iat: Math.floor(Date.now() / 1000) },
      secret,
    );
  const result = await db.rpc("discount_confirm_free", {
    p_actor: actor,
    p_registration: target.registrationId ?? null,
    p_order: target.orderId ?? null,
    p_tokens: tokens,
  });
  if (result.error) throw new Error(result.error.message);
  if (target.registrationId && result.data === "paid") {
    // The existing lifecycle outbox also observes paid transitions. This keeps
    // ticket delivery compatible with the single-entry confirmation path.
    await db.functions
      .invoke("send-ticket-email", {
        body: { registration_id: target.registrationId },
        headers: {
          Authorization: `Bearer ${Deno.env.get("TICKET_EMAIL_SECRET") ?? ""}`,
        },
      })
      .catch(() => undefined);
  }
  return { status: "paid", action: "paid" };
}

export async function dispatchDeferredCheckout(
  actor: string,
  registrationId: string,
) {
  const db = serviceClient();
  const claim = await db.rpc("discount_claim_single", {
    p_actor: actor,
    p_registration: registrationId,
  });
  if (claim.error) throw new Error(claim.error.message);
  if (claim.data.action === "free")
    return confirmFreeCheckout(actor, { registrationId });
  try {
    const checkout = await getPaymentProviderByName(
      claim.data.provider,
    ).createCheckout(claim.data.request as CheckoutInput);
    const saved = await db
      .from("payments")
      .update({
        provider_ref: checkout.providerRef,
        checkout_url: checkout.checkoutUrl,
        discount_checkout_state: "ready",
      })
      .eq("registration_id", registrationId)
      .eq("discount_checkout_state", "creating")
      .select("id")
      .single();
    if (saved.error) throw new Error("checkout_reconciliation_required");
    return { checkout_url: checkout.checkoutUrl };
  } catch (error) {
    // Only a definitive rejection permits returning to an editable state.
    if (isDefinitiveCheckoutRejection(error)) {
      const restored = await db
        .from("payments")
        .update({ discount_checkout_state: "prepared" })
        .eq("registration_id", registrationId)
        .is("provider_ref", null);
      if (!restored.error) throw new Error("payment_method_unavailable");
    }
    throw new Error("checkout_reconciliation_required");
  }
}

/** A provider GET, after expiry, is the only authority for unlocking a session. */
export async function restartDiscountCheckout(
  actor: string,
  registrationId: string,
) {
  const db = serviceClient();
  const row = await db
    .from("registrations")
    .select(
      "id,user_id,booked_by_user_id,booking_order_id,payments(provider,provider_ref)",
    )
    .eq("id", registrationId)
    .single();
  if (row.error || (row.data.booked_by_user_id ?? row.data.user_id) !== actor)
    throw new Error("registration_not_found");
  const payment = Array.isArray(row.data.payments)
    ? row.data.payments[0]
    : row.data.payments;
  if (
    row.data.booking_order_id ||
    payment?.provider !== "paymongo" ||
    !payment.provider_ref?.startsWith("cs_")
  )
    throw new Error("discount_payment_locked");
  const { pmExpireCheckoutSession, pmGetCheckoutSession, pmMethodFromSession } =
    await import("./paymongo.ts");
  await pmExpireCheckoutSession(payment.provider_ref);
  const session = await pmGetCheckoutSession(payment.provider_ref);
  if (session.id !== payment.provider_ref)
    throw new Error("discount_payment_locked");
  if (session.paid) {
    const { confirmPayment } = await import("./confirm.ts");
    await confirmPayment(registrationId, pmMethodFromSession(session), {
      source: "discount-restart",
      session_id: session.id,
      session: session.raw,
    });
    throw new Error("discount_payment_locked");
  }
  if (session.status !== "expired") throw new Error("discount_payment_locked");
  const result = await db.rpc("discount_restart_single", {
    p_actor: actor,
    p_registration: registrationId,
    p_session: session.id,
    p_evidence: { source: "paymongo_get", status: session.status },
  });
  if (result.error) throw new Error(result.error.message);
  return { status: "prepared" };
}
