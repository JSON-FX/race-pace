// Group checkout deliberately requires captured payment records, never intent status.
const BASE = "https://api.paymongo.com/v1/checkout_sessions";
const V2 = "https://api.paymongo.com/v2/checkout_sessions";
const MAX = 2147483647;
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const cents = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= MAX;
const identifier = (v: unknown, prefix: string): v is string => typeof v === "string" && new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(v);
const uuid = (v: unknown): string | null => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v.toLowerCase() : null;

export interface GroupSessionInput {
  attemptId: string; orderId: string; method: "card" | "gcash" | "paymaya";
  baseCents: number; platformFeeCents: number; processorSurchargeCents: number;
  grossCents: number; feeMode: "absorb" | "pass_on"; returnUrl: string;
  providerManagedFee?: boolean;
}
export function buildGroupSessionRequest(input: GroupSessionInput) {
  if (!uuid(input.attemptId) || !uuid(input.orderId) ||
      ![input.baseCents, input.platformFeeCents, input.processorSurchargeCents, input.grossCents].every(cents) ||
      !["card", "gcash", "paymaya"].includes(input.method) || !["absorb", "pass_on"].includes(input.feeMode)) throw new Error("group_session_invalid_input");
  const passOn = input.feeMode === "pass_on";
  const managed = passOn && input.providerManagedFee === true;
  if (input.providerManagedFee && !passOn) throw new Error("group_session_invalid_input");
  const total = input.baseCents + (passOn ? input.platformFeeCents + input.processorSurchargeCents : 0);
  if (total !== input.grossCents || total <= 0 || (!passOn && input.processorSurchargeCents !== 0)) throw new Error("group_session_invalid_total");
  const returnUrl = new URL(input.returnUrl);
  if (!["https:", "http:"].includes(returnUrl.protocol) || returnUrl.username || returnUrl.password) throw new Error("group_session_invalid_return_url");
  const withStatus = (status: string) => { const url = new URL(returnUrl); url.searchParams.set("status", status); return url.toString(); };
  const line_items = [{ name: "Race entries", amount: input.baseCents, currency: "PHP", quantity: 1 }];
  if (passOn && input.platformFeeCents > 0) line_items.push({ name: "Taxes and fees", amount: input.platformFeeCents, currency: "PHP", quantity: 1 });
  if (passOn && input.processorSurchargeCents > 0) line_items.push({ name: "Payment processing fee", amount: input.processorSurchargeCents, currency: "PHP", quantity: 1 });
  if (managed && input.processorSurchargeCents !== 0) throw new Error("group_session_invalid_total");
  return { data: { attributes: { line_items: line_items.filter(line => line.amount > 0), payment_method_types: [input.method], description: "Race Pace group booking", success_url: withStatus("success"), cancel_url: withStatus("cancelled"), metadata: { booking_order_id: input.orderId, payment_attempt_id: input.attemptId }, ...(managed ? { pass_on_fees: true, reference_number: input.orderId } : {}) } } };
}
async function request(url: string, secret: string, options: RequestInit): Promise<unknown> {
  try {
    const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", Authorization: `Basic ${btoa(`${secret}:`)}`, ...options.headers }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("provider_error");
    return await response.json();
  } catch { throw new Error("group_provider_request_unknown"); }
}
export async function createGroupSession(body: unknown, attemptId: string, secret: string): Promise<{sessionId: string; checkoutUrl: string}> {
  if (!uuid(attemptId)) throw new Error("group_session_invalid_attempt");
  const managed = object(object(object(body).data).attributes).pass_on_fees === true;
  const raw = await request(managed ? V2 : BASE, secret, { method: "POST", headers: { "Idempotency-Key": attemptId }, body: JSON.stringify(body) });
  const data = object(object(raw).data);
  const url = object(data.attributes).checkout_url;
  if (!identifier(data.id, "cs") || typeof url !== "string") throw new Error("group_provider_response_invalid");
  try {
    const parsed = new URL(url);
    if (parsed.origin !== "https://checkout.paymongo.com" || parsed.username || parsed.password) throw new Error();
  } catch { throw new Error("group_provider_response_invalid"); }
  return { sessionId: data.id, checkoutUrl: url };
}
export async function retrieveGroupSession(sessionId: string, secret: string): Promise<unknown> {
  if (!identifier(sessionId, "cs")) throw new Error("group_session_invalid_id");
  const raw = await request(`${BASE}/${sessionId}`, secret, { method: "GET" });
  if (object(object(raw).data).id !== sessionId) throw new Error("group_provider_response_invalid");
  return raw;
}
export interface GroupCapture {
  paymentId: string; sessionId: string; amount: number | null; currency: string | null;
  feeCents: number | null; livemode: boolean | null; attemptId: string | null;
  orderId: string | null; invalidReason: string | null; raw: unknown;
}
export function extractGroupCaptures(raw: unknown): GroupCapture[] {
  const data = object(object(raw).data);
  const attributes = object(data.attributes);
  if (!identifier(data.id, "cs")) return [];
  const sessionId = data.id;
  const metadata = object(attributes.metadata);
  const attemptId = uuid(metadata.payment_attempt_id), orderId = uuid(metadata.booking_order_id);
  const payments = Array.isArray(attributes.payments) ? attributes.payments : [];
  return payments.flatMap(payment => {
    const record = object(payment), a = object(record.attributes);
    if (a.status !== "paid") return [];
    if (!identifier(record.id, "pay")) throw new Error("invalid_capture_identity");
    const amount = cents(a.amount) ? a.amount : null;
    const currency = typeof a.currency === "string" ? a.currency : null;
    const livemode = typeof a.livemode === "boolean" ? a.livemode : null;
    let invalidReason = amount === null ? "invalid_amount" : currency !== "PHP" ? "invalid_currency" : livemode === null ? "missing_livemode" : !attemptId || !orderId ? "invalid_metadata" : null;
    let feeCents: number | null = null;
    if (a.fee !== undefined && a.fee !== null || a.net_amount !== undefined && a.net_amount !== null) {
      if (!cents(a.fee) || !cents(a.net_amount) || amount === null || a.fee + a.net_amount !== amount) invalidReason = "invalid_fee";
      else feeCents = a.fee;
    }
    return [{ paymentId: record.id, sessionId, amount, currency, feeCents, livemode, attemptId, orderId, invalidReason, raw: payment }];
  });
}
