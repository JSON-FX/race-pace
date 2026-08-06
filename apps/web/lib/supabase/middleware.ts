import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isProtectedPath, signInRedirectPath } from "@/lib/routes";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    // Middleware runs server-side too — see the SUPABASE_INTERNAL_URL note in
    // lib/supabase/server.ts. Unset outside containerised dev.
    process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() revalidates the token against the auth server. getSession()
  // only decodes the cookie and must never gate authorization.
  const { data: { user } } = await supabase.auth.getUser();

  if (!user && isProtectedPath(request.nextUrl.pathname)) {
    const target = signInRedirectPath(request.nextUrl.pathname, request.nextUrl.search);
    const redirectResponse = NextResponse.redirect(new URL(target, request.url));
    // getUser() can call setAll() even when it returns a null user: a stale
    // or revoked session makes it clear the cookie via _removeSession()
    // before resolving. That write lands on `supabaseResponse`, not on this
    // redirect response, so it must be copied over explicitly — otherwise
    // the dead cookie is never cleared and gets resent on every request.
    supabaseResponse.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  // Always return `supabaseResponse` as-is (or, on the redirect branch above,
  // a response carrying its cookies). Constructing a fresh NextResponse
  // without copying its cookies silently desyncs the session and logs the
  // admin out at random.
  return supabaseResponse;
}
