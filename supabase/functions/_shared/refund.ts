import { serviceClient } from "./supabase.ts";
import { getPaymentProviderByName } from "./payments.ts";

export type RefundResult =
  | { ok: true; registration_id: string; already?: boolean; pending?: boolean }
  | { ok: false; error: string; status: number };

const REFUND_REASON = "requested_by_customer";

/** Refund a paid registration. Calls the payment provider FIRST (network) so a provider
 *  failure returns before any DB write; a 'succeeded' refund is finalized atomically via
 *  refund_registration_tx; a 'pending' refund is parked in payments.raw.refund and the
 *  slot is held until the refund.updated webhook settles it. Idempotent + race-safe. */
export async function refundRegistration(
  registrationId: string,
  refundedBy: string,
  note: string | null = null,
): Promise<RefundResult> {
  const db = serviceClient();
  const { data: reg, error: regErr } = await db
    .from("registrations").select("id,category_id,status").eq("id", registrationId).single();
  if (regErr || !reg) return { ok: false, error: "not_found", status: 404 };
  if (reg.status === "refunded") return { ok: true, registration_id: reg.id, already: true };
  if (reg.status !== "paid") return { ok: false, error: "not_refundable", status: 409 };

  const { data: pay } = await db
    .from("payments")
    .select(
      "provider,provider_ref,amount,net_to_org,raw," +
      "organizations!inner(refund_policy,refund_fee_cents)",
    )
    .eq("registration_id", reg.id).single();
  if (!pay) return { ok: false, error: "payment_not_found", status: 404 };

  const org = pay.organizations as unknown as
    { refund_policy: string; refund_fee_cents: number };

  // Refused server-side, not only in the console. The admin UI disables the
  // button for a 'none' org, but a Server Action is a public endpoint and the
  // boundary has to be here.
  if (org.refund_policy === "none") {
    return { ok: false, error: "policy_forbids", status: 409 };
  }

  // The runner is refunded exactly what the organizer would have been paid.
  // Race Pace's commission is an earned service fee and is retained; PayMongo
  // does not return its fee under any circumstances. Both are already excluded
  // from net_to_org, so this one line IS the policy.
  //
  // Clamped to net_to_org rather than to amount: an organizer cannot retain
  // money they were never going to receive. It is also what keeps a pass-on org
  // honest — there `pay.amount` is the GROSSED-UP total the runner paid, and
  // refunding from it would hand back the commission and the processor fee too.
  const retained = org.refund_policy === "flat_fee"
    ? Math.min(org.refund_fee_cents, pay.net_to_org)
    : 0;
  const refundAmount = pay.net_to_org - retained;
  // No computeFee here. Race Pace already kept its full commission at capture,
  // so re-striking it on the organizer's retention would charge twice.
  const retainedNet = retained;

  // A refund already in flight (parked pending by a prior call) — do not issue a second
  // provider refund; the refund.updated webhook will finalize it.
  const parked = (pay.raw as { refund?: { status?: string } } | null)?.refund;
  if (parked?.status === "pending") return { ok: true, registration_id: reg.id, pending: true, already: true };

  // 1) Provider refund — network, BEFORE any DB mutation.
  const provider = getPaymentProviderByName(pay.provider);
  let refund;
  try {
    // refundAmount, not pay.amount — the runner always gets back less than they
    // paid (commission and the processor fee are never returned), and under a
    // flat-fee policy less again. The provider is what actually moves it.
    refund = await provider.refund({ providerRef: pay.provider_ref ?? "", amount: refundAmount, reason: REFUND_REASON });
  } catch (e) {
    console.error("[refund] provider threw", { registrationId, error: String(e) });
    return { ok: false, error: "provider_refund_failed", status: 502 };
  }
  if (refund.status === "failed") {
    console.error("[refund] provider declined", { registrationId, providerRefundId: refund.providerRefundId });
    return { ok: false, error: "provider_refund_declined", status: 502 };
  }

  // 2) Pending — park it; the webhook finalizes. Do NOT flip status or release the slot.
  if (refund.status === "pending") {
    // The retained split is parked alongside the pending refund because the
    // webhook, not this function, finalizes it — and by then the org's policy may
    // have changed. Without this the webhook would settle a flat-fee refund as a
    // FULL one, refunding money the platform and organizer had agreed to keep.
    const raw = {
      ...((pay.raw as Record<string, unknown>) ?? {}),
      refund: {
        status: "pending", id: refund.providerRefundId,
        requested_at: new Date().toISOString(), refunded_by: refundedBy, note,
        refunded_amount: refundAmount, retained_net: retainedNet,
      },
    };
    const { error: upErr } = await db.from("payments").update({ raw }).eq("registration_id", reg.id);
    if (upErr) return { ok: false, error: "refund_pending_write_failed", status: 500 };
    return { ok: true, registration_id: reg.id, pending: true };
  }

  // 3) Succeeded — finalize atomically.
  const { data: result, error: rpcErr } = await db.rpc("refund_registration_tx", {
    p_registration_id: reg.id, p_refunded_by: refundedBy, p_note: note,
    p_provider_refund: refund.raw as Record<string, unknown>,
    p_refunded_amount: refundAmount, p_retained_net: retainedNet,
  });
  if (rpcErr) return { ok: false, error: "refund_write_failed", status: 500 };
  if (result === "already") return { ok: true, registration_id: reg.id, already: true };
  if (result === "not_paid") return { ok: false, error: "not_refundable", status: 409 };
  if (result === "not_found") return { ok: false, error: "not_found", status: 404 };
  return { ok: true, registration_id: reg.id };
}
