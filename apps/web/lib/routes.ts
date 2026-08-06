/** Pages reachable without a session. Everything else is admin-only. */
const PUBLIC_PATHS = ["/login", "/no-access"];

export function isProtectedPath(pathname: string): boolean {
  return !PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Where to send an anonymous request, remembering where it was headed. */
export function signInRedirectPath(pathname: string, search: string): string {
  if (pathname === "/" && !search) return "/login";
  return `/login?next=${encodeURIComponent(`${pathname}${search}`)}`;
}

/** Only same-origin absolute paths are safe redirect targets. A value like
 *  "//evil.com" starts with "/" but browsers resolve it as an external
 *  origin, so a bare startsWith("/") check is not sufficient. */
/** Cookie carrying the post-auth destination across the OAuth round-trip.
 *
 *  Lives here rather than beside the sign-in button so the server-side callback
 *  Route Handler can read it without importing the browser Supabase client.
 *  Mirrors apps/site/lib/routes.ts#OAUTH_NEXT_COOKIE — the two apps run the same
 *  flow against the same Supabase project and should not diverge. */
export const OAUTH_NEXT_COOKIE = "rp_oauth_next_admin";

export function safeNextPath(next: string | null | undefined, fallback = "/events"): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  // "//evil.com" and "/\evil.com" are both browser-resolved as protocol-relative
  // external origins despite starting with a single "/".
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (next.includes("\\")) return fallback;
  // eslint-disable-next-line no-control-regex -- deliberately matching control chars
  if (/[\x00-\x1f]/.test(next)) return fallback;
  return next;
}
