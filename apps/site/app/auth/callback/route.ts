import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath, OAUTH_NEXT_COOKIE } from "@/lib/routes";

/** A hand-edited or truncated cookie can hold a malformed escape ("%", "%zz"),
 *  and decodeURIComponent throws URIError on those — which would turn a bad
 *  cookie into a 500 on the one route a runner cannot skip. Treat undecodable
 *  as absent and fall through to the query param, then to "/". */
function decodeNext(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");

  // The destination arrives in a cookie, not the URL: `redirectTo` has to
  // match Supabase's allow-list exactly, so it can carry no query string.
  // The `?next=` read stays as a fallback for any link still shaped that way.
  // Only same-site relative targets — an absolute `next` would turn this into
  // an open redirect that phishing can point anywhere. The cookie is written
  // by client-side JS, so it is untrusted input and gets the same guard.
  const fromCookie = request.cookies.get(OAUTH_NEXT_COOKIE)?.value;
  const safeNext = safeNextPath(decodeNext(fromCookie) ?? searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const res = NextResponse.redirect(`${origin}${safeNext}`);
      res.cookies.delete(OAUTH_NEXT_COOKIE);
      return res;
    }
  }

  const res = NextResponse.redirect(`${origin}/sign-in?error=oauth`);
  res.cookies.delete(OAUTH_NEXT_COOKIE);
  return res;
}
