import { redirect } from "next/navigation";
import { hasCapability } from "@/lib/capabilities";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { getOrg } from "@/lib/queries/org";
import { getEventReservations, getReservationCategoryAvailability, listReservationEvents } from "@/lib/queries/reservations";
import { NoOrgScope } from "@/components/no-org-scope";
import { ReservationsWorkspace } from "./reservations-workspace";
import "./reservations.css";

export default async function ReservationsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const roles = await getMyRoles();
  if (!hasCapability(roles?.capabilities ?? [], "manage_org")) redirect("/no-access");
  const orgId = requireOrgId(roles);
  if (!orgId) return <div className="px-4 py-6 md:px-[30px]"><h1 className="mb-5 text-2xl font-bold">Reservations</h1><NoOrgScope /></div>;
  const [events, org, params] = await Promise.all([listReservationEvents(orgId), getOrg(orgId), searchParams]);
  const requested = typeof params.event === "string" ? params.event : null;
  // The switcher changes org scope while retaining the URL. Validate membership
  // even for super admins before any roster query, then drop the stale event.
  if (requested && !events.some(event => event.id === requested)) redirect("/reservations");
  const [result, categories] = requested ? await Promise.all([getEventReservations(orgId, requested), getReservationCategoryAvailability(orgId, requested)]) : [undefined, undefined];
  return <div className="reservation-page"><ReservationsWorkspace key={`${orgId}-${requested ?? "none"}`} events={events} eventId={requested} orgName={org?.name ?? "this organization"} rows={result?.rows} summary={result?.summary} categories={categories} /></div>;
}
