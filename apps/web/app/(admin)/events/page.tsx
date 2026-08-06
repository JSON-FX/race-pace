import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseTableParams } from "@/lib/table-params";
import { getMyRoles, requireOrgId } from "@/lib/queries/roles";
import { listOrgEvents } from "@/lib/queries/events";
import { NoOrgScope } from "@/components/no-org-scope";
import { EventsTable } from "./events-table";

const DEFAULTS = { sort: [{ id: "event_date", desc: false }], filters: { status: "all" } };

export default async function EventsPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // searchParams is a Promise in Next 15 and must be awaited.
  const params = parseTableParams(await searchParams, DEFAULTS);
  const roles = await getMyRoles();
  // The (admin) layout only guarantees `isAdmin` — a super_admin with no
  // org-scoped admin/editor row clears that guard with `orgId: null`. See
  // requireOrgId's doc comment: querying with a null id 500s, it doesn't
  // just return an empty list, so this must branch before calling
  // listOrgEvents, not assert the id and let it crash.
  const orgId = requireOrgId(roles);

  if (!orgId) {
    return (
      <div className="px-4 pb-10 pt-6 md:px-[30px]">
        <div className="mb-5">
          <h1 className="text-[21px] font-bold tracking-[-0.02em]">Events</h1>
        </div>
        <NoOrgScope />
      </div>
    );
  }

  // Caught here (rather than left to throw into error.tsx) so a transient
  // DB blip degrades gracefully: the header, count text and "New event"
  // button stay usable, and only the table area shows a retryable inline
  // error (DataTable's `isError` — see that prop's doc comment). Nothing
  // else on this page depends on `listOrgEvents`, unlike Registrations/
  // Payments where the table query and the KPI aggregates are batched
  // together in one `Promise.all` and a partial "table failed, KPIs fine"
  // state isn't something today's query shape can express — those still
  // fall through to app/(admin)/error.tsx on a query failure.
  let rows: Awaited<ReturnType<typeof listOrgEvents>>["rows"] = [];
  let total = 0;
  let isError = false;
  try {
    ({ rows, total } = await listOrgEvents(orgId, params));
  } catch (error) {
    console.error("[events] listOrgEvents failed", { orgId, error });
    isError = true;
  }

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-5 flex flex-wrap items-start gap-4">
        <div>
          <h1 className="text-[21px] font-bold tracking-[-0.02em]">Events</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            <span className="tabular">{total}</span> event{total === 1 ? "" : "s"} in this organization
          </p>
        </div>
        <Button asChild className="ml-auto">
          <Link href="/events/new"><Plus className="size-4" />New event</Link>
        </Button>
      </div>

      <EventsTable rows={rows} total={total} page={params.page} per={params.per}
        sort={params.sort} activeFilters={params.filters} q={params.q}
        canWrite={!!roles?.isAdmin} isError={isError} />
    </div>
  );
}
