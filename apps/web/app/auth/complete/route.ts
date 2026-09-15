import { NextRequest, NextResponse } from "next/server";
import { getMyRoles } from "@/lib/queries/roles";
import { invitationNextPath } from "@/lib/routes";

// A fresh request sees the session cookie written by the fragment landing page.
export async function GET(request: NextRequest) {
  const roles = await getMyRoles();
  const target = invitationNextPath(
    request.nextUrl.searchParams.get("next"),
    roles?.capabilities ?? [],
  );
  return new NextResponse(null, { status: 307, headers: { location: target } });
}
