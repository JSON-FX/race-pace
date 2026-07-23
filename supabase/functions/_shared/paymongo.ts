// PayMongo API client (server-side; uses the SECRET key via HTTP Basic auth).
// Docs: https://docs.paymongo.com/reference/checkout-session-resource
const BASE = "https://api.paymongo.com/v1";

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
  const res = await fetch(`${BASE}/checkout_sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader() },
    body: JSON.stringify({
      data: {
        attributes: {
          line_items: input.lineItems,
          payment_method_types: input.paymentMethodTypes,
          description: input.description,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          metadata: input.metadata,
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

/** Resolve the pay_… id captured by a paid checkout session (session.payments[].id). */
export function pmPaymentIdFromSession(session: PmSession): string | null {
  // deno-lint-ignore no-explicit-any
  const a = (session.raw as any)?.data?.attributes ?? {};
  // deno-lint-ignore no-explicit-any
  const payments: any[] = Array.isArray(a.payments) ? a.payments : [];
  const chosen = payments.find((p) => p?.attributes?.status === "paid") ?? payments[0];
  return chosen?.id ?? null;
}

export interface PmRefund { id: string; status: "pending" | "succeeded" | "failed"; raw: unknown }

/** POST /refunds — amount in centavos. PayMongo returns status pending|succeeded|failed. */
export async function pmCreateRefund(input: { paymentId: string; amount: number; reason?: string }): Promise<PmRefund> {
  const res = await fetch(`${BASE}/refunds`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader() },
    body: JSON.stringify({
      data: { attributes: { amount: input.amount, payment_id: input.paymentId, reason: input.reason ?? "requested_by_customer" } },
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`paymongo_refund_failed: ${JSON.stringify(body?.errors ?? body)}`);
  const d = body?.data;
  return { id: d?.id, status: (d?.attributes?.status ?? "pending") as PmRefund["status"], raw: body };
}
