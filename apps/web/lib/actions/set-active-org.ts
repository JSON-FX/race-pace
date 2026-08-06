"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ACTIVE_ORG_COOKIE, getOrgContext } from "@/lib/org-context";

/** Switching is re-authorized here, not just hidden in the UI: a Server Action
 *  is a public endpoint. The org must be one this caller may actually act as. */
export async function setActiveOrg(orgId: string) {
  const { availableOrgs, canSwitch } = await getOrgContext();
  if (!canSwitch || !availableOrgs.some((o) => o.orgId === orgId)) return;

  (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365,
  });
  // "layout" scope, not the current page: the org id feeds the (admin) layout
  // (sidebar counts, breadcrumb org name) as well as whatever page is open, and
  // a page-scoped revalidate would leave the shell describing the old org.
  revalidatePath("/", "layout");
}
