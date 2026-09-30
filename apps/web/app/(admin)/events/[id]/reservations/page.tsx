import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { hasCapability } from "@/lib/capabilities";

export default async function EventReservationsPage({ params }: { params: Promise<{ id: string }> }) {
  const roles = await getMyRoles();
  if (!hasCapability(roles?.capabilities ?? [], "manage_org")) redirect("/no-access");
  const orgId = requireOrgId(roles);
  if (!orgId) redirect("/reservations");
  const { id } = await params;
  const db = await createClient();
  const { data: event, error } = await db.from("events").select("id").eq("id", id).eq("org_id", orgId).maybeSingle();
  if (error) throw error;
  if (!event) notFound();
  redirect(`/reservations?event=${encodeURIComponent(id)}`);
}
