import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { getOrg } from "@/lib/queries/org";
import { getOrgEventCount } from "@/lib/queries/events";
import { getOrgRegistrationCount } from "@/lib/queries/registrations";
import { AppShell } from "@/components/AppShell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Middleware already redirected anonymous requests; this is the second,
  // authoritative check. Middleware runs on the edge and is not an
  // authorization boundary on its own.
  if (!user) redirect("/login");

  const roles = await getMyRoles();
  if (!roles?.isAdmin) redirect("/no-access");

  // requireOrgId returns null for a bare super_admin with no org-scoped
  // row — that's not an error, it just means there's no org name to show
  // next to the role badge (see TopBar). getOrg is React-cache()d, so if
  // the current page (e.g. Settings) also calls it for the same orgId
  // within this request, this doesn't cost a second query.
  const orgId = requireOrgId(roles);
  const orgName = orgId ? (await getOrg(orgId)).name : null;
  // Sidebar nav-count pills (Events, Registrations) are real data, not
  // props threaded from a page. A bare super_admin with orgId: null has no
  // org to count against — counts stays null and Sidebar renders the nav
  // without pills rather than showing a misleading 0.
  const counts = orgId
    ? await Promise.all([getOrgEventCount(orgId), getOrgRegistrationCount(orgId)]).then(
        ([events, registrations]) => ({ events, registrations }),
      )
    : null;

  return (
    <AppShell roles={roles} email={user.email ?? ""} orgName={orgName} counts={counts}>
      {children}
    </AppShell>
  );
}
