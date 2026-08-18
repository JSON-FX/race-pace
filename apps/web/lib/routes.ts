import type { Capability } from "@/lib/capabilities";

/**
 * Pages reachable without a session. Everything else is admin-only.
 *
 * This console is default-DENY: anything not listed here is protected. That is
 * the right posture for an admin surface, but it means every new
 * unauthenticated entry point must be added deliberately.
 *
 * `/auth/callback` and `/auth/confirm` are the two that are easy to miss, and
 * both fail in a way that looks like the sign-in button (or invite link) is
 * broken rather than like a routing bug. Each is the request that CREATES the
 * session, so it necessarily arrives without one:
 * - Omitting `/auth/callback` made the middleware bounce Google's return leg to
 *   `/login?next=%2Fauth%2Fcallback%3Fcode%3D…`, the code was never exchanged,
 *   and the operator ended up back on a login form with no error anywhere — no
 *   failed exchange, no rejected account, nothing to see in a log.
 * - `/auth/confirm` (apps/web/app/auth/confirm/route.ts) redeems an org invite's
 *   `token_hash` via `verifyOtp`. An invited admin is signed out by definition
 *   when they click that link, so the same bounce-before-it-runs failure
 *   applies: leaving it off this list makes the invite link silently inert.
 */
const PUBLIC_PATHS = ["/login", "/no-access", "/auth/callback", "/auth/confirm"];

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

/**
 * Where an authenticated caller's console home is, decided from their
 * capabilities alone.
 *
 * This used to be decided in two places that could disagree: login/page.tsx
 * had an inline manage_org → check_in → no-access chain, and
 * auth/callback/route.ts had no equivalent at all — it fell through to
 * safeNextPath's hardcoded "/events" default. A check_in-only (marshal)
 * account signing in with Google therefore landed on /events, which the
 * manage_org guard on that page then bounced to /no-access. Both callers now
 * go through this one function so there is exactly one answer.
 *
 * manage_org wins over check_in: an admin legitimately holds both (see
 * capabilities.ts's BY_ROLE), and /events is their home, not the check-in
 * station.
 */
export function homePathFor(capabilities: readonly Capability[]): string {
  if (capabilities.includes("manage_org")) return "/events";
  if (capabilities.includes("check_in")) return "/check-in";
  return "/no-access";
}

/** `fallback` has no default on purpose: a hardcoded "/events" here is
 *  exactly how the OAuth-callback bug happened (see homePathFor's comment)
 *  — a caller that forgot to pass one silently got an admin destination
 *  regardless of what the signed-in account can actually reach. Every
 *  caller must say explicitly where an absent/unsafe `next` should go. */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
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
