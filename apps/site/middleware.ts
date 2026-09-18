import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isPublicLaunchClosed, isStagingEnvironment } from "@race-pace/shared";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (isPublicLaunchClosed(process.env.VERCEL_TARGET_ENV ?? process.env.VERCEL_ENV, request.nextUrl.hostname, process.env.VERCEL_URL)) {
    if (pathname === "/robots.txt") {
      return new NextResponse("User-agent: *\nDisallow: /\n", {
        headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex, nofollow, noarchive" },
      });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return NextResponse.json({ error: "coming_soon" }, { status: 503 });
    }
    if (pathname !== "/coming-soon") {
      const url = request.nextUrl.clone();
      url.pathname = "/coming-soon";
      url.search = "";
      return NextResponse.redirect(url, 307);
    }
    const response = NextResponse.next();
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    return response;
  }

  const response = await updateSession(request);
  if (isStagingEnvironment(process.env.VERCEL_TARGET_ENV, request.nextUrl.hostname)) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet, noimageindex");
  }
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image files — those never need a
    // session refresh and running middleware on them wastes an auth call.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4)$).*)",
  ],
};
