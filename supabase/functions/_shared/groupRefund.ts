import { serviceClient } from "./supabase.ts";
import { pmCreateRefund, pmGetRefund } from "./paymongo.ts";

export interface GroupRefundInput {
  order_id: string;
  registration_ids?: string[];
  idempotency_key: string;
  preview: boolean;
  expected_amount?: number;
}
export async function refundGroup(actor: string, input: GroupRefundInput) {
  const db = serviceClient();
  const key = Deno.env.get("PAYMONGO_SECRET_KEY") ?? "";
  if (!input.preview && !/^sk_(test|live)_/.test(key)) throw new Error("provider_not_configured");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const scope = `paymongo:${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("")}`;
  const claim = await db.rpc("booking_refund_claim", {
    p_actor: actor, p_order: input.order_id, p_registration_ids: input.registration_ids ?? null,
    p_key: input.idempotency_key, p_expected_amount: input.expected_amount ?? null,
    p_preview: input.preview, p_provider_scope: scope, p_livemode: key.startsWith("sk_live_"),
  });
  if (claim.error) throw new Error(claim.error.message);
  const { action, request, ...amounts } = claim.data;
  // Private credentials and provider evidence never leave the service boundary.
  const result = (status: string) => ({ status, request_id: request?.id, ...amounts });
  if (!["submit", "reconcile"].includes(action)) return result(action);
  let refund;
  try {
    refund = action === "reconcile"
      ? await pmGetRefund(request.provider_refund_id)
      : await pmCreateRefund({ paymentId: request.payment_id, amount: request.refund_amount, requestId: request.id });
  } catch {
    if (action === "submit") {
      const saved = await db.rpc("booking_refund_unknown", { p_request: request.id });
      if (saved.error) throw new Error("refund_result_unavailable");
    }
    throw new Error("refund_provider_unknown");
  }
  const applied = await db.rpc("booking_refund_apply", { p_request: request.id, p_resource: (refund.raw as { data?: unknown })?.data ?? null });
  if (applied.error) throw new Error("refund_result_unavailable");
  return result(applied.data);
}

/** Called only after signature verification. Existing requests remain reconcilable
 * even when the rollout switch disables new staff submissions. */
export async function applyGroupRefundWebhook(resource: { id: string; attributes?: Record<string, unknown> }): Promise<boolean> {
  const db = serviceClient();
  const metadata = resource.attributes?.metadata as Record<string, unknown> | undefined;
  const requestId = metadata?.refund_request_id;
  const byProvider = await db.from("booking_refund_requests").select("id").eq("provider_refund_id", resource.id).maybeSingle();
  if (byProvider.error) throw new Error("group_refund_lookup_failed");
  let id = byProvider.data?.id;
  if (!id && typeof requestId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    const byRequest = await db.from("booking_refund_requests").select("id").eq("id", requestId).maybeSingle();
    if (byRequest.error) throw new Error("group_refund_lookup_failed");
    id = byRequest.data?.id;
  }
  if (!id) return false;
  const applied = await db.rpc("booking_refund_apply", { p_request: id, p_resource: resource });
  if (applied.error || applied.data === "review_required") throw new Error("group_refund_review_required");
  return true;
}
