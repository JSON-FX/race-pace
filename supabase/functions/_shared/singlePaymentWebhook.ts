import { confirmPayment, reportedPaidCaptures } from "./confirm.ts";
import { pmGetCheckoutSession, pmMethodFromAttributes, pmMethodFromSession } from "./paymongo.ts";
import { serviceClient } from "./supabase.ts";

/** A payment.paid resource is not a checkout session. Bind it through provider
 * GET before settlement; never infer a cs_ identity from notification metadata. */
export async function confirmSinglePaymentWebhook(registrationId: string, event: {
  data: { attributes: { type: string; data: { id: string; attributes: Record<string, unknown> } } };
}) {
  const resource = event.data.attributes.data;
  if (event.data.attributes.type === "checkout_session.payment.paid") {
    return confirmPayment(registrationId, pmMethodFromAttributes(resource.attributes), { source: "webhook", event });
  }
  if (!/^pay_[A-Za-z0-9_-]+$/.test(resource.id) || resource.attributes.status !== "paid") {
    return { ok: false as const, error: "provider_capture_invalid", status: 503 };
  }
  const db = serviceClient();
  const known = await db.from("single_payment_captures").select("registration_id,session_id,fee_cents,net_cents")
    .eq("provider_payment_id", resource.id).maybeSingle();
  if (known.error) throw new Error("capture_read_failed");
  if (known.data?.registration_id === registrationId) {
    // A replay must remain verifiable after provider checkout retention ends.
    // confirmPayment still checks every signed amount against the stored capture.
    // Bare paid events may omit fees already supplied by the canonical checkout.
    // Keep those verified values; conflicting supplied values still enter review.
    const replay = { ...resource, attributes: { ...resource.attributes,
      fee: resource.attributes.fee === undefined ? known.data.fee_cents : resource.attributes.fee,
      net_amount: resource.attributes.net_amount === undefined ? known.data.net_cents : resource.attributes.net_amount,
    } };
    const session = { data: { id: known.data.session_id, attributes: { payments: [replay] } } };
    return confirmPayment(registrationId, pmMethodFromAttributes(session.data.attributes), { source: "webhook", event, session });
  }
  const payment = await db.from("payments").select("provider_ref")
    .eq("registration_id", registrationId).single();
  if (payment.error || !payment.data?.provider_ref?.startsWith("cs_")) throw new Error("session_not_ready");
  const session = await pmGetCheckoutSession(payment.data.provider_ref);
  if (session.id !== payment.data.provider_ref) throw new Error("session_identity_mismatch");
  const captures = reportedPaidCaptures(session.raw);
  if (!captures.some((capture) => capture.id === resource.id)) {
    const sessionIntent = (session.raw as { data?: { attributes?: { payment_intent?: { id?: string } } } })
      ?.data?.attributes?.payment_intent?.id;
    const notifiedIntent = resource.attributes.payment_intent_id;
    const differentIntent = typeof sessionIntent === "string" && typeof notifiedIntent === "string" &&
      sessionIntent !== notifiedIntent;
    // Early notifications can precede a consistent GET. Do not acknowledge or
    // permanently mark that genuine payment invalid while its session is unpaid.
    if (!captures.length && !differentIntent) return { ok: false as const, error: "capture_not_visible", status: 503 };
    // A different charge on an already captured session is real money too.
    // Preserve it in the existing review inbox without inventing a session link.
    const unbound = { data: { id: null, attributes: { payments: [resource] } } };
    return confirmPayment(registrationId, pmMethodFromAttributes(unbound.data.attributes), { source: "webhook", event, session: unbound });
  }
  return confirmPayment(registrationId, pmMethodFromSession(session), { source: "webhook", event, session: session.raw });
}
