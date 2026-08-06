import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles } from "@/lib/queries/roles";
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

  return (
    <AppShell roles={roles} email={user.email ?? ""}>
      {children}
    </AppShell>
  );
}
