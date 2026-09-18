// PayMongo API client (server-side; uses the SECRET key via HTTP Basic auth).
// Docs: https://docs.paymongo.com/reference/checkout-session-resource
const BASE = "https://api.paymongo.com/v1";
const V2_CHECKOUT = "https://api.paymongo.com/v2/checkout_sessions";

export function paymongoConfigured(): boolean {
  return !!Deno.env.get("PAYMONGO_SECRET_KEY");
}

function authHeader(): string {
  const key = Deno.env.get("PAYMONGO_SECRET_KEY");
  if (!key) throw new Error("PAYMONGO_SECRET_KEY not set");
  // Basic auth: secret key is the username, password is empty.
  return "Basic " + btoa(`${key}:`);
}

export interface PmLineItem { name: string; amount: number; currency: string; quantity: number }

export interface CreateSessionInput {
  lineItems: PmLineItem[];
  paymentMethodTypes: string[];
  description?: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
  // Prefills the "Customer Information" fields on the hosted checkout page.
  billing?: { name?: string; email?: string; phone?: string };
  /** PayMongo computes the method-specific fee on its hosted v2 checkout. */
  passOnFees?: boolean;
  /** Stable across retries of one registration's checkout creation. */
  idempotencyKey: string;
}

export interface PmSession { id: string; checkoutUrl: string; paid: boolean; status: string; raw: unknown }

// deno-lint-ignore no-explicit-any
function parseSession(body: any): PmSession {
  const d = body?.data;
  const a = d?.attributes ?? {};
  const payments: unknown[] = Array.isArray(a.payments) ? a.payments : [];
  // A checkout session is paid once it has a captured payment, or its payment
  // intent has succeeded. Check both to be resilient across PayMongo shapes.
  const paidPayment = payments.some((p) =>
    // deno-lint-ignore no-explicit-any
    (p as any)?.attributes?.status === "paid"
  );
  const intentStatus = a?.payment_intent?.attributes?.status;
  const paid = paidPayment || intentStatus === "succeeded";
  return { id: d?.id, checkoutUrl: a.checkout_url, paid, status: a.status ?? "", raw: body };
}

