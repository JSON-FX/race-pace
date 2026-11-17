import Link from "next/link";
import { redirect } from "next/navigation";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { getPayLaterEvents, getPayLaterGrants } from "@/lib/queries/pay-later";
import { philippineDay, type PayLaterPage } from "@/lib/pay-later";
import { NoOrgScope } from "@/components/no-org-scope";
import { PayLaterManager } from "./pay-later-manager";
import "./pay-later.css";

export default async function PayLaterPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const roles = await getMyRoles();
  if (!roles?.isOrgAdmin) redirect("/no-access");
  const orgId = requireOrgId(roles);
  if (!orgId) return <div className="fieldnotes-admin-workspace"><NoOrgScope /></div>;
  const events = await getPayLaterEvents(orgId);
  const params = await searchParams;
  const requestedEvent = typeof params.event === "string" ? params.event : undefined;
  const event = requestedEvent ? events.find(item => item.id === requestedEvent) : events[0];
  if (!event) return <div className="fieldnotes-admin-workspace pay-later-workspace">
    <Link href="/registrations/pay-later">Pay Later</Link>
    <h1>Pay Later</h1>
    <p>{requestedEvent ? "Choose an event from your active organization." : "Create an event before granting Pay Later."}</p>
  </div>;
  let initialPage: PayLaterPage = { rows: [], total: 0 };
  let initialError = "";
  try { initialPage = await getPayLaterGrants(event.id); }
  catch (error) {
    console.error("[pay-later] roster read failed", error);
    initialError = "Pay Later approvals could not be loaded. Try again.";
  }
  return <PayLaterManager key={orgId + event.id} events={events} event={event}
    initialPage={initialPage} initialError={initialError} today={philippineDay()} />;
}
