import type { NextRequest } from "next/server";
import { isStagingEnvironment } from "@race-pace/shared";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
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