export async function pmCreateCheckoutSession(input: CreateSessionInput): Promise<PmSession> {
  const res = await fetch(input.passOnFees ? V2_CHECKOUT : `${BASE}/checkout_sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader(), "Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify({
      data: {
        attributes: {
          line_items: input.lineItems,
          payment_method_types: input.paymentMethodTypes,
          description: input.description,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          metadata: input.metadata,
          billing: input.billing,
          ...(input.passOnFees ? { pass_on_fees: true, reference_number: input.metadata?.registration_id } : {}),
        },
      },
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`paymongo_create_failed: ${JSON.stringify(body?.errors ?? body)}`);
  return parseSession(body);
}

export async function pmGetCheckoutSession(id: string): Promise<PmSession> {
  const res = await fetch(`${BASE}/checkout_sessions/${id}`, {
    headers: { Authorization: authHeader() },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`paymongo_get_failed: ${JSON.stringify(body?.errors ?? body)}`);
  return parseSession(body);
}

/** A 400 is ambiguous: PayMongo uses it for expired, paid, and ongoing sessions.
 * Callers must GET the session and reconcile its actual state before changing
 * the local reservation. */
export async function pmExpireCheckoutSession(id: string): Promise<"expired" | "inspect"> {
  if (!/^cs_[A-Za-z0-9_-]+$/.test(id)) throw new Error("invalid_checkout_session_id");
  const res = await fetch(`${BASE}/checkout_sessions/${encodeURIComponent(id)}/expire`, {
    method: "POST",
    headers: { Authorization: authHeader() },
  });
  if (res.status === 200) return "expired";
  if (res.status === 400) return "inspect";
  throw new Error(`paymongo_expire_failed:${res.status}`);
}

/** Resolve the pay_… id captured by a paid checkout session (session.payments[].id). */
export function pmPaymentIdFromSession(session: PmSession): string | null {
  // deno-lint-ignore no-explicit-any
  const a = (session.raw as any)?.data?.attributes ?? {};
  // deno-lint-ignore no-explicit-any
  const payments: any[] = Array.isArray(a.payments) ? a.payments : [];
  const chosen = payments.find((p) => p?.attributes?.status === "paid");
  return typeof chosen?.id === "string" && /^pay_[A-Za-z0-9_-]+$/.test(chosen.id) ? chosen.id : null;
}

/**
 * The INSTRUMENT a runner actually paid with — "gcash", "card", "paymaya" —
 * from a checkout session's attributes.
 *
 * Takes the `attributes` object rather than a PmSession so both callers can use
 * it: payment-verify has a parsed PmSession, while payments-webhook only has the
 * raw event resource.
 *
 * Prefers the PAID payment, matching pmPaymentIdFromSession. A session can carry
 * a failed attempt followed by a successful one, and `payments[0]` then reports
 * the instrument the runner tried and abandoned rather than the one that worked.
 *
 * Falls back to "paymongo" — the provider, not an instrument — only when the
 * shape is genuinely absent, so a null here is visible as a known-unknown rather
 * than silently becoming "card".
 */
// deno-lint-ignore no-explicit-any
export function pmMethodFromAttributes(attributes: any): string {
  const payments: unknown[] = Array.isArray(attributes?.payments) ? attributes.payments : [];
  // deno-lint-ignore no-explicit-any
  const chosen = (payments as any[]).find((p) => p?.attributes?.status === "paid") ?? payments[0];
  // deno-lint-ignore no-explicit-any
  return (chosen as any)?.attributes?.source?.type ?? "paymongo";
}

/** Convenience wrapper for callers holding a parsed session. */
export function pmMethodFromSession(session: PmSession): string {
  // deno-lint-ignore no-explicit-any
  return pmMethodFromAttributes((session.raw as any)?.data?.attributes);
}

export interface PmRefund { id: string; status: "pending" | "succeeded" | "failed"; raw: unknown }

/** A request ID belongs to one frozen refund attempt, including uncertain retries. */
export async function pmCreateRefund(input: { paymentId: string; amount: number; reason?: string; requestId: string; registrationId?: string }): Promise<PmRefund> {
  const res = await fetch(`${BASE}/refunds`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader(), "Idempotency-Key": `refund:${input.requestId}` },
    body: JSON.stringify({
      data: { attributes: {
        amount: input.amount, payment_id: input.paymentId, reason: input.reason ?? "requested_by_customer",
        metadata: { refund_request_id: input.requestId, ...(input.registrationId ? { registration_id: input.registrationId } : {}) },
      } },
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`paymongo_refund_failed: ${JSON.stringify(body?.errors ?? body)}`);
  return parseRefund(body);
}

export async function pmGetRefund(id: string): Promise<PmRefund> {
  const res = await fetch(`${BASE}/refunds/${encodeURIComponent(id)}`, { headers: { Authorization: authHeader() } });
  const body = await res.json();
  if (!res.ok) throw new Error(`paymongo_refund_get_failed: ${JSON.stringify(body?.errors ?? body)}`);
  const refund = parseRefund(body);
  if (refund.id !== id) throw new Error("paymongo_refund_id_mismatch");
  return refund;
}

function parseRefund(body: { data?: { id?: string; attributes?: { status?: string } } }): PmRefund {
  const d = body?.data;
  if (typeof d?.id !== "string" || !d.id.startsWith("ref_")) throw new Error("paymongo_refund_id_invalid");
  // Processing is nonterminal. Passing it through used to bypass refund.ts's
  // pending branch and release the runner's slot before the refund completed.
  const reportedStatus = d?.attributes?.status;
  const status = reportedStatus === "processing" ? "pending" : reportedStatus;
  if (status !== "pending" && status !== "succeeded" && status !== "failed") {
    throw new Error("paymongo_refund_status_invalid");
  }
  return { id: d?.id, status, raw: body };
}

/**
 * What the processor actually charged, from a checkout session's attributes.
 *
 * PayMongo settles NET: on a ₱2,000 payment, ₱1,970 arrives. The payment object
 * reports both halves — `fee` and `net_amount`, integers in centavos — and
 * `payments.raw` has been storing this whole payload all along without anyone
 * reading it.
 *
 * This is what makes the ledger immune to rate drift. Recording what was
 * actually charged, rather than what a rate card predicted, means a PayMongo
 * pricing change is reflected the same day with nobody noticing anything.
 *
 * Takes `attributes` rather than a PmSession so both callers can use it, matching
 * pmMethodFromAttributes: payment-verify holds a parsed session, payments-webhook
 * holds only the raw event resource.
 *
 * Returns null rather than zero when any of the three figures is absent. A zero
 * fee is indistinguishable from a genuinely free payment, and would write a
 * net_to_org that overpays the organizer by exactly the processor's cut. The
 * same guard applies to `amount`: the caller's integrity check compares
 * `amount - fee` against `net_amount`, and a fabricated amount would make that
 * check compare an invented number. PayMongo's payment object always carries
 * `amount`, so requiring it rejects only genuinely broken payloads.
 */
// deno-lint-ignore no-explicit-any
export function pmFeeFromAttributes(
  attributes: any,
): { fee: number; netAmount: number; amount: number } | null {
  const payments: unknown[] = Array.isArray(attributes?.payments) ? attributes.payments : [];
  // deno-lint-ignore no-explicit-any
  const chosen = (payments as any[]).find((p) => p?.attributes?.status === "paid") ?? payments[0];
  // deno-lint-ignore no-explicit-any
  const a = (chosen as any)?.attributes;
  if (
    !a || !Number.isSafeInteger(a.fee) || !Number.isSafeInteger(a.net_amount) ||
    !Number.isSafeInteger(a.amount) || a.fee < 0 || a.net_amount < 0 ||
    a.amount <= 0 || (a.currency !== undefined && a.currency !== "PHP")
  ) return null;
  return { fee: a.fee, netAmount: a.net_amount, amount: a.amount };
}
