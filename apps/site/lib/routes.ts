/** Route prefixes that require a signed-in runner. Kept pure and separate from
 *  middleware.ts so the decision is unit-testable without a Next runtime. */
export const PROTECTED_PREFIXES = ["/register", "/pay", "/ticket", "/races", "/profile"];

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    // Segment boundary required: "/races" and "/races/..." match, "/racesomething" does not.
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

/** Bounce to sign-in carrying the full target (path + query) so the runner
 *  resumes exactly where they landed — not the homepage. */
export function signInRedirectPath(pathname: string, search: string): string {
  return `/sign-in?next=${encodeURIComponent(pathname + search)}`;
}

/** Cookie carrying the post-auth destination across the OAuth round-trip.
 *  Lives here, not in lib/auth.ts, so the server-side callback Route Handler
 *  can read it without importing the browser Supabase client. */
export const OAUTH_NEXT_COOKIE = "rp_oauth_next";

/** Guards every post-auth `?next=` redirect (sign-in, sign-up, OAuth callback).
 *  Only a same-site relative path is safe: `//host/...` is protocol-relative
 *  and browsers navigate it as absolute, so it — along with any other
 *  absolute-looking target (`https://…`, `javascript:…`, `\\host`) — must
 *  fall back to `/`. A single shared predicate so the credential-auth paths
 *  can't silently drift from the OAuth callback's guard. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return "/";
  if (next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")) return next;
  return "/";
}
