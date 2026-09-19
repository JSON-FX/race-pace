type RateLimitClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: boolean | null;
    error: { message?: string } | null;
  }>;
};

const WINDOW_SECONDS = 60 * 60;
const IP_LIMIT = 5;
const EMAIL_LIMIT = 3;

export async function saltedRateLimitHash(salt: string, scope: string, value: string): Promise<string> {
  const input = new TextEncoder().encode(`${salt}:${scope}:${value.trim().toLowerCase()}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function consume(client: RateLimitClient, keyHash: string, limit: number): Promise<boolean> {
  const { data, error } = await client.rpc("consume_organizer_inquiry_limit", {
    p_key_hash: keyHash,
    p_limit: limit,
    p_window_seconds: WINDOW_SECONDS,
  });
  if (error || typeof data !== "boolean") throw new Error("rate_limit_unavailable");
  return data;
}

export async function checkOrganizerInquiryRateLimit(input: {
  client: RateLimitClient;
  salt: string | undefined;
  ipAddress: string;
  email: string;
}): Promise<{ ok: boolean; reason?: "ip" | "email" }> {
  if (!input.salt || input.salt.length < 32) throw new Error("rate_limit_not_configured");

  const [ipHash, emailHash] = await Promise.all([
    saltedRateLimitHash(input.salt, "ip", input.ipAddress || "unknown"),
    saltedRateLimitHash(input.salt, "email", input.email),
  ]);

  if (!await consume(input.client, ipHash, IP_LIMIT)) return { ok: false, reason: "ip" };
  if (!await consume(input.client, emailHash, EMAIL_LIMIT)) return { ok: false, reason: "email" };
  return { ok: true };
}

export function inquiryClientIp(headers: Headers): string {
  const cloudflare = headers.get("cf-connecting-ip")?.trim();
  if (cloudflare) return cloudflare;
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
