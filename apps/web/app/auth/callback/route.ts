import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/routes";

/**
 * OAuth callback. Google sends the browser here with a one-time `code`, which is
 * exchanged for a session.
 *
 * This route AUTHENTICATES only. It deliberately does not check whether the
 * account has an org role: that gate already exists in the (admin) layout, which
 * routes a role-less user to /no-access. Duplicating it here would mean two
 * places to keep in step, and the layout's version is the one that also covers
 * a role revoked mid-session.
 *
 * `next` has been off-site and back by the time it arrives, so it is re-checked
 * with safeNextPath rather than trusted — a redirect target that survived a
 * round trip through a third party is exactly what an open-redirect check is
 * for.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  // Google reports a refusal (closed window, denied consent) as an error on the
  // callback rather than by not calling it. Send the operator back to the form
  // with something readable instead of failing the exchange below.
  const oauthError = searchParams.get("error");
  if (oauthError) {
    const reason = oauthError === "access_denied" ? "cancelled" : "failed";
    return NextResponse.redirect(`${origin}/login?oauth=${reason}`);
  }

  if (!code) return NextResponse.redirect(`${origin}/login?oauth=failed`);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("[auth/callback] code exchange failed", error.message);
    return NextResponse.redirect(`${origin}/login?oauth=failed`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
