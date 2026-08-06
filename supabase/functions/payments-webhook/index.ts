import { confirmPayment } from "../_shared/confirm.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { verifyWebhookSignature } from "../_shared/paymongo-webhook.ts";
import { pmMethodFromAttributes } from "../_shared/paymongo.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// PayMongo webhook. Verifies the signature, then routes:
//   checkout_session.payment.paid -> confirmPayment (authoritative; idempotent)
//   refund.updated (succeeded/failed) -> reconcile the async refund parked in payments.raw
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
      const rid = resource?.attributes?.metadata?.registration_id as string | undefined;
      if (!rid) return json({ ok: true, ignored: "no_registration_id" });
      // Shared with payment-verify so both confirm paths record the same
      // instrument. Also fixes a latent bug in the old inline `payments[0]`: a
      // session can carry a failed attempt followed by a successful one, and
      // [0] then reports the method the runner abandoned.
      const method = pmMethodFromAttributes(resource?.attributes);
      const r = await confirmPayment(rid, method, { source: "webhook", event: evt });
      if (!r.ok) return json({ error: r.error }, r.status); // surface failures so PayMongo retries
      return json({ ok: true, registration_id: r.registration_id });
    }

    if (type === "refund.updated") {
      const refundId = resource?.id as string | undefined;
      const status = resource?.attributes?.status as string | undefined;
      if (!refundId) return json({ ok: true, ignored: "no_refund_id" });
      const { data: pay } = await db.from("payments").select("registration_id,raw").filter("raw->refund->>id", "eq", refundId).maybeSingle();
      if (!pay) return json({ ok: true, ignored: "unknown_refund" });
      // deno-lint-ignore no-explicit-any
      const parked = (pay.raw as any)?.refund ?? {};
      if (status === "succeeded") {
        // The retained split was computed and parked when the refund was
        // REQUESTED (_shared/refund.ts), not now: the org's policy may have
        // changed since, and the provider has already moved the parked amount.
        // Passing null here would settle a flat-fee refund as a full one and
        // hand back money both parties had agreed to keep.
        const { error: rpcErr } = await db.rpc("refund_registration_tx", {
          p_registration_id: pay.registration_id,
          p_refunded_by: parked.refunded_by ?? null,
          p_note: parked.note ?? null,
          p_provider_refund: resource,
          p_refunded_amount: parked.refunded_amount ?? null,
          p_retained_fee: parked.retained_fee ?? 0,
          p_retained_net: parked.retained_net ?? 0,
        });
        if (rpcErr) {
          console.error("[webhook] refund_registration_tx failed", rpcErr);
          return json({ error: "refund_reconcile_failed" }, 500); // surface so PayMongo retries
        }
      } else if (status === "failed") {
        const raw2 = { ...((pay.raw as Record<string, unknown>) ?? {}), refund: { ...parked, status: "failed" } };
        const { error: upErr } = await db.from("payments").update({ raw: raw2 }).eq("registration_id", pay.registration_id);
        if (upErr) {
          console.error("[webhook] refund flag update failed", upErr);
          return json({ error: "refund_flag_failed" }, 500);
        }
      }
      return json({ ok: true });
    }

    return json({ ok: true, ignored: type ?? "unknown" });
  } catch (e) {
    console.error("[webhook] handler error", e);
    return json({ error: "server_error" }, 500);
  }
});
