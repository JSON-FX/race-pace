import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/routes";

/**
 * Magic-link / invite landing route.
 *
 * SEPARATE FROM /auth/callback ON PURPOSE. That route exchanges a PKCE `code`,
 * which only exists for a flow the browser itself started. An invite link is
 * generated server-side by org-provision, so there is no code verifier to
 * match — Supabase's own /auth/v1/verify endpoint answers those by redirecting
 * with the tokens in the URL FRAGMENT, which a server route cannot read. The
 * fix is to never send the operator through that endpoint: org-provision hands
 * out `hashed_token`, and this route redeems it with verifyOtp.
 *
 * Relative Location, like /auth/callback — behind Traefik (admin.racepace.lan)
 * or on Vercel, `request.nextUrl.origin` is the server's own bind address.
 */
function redirectRelative(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { location: path } });
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = (searchParams.get("type") ?? "magiclink") as EmailOtpType;

  if (!tokenHash) return redirectRelative("/login?oauth=invite_expired");

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) {
    console.error("[auth/confirm] verifyOtp failed", error.message);
    return redirectRelative("/login?oauth=invite_expired");
  }

  // An invited admin has a role but no profile yet, so /team is the useful
  // landing spot. safeNextPath rejects anything that is not a same-site
  // relative path — an absolute target here would be an open redirect.
  return redirectRelative(safeNextPath(searchParams.get("next"), "/team"));
}
