import { serviceClient } from "./supabase.ts";
import { getPaymentProviderByName } from "./payments.ts";

export type RefundResult =
  | { ok: true; registration_id: string; already?: boolean; pending?: boolean; refund_amount?: number; total_paid?: number; retained_fees?: number }
  | { ok: false; error: string; status: number };

interface RefundRequest {
  id: string; registration_id: string; provider: string; provider_ref: string;
  provider_refund_id: string | null; refund_amount: number; retained_net: number;
  total_paid: number; status: string;
}
interface RefundClaim {
  action: "submit" | "reconcile" | "pending" | "already" | "preview" | "error";
  error?: string; request?: RefundRequest;
  refund_amount?: number; total_paid?: number; retained_fees?: number;
}

async function providerScope(): Promise<string> {
  const key = Deno.env.get("PAYMONGO_SECRET_KEY");
  if (!key) return "unconfigured";
  // PayMongo scopes idempotency to the API key. A rotation must not silently
  // turn an uncertain retry into a new refund under a different credential.
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return `paymongo:${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Claim and freeze the refund before network work. A timeout keeps ownership;
 *  later checks either GET the known refund or reuse its bounded idempotency key. */
export async function refundRegistration(
  registrationId: string,
  refundedBy: string,
  note: string | null = null,
  options: { preview?: boolean; expectedAmount?: number } = {},
): Promise<RefundResult> {
  const db = serviceClient();
  const { data, error } = await db.rpc("refund_request_claim", {
    p_registration_id: registrationId, p_refunded_by: refundedBy, p_note: note,
    p_expected_amount: options.expectedAmount ?? null, p_preview: options.preview === true,
    p_provider_scope: options.preview ? null : await providerScope(),
  });
  if (error || !data) return { ok: false, error: "refund_claim_failed", status: 500 };
  const claim = data as RefundClaim;
  if (claim.action === "error") {
    const reason = claim.error ?? "refund_claim_failed";
    return { ok: false, error: reason, status: ["not_found", "payment_not_found"].includes(reason) ? 404 : reason === "provider_not_configured" ? 503 : 409 };
  }
  const amounts = { refund_amount: claim.refund_amount, total_paid: claim.total_paid, retained_fees: claim.retained_fees };
  if (claim.action === "preview") return { ok: true, registration_id: registrationId, ...amounts };
  if (claim.action === "already") return { ok: true, registration_id: registrationId, already: true };
  if (claim.action === "pending") return { ok: true, registration_id: registrationId, pending: true, already: true, ...amounts };
  const request = claim.request;
  if (!request || (claim.action !== "submit" && claim.action !== "reconcile")) {
    return { ok: false, error: "refund_claim_invalid", status: 500 };
  }

  async function outcome(): Promise<RefundResult> {
    const { data: latest, error: readError } = await db.from("refund_requests").select("status,review_required").eq("id", request!.id).single();
    if (readError || !latest) return { ok: false, error: "refund_result_unavailable", status: 500 };
    if (latest.review_required) return { ok: false, error: "refund_review_required", status: 409 };
    if (latest.status === "succeeded") return { ok: true, registration_id: registrationId, ...amounts };
    const payment = await db.from("payments").select("status").eq("registration_id", registrationId).single();
    if (payment.error || !payment.data) return { ok: false, error: "refund_result_unavailable", status: 500 };
    if (["refunded", "partially_refunded"].includes(payment.data.status)) return { ok: true, registration_id: registrationId, already: true };
    if (latest.status === "failed") return { ok: false, error: "provider_refund_declined", status: 502 };
    return { ok: true, registration_id: registrationId, pending: true, ...amounts };
  }

  // An earlier callback may already be durable even if the worker crashed
  // before binding/applying it. Consume it before any provider read.
  if (request.provider_refund_id) {
    const applied = await db.rpc("refund_request_apply_event", { p_provider_refund_id: request.provider_refund_id });
    if (applied.error) return { ok: false, error: "refund_reconcile_failed", status: 500 };
    if (applied.data === "review_required") return { ok: false, error: "refund_review_required", status: 409 };
    const state = await outcome();
    if (!state.ok || !state.pending) return state;
  }

  const provider = getPaymentProviderByName(request.provider);
  let result;
  try {
    let providerPaymentId: string | undefined;
    if (request.provider === "paymongo" && !request.provider_refund_id) {
      const { data: captures, error: captureError } = await db.from("single_payment_captures")
        .select("provider_payment_id,session_id")
        .eq("registration_id", registrationId).eq("state", "settled").limit(2);
      if (captureError || (captures?.length ?? 0) > 1) throw new Error("refund_capture_lookup_failed");
      const capture = captures?.[0];
      if (capture) {
        if (capture.session_id !== request.provider_ref) throw new Error("refund_capture_session_mismatch");
        providerPaymentId = capture.provider_payment_id;
      }
    }
    result = claim.action === "reconcile" && request.provider_refund_id
      ? await provider.getRefund(request.provider_refund_id)
      : await provider.refund({
          providerRef: request.provider_ref, amount: request.refund_amount,
          providerPaymentId, reason: "requested_by_customer", requestId: request.id, registrationId,
        });
  } catch {
    if (claim.action === "submit") {
      const uncertain = await db.rpc("refund_request_uncertain", { p_request_id: request.id });
      if (uncertain.error) return { ok: false, error: "refund_uncertainty_write_failed", status: 500 };
    }
    return { ok: false, error: "provider_refund_failed", status: 502 };
  }

  const bound = await db.rpc("refund_request_bind", { p_request_id: request.id, p_provider_refund_id: result.providerRefundId });
  if (bound.error || !["bound", "already"].includes(bound.data)) {
    return { ok: false, error: "refund_pending_write_failed", status: 500 };
  }
  const resource = request.provider === "fake"
    ? { id: result.providerRefundId, type: "refund", attributes: {
        status: result.status, amount: request.refund_amount,
        metadata: { refund_request_id: request.id, registration_id: registrationId },
      } }
    : (result.raw as { data?: unknown })?.data;
  const stored = await db.rpc("refund_event_store", { p_resource: resource });
  if (stored.error || stored.data !== "stored") return { ok: false, error: "refund_event_write_failed", status: 500 };
  const applied = await db.rpc("refund_request_apply_event", { p_provider_refund_id: result.providerRefundId });
  if (applied.data === "review_required") return { ok: false, error: "refund_review_required", status: 409 };
  if (applied.error || !["applied", "already", "pending"].includes(applied.data)) {
    return { ok: false, error: "refund_reconcile_failed", status: 500 };
  }
  return outcome();
}
