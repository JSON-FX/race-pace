import { serviceClient } from "./supabase.ts";
import { mintTicketToken } from "./ticket.ts";
import { computeFee, type FeeTerms } from "./fee.ts";
import { predictProcessorFee, type ProcessorRate } from "./processorFee.ts";
import { pmFeeFromAttributes } from "./paymongo.ts";

export type ConfirmResult =
  | { ok: true; registration_id: string; already?: boolean }
  | { ok: false; error: string; status: number };

/**
 * What PayMongo reported it actually charged — or null if this payload does not
 * carry a figure we are entitled to call 'actual'.
 *
 * TWO things have to be true, and both have burned this codebase before.
 *
 * 1. FINDING the payload. No caller passes confirmPayment a bare PayMongo
 *    object; each wraps it. payment-verify sends {source, session_id, session}
 *    where `session` is the whole GET body; payments-webhook sends
 *    {source, event} where the checkout session sits at
 *    event.data.attributes.data. Reading `raw.data.attributes` — the shape of
 *    PayMongo's own response — finds nothing in either, and "nothing" is not a
 *    loud failure: it silently downgrades every payment to 'predicted' forever.
 *    The candidates below are ordered most-specific first and each must actually
 *    carry a `payments` array to be chosen.
 *
 * 2. TRUSTING the payload. pmFeeFromAttributes picks the paid payment when there
 *    is one and otherwise falls back to payments[0] — which, on a session where
 *    nothing was captured, is a FAILED attempt. Its `fee`/`net_amount` are
 *    typically typed zeros, so it returns a well-formed {fee: 0, ...} that even
 *    satisfies the caller's amount - fee = net_amount check. Recorded as
 *    'actual', that overpays the organizer by exactly the processor's cut on a
 *    payment that never happened. So: require a genuinely captured payment
 *    first. The predicate here is deliberately IDENTICAL to the one
 *    pmFeeFromAttributes uses for its .find(), over the same array — which is
 *    what makes "a paid payment exists" equivalent to "the fallback was not
 *    used", rather than merely correlated with it.
 */
// deno-lint-ignore no-explicit-any
export function reportedProcessorFee(
  raw: unknown,
): { fee: number; netAmount: number; amount: number } | null {
  // deno-lint-ignore no-explicit-any
  const r = raw as any;
  const candidates = [
    r?.session?.data?.attributes, // payment-verify wrapper
    r?.event?.data?.attributes?.data?.attributes, // payments-webhook wrapper
    r?.data?.attributes, // a bare PayMongo response body
    r?.attributes, // a bare resource
    r, // an attributes object already
  ];
  const attrs = candidates.find((c) => Array.isArray(c?.payments));
  if (!attrs) return null;

  // deno-lint-ignore no-explicit-any
  const captured = (attrs.payments as any[]).some((p) => p?.attributes?.status === "paid");
  if (!captured) return null;

  return pmFeeFromAttributes(attrs);
}

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

  // What the processor actually took. PayMongo settles NET, and reports both
  // halves on the payment object we already store in payments.raw.
  //
  // Reading the ACTUAL fee rather than predicting it is what makes the ledger
  // immune to rate drift: if PayMongo changes its pricing tomorrow, this is
  // still exactly right the same day and nobody has to notice anything.
  const reported = reportedProcessorFee(raw);

  let processorFee = 0;
  let processorFeeSource = "none";
  let processorFeePredicted: number | null = null;

  // The rate card's opinion, kept ONLY so drift is measurable. Never authoritative.
  const { data: rateRows } = await db.rpc("processor_rate_at", {
    p_provider: "paymongo", p_method: method, p_scope: "local",
    p_at: new Date().toISOString(),
  });
  const rate = (rateRows as ProcessorRate[] | null)?.[0] ?? null;
  if (rate) processorFeePredicted = predictProcessorFee(reg.total_amount, rate);

  if (reported) {
    // PayMongo's own arithmetic must hold. A figure that fails it is not one we
    // can defend to an organizer, so it does not get to be called 'actual'.
    // No `amount > 0` guard: pmFeeFromAttributes returns null unless all three
    // figures are real numbers, so `reported` here always carries a genuine
    // amount. Guarding on it would mean a malformed payload SKIPS this check and
    // records an unverified fee as 'actual' — disarming the safeguard in exactly
    // the case it exists for.
    if (reported.amount - reported.fee !== reported.netAmount) {
      console.error(
        `[confirm] FEE INTEGRITY FAILURE registration=${reg.id} — ` +
          `amount ${reported.amount} - fee ${reported.fee} != net_amount ${reported.netAmount}. ` +
          `Recording as predicted and flagging for manual review.`,
      );
      processorFee = processorFeePredicted ?? 0;
      processorFeeSource = processorFeePredicted === null ? "none" : "predicted";
    } else {
      processorFee = reported.fee;
      processorFeeSource = "actual";
    }
  } else if (processorFeePredicted !== null) {
    // No reported fee yet. Use the estimate so net_to_org is computable and the
    // organizer is never blocked, and mark it for reconciliation. This is the
    // ONLY route by which a predicted figure reaches processor_fee_cents, and it
    // is always tagged 'predicted' — the rate card never masquerades as actual.
    processorFee = processorFeePredicted;
    processorFeeSource = "predicted";
  }

  const net = reg.total_amount - fee - processorFee;

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
    p_processor_fee: processorFee,
    p_processor_fee_predicted: processorFeePredicted,
    p_processor_fee_source: processorFeeSource,
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
