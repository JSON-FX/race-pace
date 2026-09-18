// Verify a PayMongo webhook signature. Header form: "t=<unix>,te=<testSig>,li=<liveSig>".
// Signed payload is `${t}.${rawBody}`; HMAC-SHA256(secret) hex, compared constant-time.
async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
  return Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
export interface RefundWebhookResource {
  id: string;
  attributes: { status: string; [key: string]: unknown };
  [key: string]: unknown;
}

// Observed in PayMongo test mode: payment.refund.updated carries a refund;
// payment.refunded carries the payment and its refunds array. Never use pay_…
// as the parked refund ID. Keep the old synthetic alias for recorded fixtures.
export function refundResourcesFromEvent(type: string | undefined, resource: unknown): RefundWebhookResource[] | null {
  if (!["payment.refund.updated", "payment.refunded", "refund.updated"].includes(type ?? "")) return null;
  const r = resource as { attributes?: { refunds?: unknown } } | null;
  const candidates = type === "payment.refunded"
    ? (Array.isArray(r?.attributes?.refunds) ? r.attributes.refunds : [])
    : [resource];
  return candidates.filter((value): value is RefundWebhookResource => {
    const item = value as RefundWebhookResource | null;
    return typeof item?.id === "string" && item.id.startsWith("ref_") &&
      typeof item.attributes?.status === "string";
  });
}

export async function verifyWebhookSignature(
  rawBody: string, header: string | null, secret: string, maxAgeSec = 300,
): Promise<boolean> {
  if (!header || !secret) return false;
  const parts: Record<string, string> = {};
  for (const kv of header.split(",")) { const [k, v] = kv.split("="); if (k && v) parts[k.trim()] = v.trim(); }
  const t = parts["t"]; const provided = parts["te"] ?? parts["li"];
  if (!t || !provided) return false;
  const age = Math.floor(Date.now() / 1000) - Number(t);
  if (!Number.isFinite(age) || Math.abs(age) > maxAgeSec) return false; // bound replay
  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  return timingSafeEqual(expected, provided);
}
