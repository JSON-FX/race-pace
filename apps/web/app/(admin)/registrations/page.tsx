import { parseTableParams } from "@/lib/table-params";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { listEventRegistrations, listOrgEventOptions, listEventCategories } from "@/lib/queries/registrations";
import { TableEmptyState } from "@/components/data-table";
import { NoOrgScope } from "@/components/no-org-scope";
import { EventPicker } from "./event-picker";
import { RegistrationsTable } from "./registrations-table";

const DEFAULTS = { sort: [{ id: "created_at", desc: true }], filters: { status: "all", category: "all" } };

export default async function RegistrationsPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // searchParams is a Promise in Next 15 and must be awaited.
  const params = parseTableParams(await searchParams, DEFAULTS);
  const roles = await getMyRoles();
  // See requireOrgId's doc comment: a super_admin with no org-scoped
  // admin/editor row clears the (admin) layout's `isAdmin` guard with
  // `orgId: null`. Branch before calling any org-scoped query, don't assert
  // the id and let it crash.
  const orgId = requireOrgId(roles);

  if (!orgId) {
    return (
      <div className="px-4 pb-10 pt-6 md:px-[30px]">
        <div className="mb-5">
          <h1 className="text-xl font-bold tracking-tight">Registrations</h1>
        </div>
        <NoOrgScope />
      </div>
    );
  }

  const events = await listOrgEventOptions(orgId);
  // `event` is a filter key, so parseTableParams already surfaced it. Default
  // to the most recent event so the page is never empty on first visit.
  const eventId = params.filters.event && params.filters.event !== "all"
    ? params.filters.event
    : events[0]?.id;

  if (!eventId) {
    return (
      <div className="px-4 pb-10 pt-6 md:px-[30px]">
        <h1 className="mb-5 text-xl font-bold tracking-tight">Registrations</h1>
        <div className="rounded-xl border border-border bg-card">
          <TableEmptyState title="No events yet" description="Create an event before you can take registrations." />
        </div>
      </div>
    );
  }

  const [{ rows, total }, categories] = await Promise.all([
    listEventRegistrations(eventId, params),
    listEventCategories(eventId),
  ]);

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight">Registrations</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          <span className="font-mono tabular">{total}</span> registration{total === 1 ? "" : "s"} for this event
        </p>
      </div>

      <div className="mb-3">
        <EventPicker events={events} value={eventId} />
      </div>

      <RegistrationsTable rows={rows} total={total} page={params.page} per={params.per}
        sort={params.sort} activeFilters={params.filters} q={params.q} categories={categories} />
    </div>
  );
}
