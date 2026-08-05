// Browser-facing Edge Functions need CORS; the mobile app never did. The pure
// helpers take the allowlist as an argument so they are testable under Vitest,
// which has no `Deno` global — only allowedOrigins() touches Deno.env.

const DEFAULT_ORIGINS = ["http://localhost:3000"];

/** An entry may be an exact origin, or "*.example.com" matching any subdomain
 *  (but never the apex, and never a lookalike suffix like "evil-example.com"). */
export function isOriginAllowed(origin: string | null, allowed: string[]): boolean {
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return allowed.some((entry) => {
    if (entry.startsWith("*.")) {
      const suffix = entry.slice(1); // "*.vercel.app" -> ".vercel.app"
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return entry === origin;
  });
}

export function buildCorsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    // Responses differ per origin — without this a shared cache can serve one
    // origin's allow-header to another.
    "Vary": "Origin",
  };
  if (isOriginAllowed(origin, allowed)) headers["Access-Control-Allow-Origin"] = origin!;
  return headers;
}

/** Comma-separated SITE_ORIGINS secret; falls back to local dev. */
export function allowedOrigins(): string[] {
  const parsed = (Deno.env.get("SITE_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parsed.length ? parsed : DEFAULT_ORIGINS;
}

export function corsHeaders(origin: string | null): Record<string, string> {
  return buildCorsHeaders(origin, allowedOrigins());
}

/** Returns a 204 preflight response for OPTIONS, or null to continue. */
export function preflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("Origin")) });
}
