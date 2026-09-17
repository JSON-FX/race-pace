import { confirmPayment } from "../_shared/confirm.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { refundResourcesFromEvent, verifyWebhookSignature } from "../_shared/paymongo-webhook.ts";
import { pmMethodFromAttributes } from "../_shared/paymongo.ts";
import { applyGroupRefundWebhook } from "../_shared/groupRefund.ts";
import { verifyGroupPayment } from "../_shared/groupPaymentService.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// PayMongo webhook. Verifies the signature, then routes:
//   checkout_session.payment.paid -> confirmPayment (authoritative; idempotent)
//   payment.refund.updated / payment.refunded (succeeded/failed) -> persist and reconcile the durable refund request
Deno.serve(async (req) => {
  try {
    const raw = await req.text();
    const secret = Deno.env.get("PAYMONGO_WEBHOOK_SECRET") ?? "";
    if (!(await verifyWebhookSignature(raw, req.headers.get("Paymongo-Signature"), secret))) {
      return json({ error: "invalid_signature" }, 401);
    }

    const evt = JSON.parse(raw);
    const type = evt?.data?.attributes?.type as string | undefined;
    const resource = evt?.data?.attributes?.data;
    const db = serviceClient();

    if (type === "checkout_session.payment.paid" || type === "payment.paid") {
      const attemptId = resource?.attributes?.metadata?.payment_attempt_id;
      if (attemptId) {
        if (Deno.env.get("GROUP_PAYMENTS_ENABLED") !== "true") return json({ error: "group_checkout_not_available" }, 503);
        if (typeof attemptId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attemptId)) {
          return json({ error: "invalid_group_attempt" }, 400);
        }
        // Re-fetch the stored session. Metadata routes the notification; it
        // does not replace verification of the bound provider capture.
        const verified = await verifyGroupPayment(attemptId);
        // A paid notification can precede the provider GET becoming consistent.
        // Acknowledge only a durable capture outcome, not an unpaid snapshot.
        if (verified.status === "pending") return json({ error: "group_capture_not_visible" }, 503);
        return json(verified);
      }
      const rid = resource?.attributes?.metadata?.registration_id as string | undefined;
      if (!rid) return json({ ok: true, ignored: "no_registration_id" });
      // Shared with payment-verify so both confirm paths record the same
      // instrument. Also fixes a latent bug in the old inline `payments[0]`: a
      // session can carry a failed attempt followed by a successful one, and
      // [0] then reports the method the runner abandoned.
      const method = pmMethodFromAttributes(resource?.attributes);
      const r = await confirmPayment(rid, method, { source: "webhook", event: evt });
      if (!r.ok && r.error === "capture_review_required") {
        // The signed capture is durably recorded and blocks payout. A retry
        // cannot fix an extra charge or amount mismatch; alert staff instead.
        return json({ ok: true, review_required: true });
      }
      if (!r.ok) return json({ error: r.error }, r.status); // transient failures can retry
      return json({ ok: true, registration_id: r.registration_id });
    }

    const refunds = refundResourcesFromEvent(type, resource);
    if (refunds !== null) {
      if (!refunds.length) return json({ error: "invalid_refund_resource" }, 400);
      for (const refundResource of refunds) {
        if (await applyGroupRefundWebhook(refundResource)) continue;
        // Commit the signed resource before acknowledgment. An early callback
        // remains available even when the provider response has not bound its ID.
        const stored = await db.rpc("refund_event_store", { p_resource: refundResource });
        if (stored.error || stored.data !== "stored") return json({ error: "refund_event_write_failed" }, 500);
        const applied = await db.rpc("refund_request_apply_event", { p_provider_refund_id: refundResource.id });
        if (applied.data === "review_required") return json({ error: "refund_review_required" }, 500);
        if (applied.error || applied.data === "invalid") return json({ error: "refund_reconcile_failed" }, 500);
        // Unmatched is safe to acknowledge only because the inbox write above
        // committed. Binding or an authenticated refund check consumes it later.
      }
      return json({ ok: true });
    }

    return json({ ok: true, ignored: type ?? "unknown" });
  } catch (e) {
    console.error("[webhook] handler error", e);
    return json({ error: "server_error" }, 500);
  }
});
