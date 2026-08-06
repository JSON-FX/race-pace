import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath, OAUTH_NEXT_COOKIE } from "@/lib/routes";

/**
 * OAuth callback. Supabase sends the browser here with a one-time `code` to
 * exchange for a session.
 *
 * AUTHENTICATION ONLY. It deliberately does not check whether the account has an
 * org role: that gate already exists in the (admin) layout, which routes a
 * role-less user to /no-access. Duplicating it here would mean two places to
 * keep in step, and the layout's version also covers a role revoked mid-session.
 *
 * Mirrors apps/site/app/auth/callback/route.ts. Both apps authenticate against
 * the same Supabase project, and the two lessons baked into that file were both
 * learned from production failures — see the comments on decodeNext and
 * redirectRelative.
 */

/** A hand-edited or truncated cookie can hold a malformed escape ("%", "%zz"),
 *  and decodeURIComponent throws URIError on those — turning a bad cookie into a
 *  500 on the one route a user cannot skip. Treat undecodable as absent. */
function decodeNext(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * Redirect with a RELATIVE Location header, and clear the destination cookie.
 *
 * Deliberately NOT `NextResponse.redirect(`${origin}${path}`)`. Behind a reverse
 * proxy — which is exactly how this console is served, via Traefik on
 * admin.racepace.lan — `origin` is the server's own bind address, not the host
 * the operator typed. On the runner site that same mistake sent people to
 * `https://0.0.0.0:3000/` after a successful Google sign-in, and on Vercel it
 * resolves to the internal deployment host.
 *
 * A relative Location is resolved by the BROWSER against its current URL, so it
 * is correct on .lan, *.vercel.app and a production domain with no environment
 * configuration at all.
 */
function redirectRelative(path: string): NextResponse {
  const res = new NextResponse(null, { status: 307, headers: { location: path } });
  res.cookies.delete(OAUTH_NEXT_COOKIE);
  return res;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");

  // The destination arrives in a cookie, not the URL: `redirectTo` must match
  // Supabase's allow-list exactly and so can carry no query string. The `?next=`
  // read stays as a fallback for any link still shaped that way.
  //
  // Both sources are untrusted — the cookie is written by client-side JS — so
  // both go through safeNextPath, which rejects anything that isn't a same-site
  // relative path. An absolute target here would be an open redirect.
  const fromCookie = request.cookies.get(OAUTH_NEXT_COOKIE)?.value;
  const safeNext = safeNextPath(decodeNext(fromCookie) ?? searchParams.get("next"));

  // Google reports a refusal (closed window, denied consent) as an error on the
  // callback rather than by not calling it. Distinguish the two so the login
  // page can say "cancelled" rather than implying something broke.
  const oauthError = searchParams.get("error");
  if (oauthError) {
    return redirectRelative(`/login?oauth=${oauthError === "access_denied" ? "cancelled" : "failed"}`);
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return redirectRelative(safeNext);
    console.error("[auth/callback] code exchange failed", error.message);
  }

  return redirectRelative("/login?oauth=failed");
}
