import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isPublicLaunchClosed, isStagingEnvironment } from "@race-pace/shared";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  if (isPublicLaunchClosed(process.env.VERCEL_TARGET_ENV ?? process.env.VERCEL_ENV, request.nextUrl.hostname)) {
    if (request.nextUrl.pathname === "/robots.txt") {
      return new NextResponse("User-agent: *\nDisallow: /\n", {
        headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex, nofollow, noarchive" },
      });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return NextResponse.json({ error: "coming_soon" }, { status: 503 });
    }
    return NextResponse.redirect("https://www.racepace.com.ph/coming-soon", 307);
  }
  const response = await updateSession(request);
  if (isStagingEnvironment(process.env.VERCEL_TARGET_ENV, request.nextUrl.hostname)) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet, noimageindex");
  }
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and images — those never need a session
    // refresh and running middleware on them wastes an auth call per request.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
