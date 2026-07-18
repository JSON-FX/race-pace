// Mirrors TicketPayload in packages/shared (kept local so the Deno runtime needn't
// import from outside supabase/functions/).
export interface TicketPayload {
  rid: string; // registration id
  eid: string; // event id
  iat: number; // issued-at (unix seconds)
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

export async function mintTicketToken(payload: TicketPayload, secret: string): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifyTicketToken(token: string, secret: string): Promise<TicketPayload | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(body)));
  if (b64url(expected) !== sig) return null;
  try {
    return JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/"))) as TicketPayload;
  } catch {
    return null;
  }
}
